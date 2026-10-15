import { createHash } from "node:crypto";
import { THUMBNAIL_POLICY, thumbnailSpriteCacheKey, thumbnailSpriteManifestSchema, type ThumbnailSpriteIdentity } from "./thumbnail-derivative.contract";
import { rejectThumbnail, requireThumbnailActive, type ThumbnailManifest, type ThumbnailSpriteInspector } from "./thumbnail-runtime.contract";

export function thumbnailSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Copies bounded transport chunks; never decodes a medium in this process. */
export async function collectThumbnailBytes(stream: AsyncIterable<Uint8Array>, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  requireThumbnailActive(signal);
  for await (const chunk of stream) {
    requireThumbnailActive(signal);
    if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0) rejectThumbnail("THUMBNAIL_BYTES_INVALID");
    length += chunk.byteLength;
    if (length > maxBytes) rejectThumbnail("THUMBNAIL_BYTES_LIMIT");
    chunks.push(Buffer.from(chunk));
  }
  requireThumbnailActive(signal);
  if (!length) rejectThumbnail("THUMBNAIL_BYTES_EMPTY");
  return Buffer.concat(chunks, length);
}

export function thumbnailPageRecipe(identity: ThumbnailSpriteIdentity) {
  thumbnailSpriteCacheKey(identity);
  const first = identity.pageIndex * THUMBNAIL_POLICY.tilesPerSprite;
  const count = Math.min(THUMBNAIL_POLICY.tilesPerSprite, Math.ceil(identity.interval.durationMs / identity.stepMs) - first);
  return {
    width: THUMBNAIL_POLICY.columns * THUMBNAIL_POLICY.tileWidth,
    height: Math.ceil(count / THUMBNAIL_POLICY.columns) * THUMBNAIL_POLICY.tileHeight,
    timestampsMs: Array.from({ length: count }, (_, i) => identity.interval.sourceOffsetMs + (first + i) * identity.stepMs),
  };
}

/** Pure header gate for the producer's simple, static WebP subset. Full decode is separately required. */
export function inspectThumbnailWebpHeader(input: Uint8Array) {
  if (input.byteLength > THUMBNAIL_POLICY.maxSpriteBytes || input.byteLength < 26) rejectThumbnail("THUMBNAIL_WEBP_INVALID");
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP"
    || bytes.readUInt32LE(4) + 8 !== bytes.length) rejectThumbnail("THUMBNAIL_WEBP_INVALID");
  const chunk = bytes.toString("ascii", 12, 16);
  const size = bytes.readUInt32LE(16);
  if (20 + size + (size % 2) !== bytes.length || (size % 2 && bytes[bytes.length - 1] !== 0)) rejectThumbnail("THUMBNAIL_WEBP_INVALID");
  if (chunk === "VP8 " && size >= 10 && !(bytes[20] & 1)
    && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L" && size >= 5 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    if (bits >>> 29) rejectThumbnail("THUMBNAIL_WEBP_INVALID");
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return rejectThumbnail("THUMBNAIL_WEBP_INVALID");
}

export async function verifyThumbnailSprite(params: {
  identity: ThumbnailSpriteIdentity; manifest: unknown; bytes: Uint8Array;
  inspector: ThumbnailSpriteInspector; signal: AbortSignal;
}): Promise<ThumbnailManifest> {
  requireThumbnailActive(params.signal);
  const parsed = thumbnailSpriteManifestSchema.safeParse(params.manifest);
  if (!parsed.success) rejectThumbnail("THUMBNAIL_MANIFEST_INVALID");
  const manifest = parsed.data;
  if (thumbnailSpriteCacheKey(manifest.identity) !== thumbnailSpriteCacheKey(params.identity)) rejectThumbnail("THUMBNAIL_IDENTITY_MISMATCH");
  if (params.bytes.byteLength !== manifest.byteLength || thumbnailSha256(params.bytes) !== manifest.spriteSha256) rejectThumbnail("THUMBNAIL_INTEGRITY_MISMATCH");
  const header = inspectThumbnailWebpHeader(params.bytes);
  if (header.width !== manifest.width || header.height !== manifest.height) rejectThumbnail("THUMBNAIL_GEOMETRY_MISMATCH");
  const decoded = await params.inspector.inspectSprite(params.bytes, params.signal);
  requireThumbnailActive(params.signal);
  if (params.bytes.byteLength !== manifest.byteLength || thumbnailSha256(params.bytes) !== manifest.spriteSha256) rejectThumbnail("THUMBNAIL_INTEGRITY_MISMATCH");
  if (decoded.mimeType !== "image/webp" || decoded.frameCount !== 1
    || decoded.width !== manifest.width || decoded.height !== manifest.height) rejectThumbnail("THUMBNAIL_DECODE_MISMATCH");
  return manifest;
}

export function thumbnailObjectKey(manifest: ThumbnailManifest) {
  const identityDigest = createHash("sha256").update(thumbnailSpriteCacheKey(manifest.identity)).digest("hex");
  return `organizations/${manifest.identity.source.organizationId}/media-derivatives/thumbnails/v1/${identityDigest}/${manifest.spriteSha256}.webp`;
}
