import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const HTML_PINNED_STORAGE_READ_POLICY = Object.freeze({
  maximumChunkBytes: 1024 * 1024, streamTimeoutMs: 120_000, signingSeconds: 60,
});
export type HtmlPinnedStorageIdentity = {
  storageBucket: string; storagePath: string; mimeType: string; fileSizeBytes: number; checksum: string;
};

/** Internal transport only. Caller must first validate its domain-specific
 * bucket/path/MIME/size schema and independently authorize the object identity.
 * Chunks are unverified until completion; sinks must remain private/disposable. */
export async function streamPinnedHtmlStorageObject(input: {
  identity: HtmlPinnedStorageIdentity; supabase: SupabaseClient; storageOrigin: string;
  signal?: AbortSignal; fetchResource?: typeof fetch; writeChunk: (chunk: Uint8Array) => Promise<void>;
}): Promise<void> {
  const identity = input.identity, origin = new URL(input.storageOrigin);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/"
    || (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)))) throw new Error();
  const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(HTML_PINNED_STORAGE_READ_POLICY.streamTimeoutMs)])
    : AbortSignal.timeout(HTML_PINNED_STORAGE_READ_POLICY.streamTimeoutMs);
  signal.throwIfAborted();
  const signed = await input.supabase.storage.from(identity.storageBucket)
    .createSignedUrl(identity.storagePath, HTML_PINNED_STORAGE_READ_POLICY.signingSeconds);
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
      if (next.value.byteLength > HTML_PINNED_STORAGE_READ_POLICY.maximumChunkBytes) throw new Error();
      size += next.value.byteLength;
      if (size > identity.fileSizeBytes) throw new Error();
      const owned = new Uint8Array(next.value);
      hash.update(owned); await input.writeChunk(owned);
    }
    signal.throwIfAborted();
    if (size !== identity.fileSizeBytes || hash.digest("hex") !== identity.checksum) throw new Error();
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
