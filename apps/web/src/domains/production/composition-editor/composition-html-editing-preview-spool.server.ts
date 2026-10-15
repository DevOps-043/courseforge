import { mkdtemp, open, chmod, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  HTML_EDITING_PREVIEW_STORAGE_POLICY, htmlEditingPreviewStorageIdentitySchema, streamHtmlEditingPreviewStorageToSink,
  type HtmlEditingPreviewStorageIdentity,
} from "./composition-html-editing-preview-storage.server";

export class HtmlEditingPreviewSpoolError extends Error {
  constructor() {
    super("HTML_EDITING_PREVIEW_SPOOL_UNAVAILABLE");
    this.name = "HtmlEditingPreviewSpoolError";
  }
}
/** Caller must retain disk admission when failed cleanup cannot prove removal. */
export class HtmlEditingPreviewSpoolCleanupError extends HtmlEditingPreviewSpoolError {}

/** Owns exactly one private temporary file. No recursive cleanup or caller path.
 * POSIX modes are best-effort portability, not a Windows ACL/sandbox guarantee.
 * Consumers must dispose after delivery and recheck authorization before serving. */
export async function spoolCompositionHtmlEditingPreviewResource(input:
  Omit<Parameters<typeof streamHtmlEditingPreviewStorageToSink>[0], "writeChunk">
) {
  let directory: string | undefined;
  let filePath: string | undefined;
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let created = false;
  let disposed = false;
  let disposal: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (disposal) return disposal;
    disposal = (async () => {
      if (file) { await file.close(); file = undefined; }
      if (created && filePath) { await unlink(filePath); created = false; }
      if (directory) { await rmdir(directory); directory = undefined; }
      disposed = true;
    })().finally(() => { disposal = undefined; });
    return disposal;
  };
  try {
    const identity: HtmlEditingPreviewStorageIdentity = htmlEditingPreviewStorageIdentitySchema.parse(input.identity);
    input.signal?.throwIfAborted();
    directory = await mkdtemp(path.join(tmpdir(), "courseforge-html-preview-"));
    await chmod(directory, 0o700);
    filePath = path.join(directory, "resource.bin");
    file = await open(filePath, "wx", 0o600);
    created = true;
    await streamHtmlEditingPreviewStorageToSink({ ...input, identity, writeChunk: async chunk => {
      input.signal?.throwIfAborted();
      let offset = 0;
      while (offset < chunk.byteLength) {
        const written = await file!.write(chunk, offset, chunk.byteLength - offset, null);
        if (written.bytesWritten <= 0) throw new Error();
        offset += written.bytesWritten;
      }
    } });
    await file.close(); file = undefined;
    input.signal?.throwIfAborted();
    const ownedPath = filePath;
    const readSmallBytes = async (): Promise<Uint8Array> => {
      let reader: Awaited<ReturnType<typeof open>> | undefined;
      try {
        if (disposed || identity.fileSizeBytes > HTML_EDITING_PREVIEW_STORAGE_POLICY.bufferedBytes) throw new Error();
        input.signal?.throwIfAborted();
        reader = await open(ownedPath, "r");
        const metadata = await reader.stat();
        if (!metadata.isFile() || metadata.size !== identity.fileSizeBytes) throw new Error();
        const bytes = new Uint8Array(identity.fileSizeBytes);
        let offset = 0;
        while (offset < bytes.byteLength) {
          input.signal?.throwIfAborted();
          const result = await reader.read(bytes, offset, bytes.byteLength - offset, offset);
          if (result.bytesRead <= 0) throw new Error();
          offset += result.bytesRead;
        }
        const end = await reader.read(new Uint8Array(1), 0, 1, offset);
        if (end.bytesRead || createHash("sha256").update(bytes).digest("hex") !== identity.checksum) throw new Error();
        input.signal?.throwIfAborted();
        return bytes;
      } catch { throw new HtmlEditingPreviewSpoolError(); }
      finally {
        try { await reader?.close(); } catch { throw new HtmlEditingPreviewSpoolError(); }
      }
    };
    return { filePath, identity: Object.freeze(identity), dispose, readSmallBytes,
      scope: "BYTE_VERIFIED_PRIVATE_PREVIEW_FILE_NOT_DECODE_OR_RENDER_EVIDENCE" as const };
  } catch {
    try { await dispose(); } catch { throw new HtmlEditingPreviewSpoolCleanupError(); }
    throw new HtmlEditingPreviewSpoolError();
  }
}
