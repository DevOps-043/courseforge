import { thumbnailSpriteCacheKey, thumbnailSpriteIdentitySchema, type ThumbnailSpriteIdentity } from "./thumbnail-derivative.contract";
import { THUMBNAIL_RUNTIME_LIMITS, thumbnailAccessSchema, thumbnailAuthorizedSourceSchema, thumbnailCacheRecordSchema,
  rejectThumbnail, requireThumbnailActive, withThumbnailDeadline, type ThumbnailAccess, type ThumbnailAuthority,
  type ThumbnailAuthorizedSource, type ThumbnailSpriteInspector, type ThumbnailStore } from "./thumbnail-runtime.contract";
import { collectThumbnailBytes, thumbnailObjectKey, verifyThumbnailSprite } from "./thumbnail-verifier.server";

export async function resolveThumbnailSource(authority: ThumbnailAuthority, access: ThumbnailAccess,
  identity: ThumbnailSpriteIdentity, signal: AbortSignal): Promise<ThumbnailAuthorizedSource> {
  const scope = thumbnailAccessSchema.parse(access);
  const expected = thumbnailSpriteIdentitySchema.parse(identity);
  if (scope.organizationId !== expected.source.organizationId) rejectThumbnail("THUMBNAIL_ACCESS_DENIED");
  requireThumbnailActive(signal);
  const parsed = thumbnailAuthorizedSourceSchema.safeParse(await authority.resolve(scope, signal));
  requireThumbnailActive(signal);
  if (!parsed.success) rejectThumbnail("THUMBNAIL_ACCESS_DENIED");
  const source = parsed.data;
  for (const field of ["actorId", "organizationId", "componentId", "sourceAssetId"] as const) {
    if (source[field] !== scope[field]) rejectThumbnail("THUMBNAIL_ACCESS_DENIED");
  }
  if (source.sourceSha256 !== expected.source.sourceSha256 || source.sourceDurationMs !== expected.source.sourceDurationMs) {
    rejectThumbnail("THUMBNAIL_SOURCE_CHANGED");
  }
  return source;
}

export async function recheckThumbnailSource(authority: ThumbnailAuthority, source: ThumbnailAuthorizedSource,
  identity: ThumbnailSpriteIdentity, signal: AbortSignal) {
  const current = await resolveThumbnailSource(authority, {
    actorId: source.actorId, organizationId: source.organizationId,
    componentId: source.componentId, sourceAssetId: source.sourceAssetId,
  }, identity, signal);
  if (JSON.stringify(current) !== JSON.stringify(source)) rejectThumbnail("THUMBNAIL_SOURCE_CHANGED");
}

export async function readThumbnailCache(params: {
  identity: ThumbnailSpriteIdentity; store: ThumbnailStore; inspector: ThumbnailSpriteInspector;
  signal: AbortSignal; now: () => number;
}) {
  requireThumbnailActive(params.signal);
  const raw = await params.store.lookup(params.identity, params.signal);
  requireThumbnailActive(params.signal);
  if (raw === null) return null;
  const parsed = thumbnailCacheRecordSchema.safeParse(raw);
  if (!parsed.success) rejectThumbnail("THUMBNAIL_CACHE_INVALID");
  const record = parsed.data;
  if (thumbnailSpriteCacheKey(record.manifest.identity) !== thumbnailSpriteCacheKey(params.identity)
    || record.objectKey !== thumbnailObjectKey(record.manifest)) rejectThumbnail("THUMBNAIL_CACHE_BINDING_MISMATCH");
  const now = params.now();
  if (!Number.isSafeInteger(now) || now < 0 || record.expiresAtMs - now > THUMBNAIL_RUNTIME_LIMITS.maxCacheLifetimeMs) rejectThumbnail("THUMBNAIL_CACHE_INVALID");
  if (record.expiresAtMs <= now) return null;
  const bytes = await collectThumbnailBytes(await params.store.open(record, params.signal), record.manifest.byteLength, params.signal);
  const manifest = await verifyThumbnailSprite({ ...params, manifest: record.manifest, bytes });
  if (record.expiresAtMs <= params.now()) rejectThumbnail("THUMBNAIL_CACHE_EXPIRED");
  return { manifest, bytes };
}

/** Authorized private-byte delivery. No source paths/signed URLs or persistent permission from cache hits. */
export async function readAuthorizedThumbnail(params: {
  access: ThumbnailAccess; identity: ThumbnailSpriteIdentity; authority: ThumbnailAuthority;
  store: ThumbnailStore; inspector: ThumbnailSpriteInspector; signal: AbortSignal; now?: () => number;
}) {
  return withThumbnailDeadline(params.signal, async (signal) => {
    const identity = thumbnailSpriteIdentitySchema.parse(params.identity);
    const source = await resolveThumbnailSource(params.authority, params.access, identity, signal);
    const result = await readThumbnailCache({ ...params, identity, signal, now: params.now ?? Date.now });
    await recheckThumbnailSource(params.authority, source, identity, signal);
    requireThumbnailActive(signal);
    return result;
  });
}
