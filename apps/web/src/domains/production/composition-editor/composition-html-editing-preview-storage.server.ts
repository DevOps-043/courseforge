import { createHash } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hyperframesAssetManifestItemSchema } from "../hyperframes/hyperframes.types";
import { HYPERFRAMES_SOURCE_BUCKETS } from "../media-storage.config";
import { ORGANIZATION_FONT_STORAGE_BUCKET } from "../fonts/organization-font.types";

export const HTML_EDITING_PREVIEW_STORAGE_POLICY = Object.freeze({
  bufferedBytes: 64 * 1024 * 1024, maximumChunkBytes: 1024 * 1024,
  readTimeoutMs: 15_000, streamTimeoutMs: 120_000, signingSeconds: 60,
});
export const htmlEditingPreviewStorageIdentitySchema = hyperframesAssetManifestItemSchema.omit({ productionAssetId: true }).extend({
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  storageBucket: z.string().refine(bucket => HYPERFRAMES_SOURCE_BUCKETS.has(bucket) || bucket === ORGANIZATION_FONT_STORAGE_BUCKET),
}).strict();
export type HtmlEditingPreviewStorageIdentity = z.infer<typeof htmlEditingPreviewStorageIdentitySchema>;
export class HtmlEditingPreviewStorageError extends Error {
  constructor() { super("HTML_EDITING_PREVIEW_STORAGE_UNAVAILABLE"); this.name = "HtmlEditingPreviewStorageError"; }
}
type StorageRead = {
  identity: HtmlEditingPreviewStorageIdentity; supabase: SupabaseClient; storageOrigin: string;
  signal?: AbortSignal; fetchResource?: typeof fetch;
};

/** Sink receives UNVERIFIED chunks: it must be host-owned, private and disposable.
 * Neither serving nor publishing is permitted before this function succeeds.
 * Identity must come from an authorized reader, not request metadata. */
export async function streamHtmlEditingPreviewStorageToSink(input: StorageRead & {
  writeChunk: (chunk: Uint8Array) => Promise<void>;
}): Promise<void> {
  try {
    const identity = htmlEditingPreviewStorageIdentitySchema.parse(input.identity);
    const origin = new URL(input.storageOrigin);
    if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/"
      || (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)))) throw new Error();
    const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(HTML_EDITING_PREVIEW_STORAGE_POLICY.streamTimeoutMs)])
      : AbortSignal.timeout(HTML_EDITING_PREVIEW_STORAGE_POLICY.streamTimeoutMs);
    signal.throwIfAborted();
    const signed = await input.supabase.storage.from(identity.storageBucket)
      .createSignedUrl(identity.storagePath, HTML_EDITING_PREVIEW_STORAGE_POLICY.signingSeconds);
    signal.throwIfAborted();
    if (signed.error || !signed.data?.signedUrl) throw new Error();
    const url = new URL(signed.data.signedUrl);
    const path = `/storage/v1/object/sign/${encodeURIComponent(identity.storageBucket)}/${identity.storagePath.split("/").map(encodeURIComponent).join("/")}`;
    if (url.origin !== origin.origin || url.username || url.password || url.hash || url.pathname !== path
      || [...url.searchParams.keys()].some(key => key !== "token")
      || url.searchParams.getAll("token").length !== 1 || !url.searchParams.get("token")) throw new Error();
    const response = await (input.fetchResource ?? fetch)(url, { signal, redirect: "error", cache: "no-store", credentials: "omit" });
    const encoding = response.headers.get("content-encoding"), length = response.headers.get("content-length");
    if (response.status !== 200 || !response.body || (encoding && encoding !== "identity")
      || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== identity.mimeType
      || (length !== null && (!/^\d+$/.test(length) || Number(length) !== identity.fileSizeBytes))) {
      await response.body?.cancel(); throw new Error();
    }
    const reader = response.body.getReader(), hash = createHash("sha256");
    let size = 0, complete = false;
    try {
      while (true) {
        signal.throwIfAborted();
        const next = await reader.read();
        if (next.done) { complete = true; break; }
        if (next.value.byteLength > HTML_EDITING_PREVIEW_STORAGE_POLICY.maximumChunkBytes) throw new Error();
        size += next.value.byteLength;
        if (size > identity.fileSizeBytes) throw new Error();
        const owned = new Uint8Array(next.value);
        hash.update(owned);
        await input.writeChunk(owned);
      }
      signal.throwIfAborted();
      if (size !== identity.fileSizeBytes || hash.digest("hex") !== identity.checksum) throw new Error();
    } finally {
      if (!complete) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  } catch { throw new HtmlEditingPreviewStorageError(); }
}

/** Small-resource transport. Its content buffer is bounded independently from
 * the streaming media limit; no chunk list or final concatenation is retained. */
export async function readHtmlEditingPreviewStorageBytes(input: StorageRead): Promise<Uint8Array> {
  try {
    const identity = htmlEditingPreviewStorageIdentitySchema.parse(input.identity);
    if (identity.fileSizeBytes > HTML_EDITING_PREVIEW_STORAGE_POLICY.bufferedBytes) throw new Error();
    input.signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(HTML_EDITING_PREVIEW_STORAGE_POLICY.readTimeoutMs);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    const bytes = new Uint8Array(identity.fileSizeBytes);
    let offset = 0;
    await streamHtmlEditingPreviewStorageToSink({ ...input, identity, signal, writeChunk: async chunk => {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    } });
    return bytes;
  } catch {
    throw new HtmlEditingPreviewStorageError();
  }
}
