import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { spoolCompositionHtmlEditingPreviewResource } from "./composition-html-editing-preview-spool.server";

export const HTML_PREVIEW_FILE_STREAM_POLICY = Object.freeze({ chunkBytes: 64 * 1024, timeoutMs: 120_000 });
export class HtmlPreviewFileDeliveryError extends Error {
  constructor() { super("HTML_PREVIEW_RESOURCE_DELIVERY_UNAVAILABLE"); this.name = "HtmlPreviewFileDeliveryError"; }
}
export class HtmlPreviewRangeError extends Error {
  constructor() { super("HTML_PREVIEW_RESOURCE_RANGE_INVALID"); this.name = "HtmlPreviewRangeError"; }
}
export function parseHtmlPreviewResourceRange(header: string | null, size: number) {
  if (!Number.isSafeInteger(size) || size <= 0) throw new HtmlPreviewRangeError();
  if (header === null) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || header.length > 64) throw new HtmlPreviewRangeError();
  let start: number, end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new HtmlPreviewRangeError();
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) throw new HtmlPreviewRangeError();
    end = Math.min(end, size - 1);
  }
  return { start, end, partial: true };
}

type PrivateFile = Awaited<ReturnType<typeof spoolCompositionHtmlEditingPreviewResource>>;
/** Owns a successfully prepared private file until EOF/cancel/error. Verify the
 * whole file on the SAME descriptor before serving even a small range. Reads and
 * backpressure stay chunk-bounded; no whole-video buffer or remote redirect.
 * beforeDelivery MUST reauthorize current actor/portfolio after verification. */
export async function createHtmlPreviewResourceResponse(input: {
  file: PrivateFile; range: string | null; signal?: AbortSignal; beforeDelivery: () => Promise<void>;
}) {
  let reader: Awaited<ReturnType<typeof open>> | undefined;
  let closed = false, aborted = false;
  let activeRead: Promise<{ bytesRead: number }> | undefined;
  const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(HTML_PREVIEW_FILE_STREAM_POLICY.timeoutMs)])
    : AbortSignal.timeout(HTML_PREVIEW_FILE_STREAM_POLICY.timeoutMs);
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let cleanup: Promise<void> | undefined;
  const dispose = () => {
    if (cleanup) return cleanup;
    closed = true;
    signal.removeEventListener("abort", onAbort);
    cleanup = (async () => {
      await activeRead?.catch(() => undefined);
      try { await reader?.close(); } finally { await input.file.dispose(); }
    })();
    return cleanup;
  };
  const onAbort = () => {
    aborted = true;
    streamController?.error(new HtmlPreviewFileDeliveryError());
    void dispose().catch(() => undefined);
  };
  try {
    const range = parseHtmlPreviewResourceRange(input.range, input.file.identity.fileSizeBytes);
    signal.throwIfAborted();
    reader = await open(input.file.filePath, "r");
    const before = await reader.stat();
    if (!before.isFile() || before.size !== input.file.identity.fileSizeBytes) throw new Error();
    const hash = createHash("sha256"), buffer = Buffer.alloc(HTML_PREVIEW_FILE_STREAM_POLICY.chunkBytes);
    let offset = 0;
    while (offset < before.size) {
      signal.throwIfAborted();
      const { bytesRead } = await reader.read(buffer, 0, Math.min(buffer.length, before.size - offset), offset);
      if (bytesRead <= 0) throw new Error();
      hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
    }
    const after = await reader.stat(), endCheck = await reader.read(Buffer.alloc(1), 0, 1, offset);
    if (endCheck.bytesRead || after.size !== before.size || after.mtimeMs !== before.mtimeMs
      || hash.digest("hex") !== input.file.identity.checksum) throw new Error();
    await input.beforeDelivery();
    signal.throwIfAborted();
    const authorizedStat = await reader.stat();
    if (authorizedStat.size !== before.size || authorizedStat.mtimeMs !== before.mtimeMs) throw new Error();
    offset = range.start;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { streamController = controller; },
      async pull(controller) {
        if (closed) return;
        try {
          signal.throwIfAborted();
          const length = Math.min(HTML_PREVIEW_FILE_STREAM_POLICY.chunkBytes, range.end - offset + 1);
          const bytes = new Uint8Array(length);
          activeRead = reader!.read(bytes, 0, length, offset);
          const { bytesRead } = await activeRead;
          activeRead = undefined;
          if (aborted || closed) return;
          if (bytesRead <= 0) throw new Error();
          offset += bytesRead;
          controller.enqueue(bytes.subarray(0, bytesRead));
          if (offset > range.end) { await dispose(); controller.close(); }
        } catch {
          if (!aborted) controller.error(new HtmlPreviewFileDeliveryError());
          await dispose();
        }
      },
      async cancel() { await dispose(); },
    }, { highWaterMark: 0 });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    const headers = new Headers({ "Content-Type": input.file.identity.mimeType,
      "Content-Length": String(range.end - range.start + 1), "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox", "Cross-Origin-Resource-Policy": "cross-origin",
      // Opaque frame needs font/media CORS. Capability and fresh server checks,
      // not Origin:null or cookies, authorize each exact resource; no credentials.
      "Access-Control-Allow-Origin": "null" });
    if (range.partial) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${before.size}`);
    return new Response(body, { status: range.partial ? 206 : 200, headers });
  } catch (error) {
    await dispose();
    if (error instanceof HtmlPreviewRangeError) throw error;
    throw new HtmlPreviewFileDeliveryError();
  }
}
