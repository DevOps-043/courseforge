import { createHash } from "node:crypto";
import { GOOGLE_FONT_PREPARATION_POLICY, googleFontPreparationInputSchema } from "./google-font-preparation-policy";
import { parseGoogleFontStylesheet } from "./google-font-stylesheet";
import { MAX_ORGANIZATION_FONT_BYTES, resolveOrganizationFontUpload, validateOrganizationFontBinary } from "./organization-font-upload-policy.service";

export class GoogleFontPreparationError extends Error {
  constructor() { super("GOOGLE_FONT_PREPARATION_UNAVAILABLE"); this.name = "GoogleFontPreparationError"; }
}

/** Ephemeral candidate bytes only. No Storage/DB writes, READY state, authority,
 * glyph coverage or render attestation. Preserve every provider face/subset. */
export async function prepareGoogleFontBytes(rawInput: unknown, options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}) {
  const input = googleFontPreparationInputSchema.parse(rawInput);
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(GOOGLE_FONT_PREPARATION_POLICY.timeoutMs)])
    : AbortSignal.timeout(GOOGLE_FONT_PREPARATION_POLICY.timeoutMs);
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const cssBytes = await download(new URL(input.cssUrl).href, GOOGLE_FONT_PREPARATION_POLICY.stylesheetBytes, ["text/css"], signal, fetchImpl);
    const css = new TextDecoder("utf-8", { fatal: true }).decode(cssBytes);
    const faces = parseGoogleFontStylesheet(css, input.family);
    const files = new Map<string, { checksumSha256: string; fileSizeBytes: number; mimeType: ReturnType<typeof resolveOrganizationFontUpload>["contentType"];
      embeddingCheck: ReturnType<typeof validateOrganizationFontBinary>["embedding"]; bytes: Uint8Array }>();
    let totalBytes = 0;
    // Sequential downloads and a shared budget bound resident bytes and network work.
    for (const face of faces) {
      if (files.has(face.sourceUrl)) continue;
      const remaining = Math.min(MAX_ORGANIZATION_FONT_BYTES, GOOGLE_FONT_PREPARATION_POLICY.totalFontBytes - totalBytes);
      if (remaining <= 0) throw new GoogleFontPreparationError();
      const upload = resolveOrganizationFontUpload({ name: `font.${face.extension}`, size: 1 });
      const bytes = await download(face.sourceUrl, remaining, [upload.contentType, "application/octet-stream", "application/x-font-ttf", "application/x-font-opentype"], signal, fetchImpl);
      const validation = validateOrganizationFontBinary(bytes, face.extension);
      totalBytes += bytes.byteLength;
      files.set(face.sourceUrl, { checksumSha256: sha256(bytes), fileSizeBytes: bytes.byteLength,
        mimeType: upload.contentType, embeddingCheck: validation.embedding, bytes });
    }
    signal.throwIfAborted();
    return { source: "google" as const, family: input.family, stylesheetChecksumSha256: sha256(cssBytes), totalBytes,
      scope: "STRUCTURAL_CANDIDATE_BYTES_NOT_NATIVE_AUTHORITY" as const,
      faces: faces.map(face => { const file = files.get(face.sourceUrl)!;
        return { style: face.style, weight: face.weight, unicodeRange: face.unicodeRange, checksumSha256: file.checksumSha256,
          fileSizeBytes: file.fileSizeBytes, mimeType: file.mimeType, embeddingCheck: file.embeddingCheck }; }),
      files: [...files.values()],
    };
  } catch { options.signal?.throwIfAborted(); throw new GoogleFontPreparationError(); }
}

function sha256(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }

async function download(url: string, maximumBytes: number, mimeTypes: string[], signal: AbortSignal, fetchImpl: typeof fetch) {
  signal.throwIfAborted();
  const response = await fetchImpl(url, { method: "GET", redirect: "error", credentials: "omit", cache: "no-store", signal,
    headers: { Accept: mimeTypes[0] } });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => { void reader?.cancel().catch(() => undefined); };
  try {
    signal.throwIfAborted();
    const length = response.headers.get("content-length");
    if (response.status !== 200 || response.redirected || response.url && response.url !== url || !response.body
      || response.headers.has("content-range") || !mimeTypes.includes(response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "")
      || length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > maximumBytes)) throw new GoogleFontPreparationError();
    reader = response.body.getReader();
    signal.addEventListener("abort", cancel, { once: true });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximumBytes) throw new GoogleFontPreparationError();
      chunks.push(new Uint8Array(chunk.value));
    }
    // Content-Length describes wire bytes when HTTP compression is present.
    const encoding = response.headers.get("content-encoding");
    if (!size || length !== null && (!encoding || encoding === "identity") && Number(length) !== size) throw new GoogleFontPreparationError();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    signal.removeEventListener("abort", cancel);
    if (reader) { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    else await response.body?.cancel().catch(() => undefined);
  }
}
