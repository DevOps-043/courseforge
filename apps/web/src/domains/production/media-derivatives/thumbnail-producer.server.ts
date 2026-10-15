import { THUMBNAIL_POLICY, thumbnailSpriteIdentitySchema, thumbnailSpriteManifestSchema, type ThumbnailSpriteIdentity } from "./thumbnail-derivative.contract";
import { THUMBNAIL_RUNTIME_LIMITS, rejectThumbnail, requireThumbnailActive, withThumbnailDeadline,
  type ContainedThumbnailRuntime, type ThumbnailAccess, type ThumbnailAuthority, type ThumbnailStore } from "./thumbnail-runtime.contract";
import { collectThumbnailBytes, thumbnailObjectKey, thumbnailPageRecipe, thumbnailSha256, verifyThumbnailSprite } from "./thumbnail-verifier.server";
import { readThumbnailCache, recheckThumbnailSource, resolveThumbnailSource } from "./thumbnail-reader.server";

/** Produces one page. Claim ownership/commit must be supplied by the existing job infrastructure. */
export async function produceThumbnailSprite(params: {
  access: ThumbnailAccess; identity: ThumbnailSpriteIdentity; authority: ThumbnailAuthority;
  runtime: ContainedThumbnailRuntime; store: ThumbnailStore; signal: AbortSignal; now?: () => number;
}) {
  return withThumbnailDeadline(params.signal, async (signal) => {
    const identity = thumbnailSpriteIdentitySchema.parse(params.identity);
    const now = params.now ?? Date.now;
    const source = await resolveThumbnailSource(params.authority, params.access, identity, signal);
    const cached = await readThumbnailCache({ ...params, identity, inspector: params.runtime, signal, now });
    if (cached) {
      await recheckThumbnailSource(params.authority, source, identity, signal);
      return { ...cached, cacheHit: true };
    }
    const sourceBytes = await collectThumbnailBytes(await params.authority.open(source, signal), source.byteLength, signal);
    if (sourceBytes.byteLength !== source.byteLength || thumbnailSha256(sourceBytes) !== source.sourceSha256) rejectThumbnail("THUMBNAIL_SOURCE_INTEGRITY_MISMATCH");
    await recheckThumbnailSource(params.authority, source, identity, signal);
    const probe = await params.runtime.probeSource(sourceBytes, signal);
    requireThumbnailActive(signal);
    if (probe.durationMs !== source.sourceDurationMs || probe.mimeType !== source.mimeType
      || probe.width !== source.width || probe.height !== source.height) rejectThumbnail("THUMBNAIL_SOURCE_PROBE_MISMATCH");
    const recipe = thumbnailPageRecipe(identity);
    const generated = await params.runtime.generateSprite({ sourceBytes, source: structuredClone(source), identity: structuredClone(identity),
      timestampsMs: [...recipe.timestampsMs], tileWidth: 160, tileHeight: 90, columns: 8,
      width: recipe.width, height: recipe.height, maxOutputBytes: THUMBNAIL_POLICY.maxSpriteBytes, signal });
    requireThumbnailActive(signal);
    // Detect accidental mutation by an injected runtime before admitting any derivative.
    if (thumbnailSha256(sourceBytes) !== source.sourceSha256) rejectThumbnail("THUMBNAIL_SOURCE_INTEGRITY_MISMATCH");
    const bytes = await collectThumbnailBytes(generated.bytes, THUMBNAIL_POLICY.maxSpriteBytes, signal);
    const parsed = thumbnailSpriteManifestSchema.safeParse({ identity, spriteSha256: thumbnailSha256(bytes),
      mimeType: "image/webp", byteLength: bytes.length, width: recipe.width, height: recipe.height,
      sourceTimestampsMs: generated.sourceTimestampsMs });
    if (!parsed.success) rejectThumbnail("THUMBNAIL_MANIFEST_INVALID");
    const manifest = await verifyThumbnailSprite({ identity, manifest: parsed.data, bytes, inspector: params.runtime, signal });
    await recheckThumbnailSource(params.authority, source, identity, signal);
    requireThumbnailActive(signal);
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) rejectThumbnail("THUMBNAIL_CLOCK_INVALID");
    const record = { manifest, objectKey: thumbnailObjectKey(manifest),
      expiresAtMs: timestamp + THUMBNAIL_RUNTIME_LIMITS.maxCacheLifetimeMs };
    await params.store.putCreateOnly(record, bytes, signal);
    requireThumbnailActive(signal);
    // A duplicate or lost Storage ACK never authorizes unverified bytes. Do not delete shared objects.
    const stored = await readThumbnailCache({ identity, store: params.store, inspector: params.runtime, signal, now });
    if (!stored) rejectThumbnail("THUMBNAIL_PUBLICATION_UNCONFIRMED");
    if (stored.manifest.spriteSha256 !== manifest.spriteSha256) rejectThumbnail("THUMBNAIL_PUBLICATION_CONFLICT");
    await recheckThumbnailSource(params.authority, source, identity, signal);
    requireThumbnailActive(signal);
    return { ...stored, cacheHit: false };
  });
}
