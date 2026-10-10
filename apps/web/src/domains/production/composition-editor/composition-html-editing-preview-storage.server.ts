import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hyperframesAssetManifestItemSchema } from "../hyperframes/hyperframes.types";
import { HYPERFRAMES_SOURCE_BUCKETS } from "../media-storage.config";
import { ORGANIZATION_FONT_STORAGE_BUCKET } from "../fonts/organization-font.types";
import { HTML_PINNED_STORAGE_READ_POLICY, streamPinnedHtmlStorageObject } from "./composition-html-pinned-storage-reader.server";

export const HTML_EDITING_PREVIEW_STORAGE_POLICY = Object.freeze({
  ...HTML_PINNED_STORAGE_READ_POLICY, bufferedBytes: 64 * 1024 * 1024, readTimeoutMs: 15_000,
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
    await streamPinnedHtmlStorageObject({ ...input, identity });
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
