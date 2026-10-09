import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import sharp from "sharp";
import { htmlEditingImageIdentitySchema, assertHtmlEditingImageIdentities, type HtmlEditingImageIdentity } from "./composition-html-editing-image-identity";
import { prepareCompositionHtmlEditingSnapshotImages } from "./composition-html-editing-snapshot-images.service";
import { HTML_EDITING_PREVIEW_STORAGE_POLICY, readHtmlEditingPreviewStorageBytes } from "./composition-html-editing-preview-storage.server";

export const HTML_EDITING_PREVIEW_IMAGE_POLICY = Object.freeze({ totalBytes: 128 * 1024 * 1024,
  readTimeoutMs: HTML_EDITING_PREVIEW_STORAGE_POLICY.readTimeoutMs,
  maximumPixels: 16_777_216, maximumEdge: 8192, maximumChunks: 16_384 });
export class HtmlEditingPreviewImageError extends Error {
  constructor() { super("HTML_EDITING_PREVIEW_IMAGES_UNAVAILABLE"); this.name = "HtmlEditingPreviewImageError"; }
}
function assertStaticRasterContainer(bytes: Buffer, mimeType: HtmlEditingImageIdentity["mimeType"]) {
  if (mimeType === "image/jpeg") return; // JPEG's format is checked by Sharp below.
  const png = mimeType === "image/png";
  if (png ? bytes.length < 20 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP"
      || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error();
  let offset = png ? 8 : 12, chunks = 0, ended = false;
  while (offset < bytes.length) {
    if (++chunks > HTML_EDITING_PREVIEW_IMAGE_POLICY.maximumChunks || offset + (png ? 12 : 8) > bytes.length) throw new Error();
    const length = png ? bytes.readUInt32BE(offset) : bytes.readUInt32LE(offset + 4);
    const kind = png ? bytes.toString("ascii", offset + 4, offset + 8) : bytes.toString("ascii", offset, offset + 4);
    const end = offset + length + (png ? 12 : 8 + (length % 2));
    if (end > bytes.length || (png ? ["acTL", "fcTL", "fdAT"].includes(kind) : ["ANIM", "ANMF"].includes(kind))) throw new Error();
    if (!png && kind === "VP8X" && (length < 10 || (bytes[offset + 8] & 2) !== 0)) throw new Error();
    offset = end;
    if (png && kind === "IEND") { if (length !== 0 || offset !== bytes.length) throw new Error(); ended = true; }
  }
  if (png && !ended) throw new Error();
}

/** Reusable raster admission after a verified private spool or bounded download.
 * Metadata/container checks are not a complete decode or sandbox attestation. */
export async function validateCompositionHtmlEditingPreviewImageBytes(input: {
  bytes: Uint8Array; identity: HtmlEditingImageIdentity; signal?: AbortSignal;
}) {
  const identity = htmlEditingImageIdentitySchema.parse(input.identity);
  if (input.bytes.byteLength !== identity.fileSizeBytes) throw new HtmlEditingPreviewImageError();
  input.signal?.throwIfAborted();
  const bytes = Buffer.from(input.bytes);
  assertStaticRasterContainer(bytes, identity.mimeType);
  const metadata = await sharp(bytes, { failOn: "error", limitInputPixels: HTML_EDITING_PREVIEW_IMAGE_POLICY.maximumPixels }).metadata();
  const formats = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" } as const;
  if (metadata.format !== formats[identity.mimeType] || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1
    || metadata.width > HTML_EDITING_PREVIEW_IMAGE_POLICY.maximumEdge || metadata.height > HTML_EDITING_PREVIEW_IMAGE_POLICY.maximumEdge
    || metadata.width * metadata.height > HTML_EDITING_PREVIEW_IMAGE_POLICY.maximumPixels) throw new HtmlEditingPreviewImageError();
  input.signal?.throwIfAborted();
}

/** Download only a host-authorized identity from the operator's Storage origin.
 * Signed URLs remain private; redirects, partial content and unbounded responses
 * are never accepted. Fetch is an infrastructure port, not request input. */
export async function readCompositionHtmlEditingPreviewImage(input: {
  identity: HtmlEditingImageIdentity; supabase: SupabaseClient; storageOrigin: string; signal?: AbortSignal;
  fetchResource?: typeof fetch;
}): Promise<Uint8Array> {
  try {
    const identity = htmlEditingImageIdentitySchema.parse(input.identity);
    const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(HTML_EDITING_PREVIEW_IMAGE_POLICY.readTimeoutMs)])
      : AbortSignal.timeout(HTML_EDITING_PREVIEW_IMAGE_POLICY.readTimeoutMs);
    signal.throwIfAborted();
    const { productionAssetId: _assetId, ...storageIdentity } = identity;
    const bytes = Buffer.from(await readHtmlEditingPreviewStorageBytes({ ...input, identity: storageIdentity, signal }));
    await validateCompositionHtmlEditingPreviewImageBytes({ bytes, identity, signal });
    return new Uint8Array(bytes);
  } catch { throw new HtmlEditingPreviewImageError(); }
}

type Preparation = Parameters<typeof prepareCompositionHtmlEditingSnapshotImages>[0];
/** Read-only assembler. The existing producer supplies exact historical authority,
 * current draft links and image records. A second authorized read detects drift
 * after byte acquisition; it is not a permanent permission lease or upload. */
export async function prepareCompositionHtmlEditingPreviewImages(input: Preparation & {
  storageOrigin: string; fetchResource?: typeof fetch;
}) {
  try {
    z.string().url().parse(input.storageOrigin);
    input.signal?.throwIfAborted();
    const prepared = await prepareCompositionHtmlEditingSnapshotImages(input);
    const identities = prepared.imageAssets.map(identity => htmlEditingImageIdentitySchema.parse(identity));
    if (identities.reduce((total, identity) => total + identity.fileSizeBytes, 0) > HTML_EDITING_PREVIEW_IMAGE_POLICY.totalBytes) throw new Error();
    const images = new Map<string, Uint8Array>();
    // Sequential reads bound per-request working memory and Storage concurrency.
    for (const identity of identities) images.set(identity.productionAssetId,
      await readCompositionHtmlEditingPreviewImage({ ...input, identity }));
    const refreshed = await prepareCompositionHtmlEditingSnapshotImages(input);
    if (refreshed.bundle.encodedBundle !== prepared.bundle.encodedBundle || refreshed.bundle.sha256 !== prepared.bundle.sha256) throw new Error();
    assertHtmlEditingImageIdentities({ usedAssetIds: identities.map(identity => identity.productionAssetId),
      currentImages: refreshed.imageAssets, frozenBindings: identities.map(identity => ({ assetId: identity.productionAssetId,
        checksum: identity.checksum, fileSizeBytes: identity.fileSizeBytes, mimeType: identity.mimeType,
        storageBucket: identity.storageBucket!, storagePath: identity.storagePath, localPath: `conformance-media/${identity.productionAssetId}` })) });
    input.signal?.throwIfAborted();
    return { ...refreshed, images, scope: "AUTHORIZED_BYTE_VERIFIED_PREVIEW_IMAGES_NOT_RENDER_EVIDENCE" as const };
  } catch { throw new HtmlEditingPreviewImageError(); }
}
