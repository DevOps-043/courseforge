import { z } from "zod";

export const THUMBNAIL_POLICY = {
  version: 1,
  profile: "THUMBNAIL_SPRITE_160X90_V1",
  tileWidth: 160,
  tileHeight: 90,
  columns: 8,
  tilesPerSprite: 64,
  maxVisibleTiles: 512,
  maxSourceDurationMs: 3_600_000,
  lodStepsMs: [250, 1_000, 4_000, 16_000, 64_000, 256_000, 1_024_000, 4_096_000],
  maxSpriteBytes: 8 * 1024 * 1024,
} as const;

const millisecondsSchema = z.number().int().min(0).max(THUMBNAIL_POLICY.maxSourceDurationMs);
export const thumbnailSourceIdentitySchema = z.object({
  organizationId: z.string().uuid(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceDurationMs: millisecondsSchema.refine((value) => value > 0),
}).strict();

export const thumbnailIntervalSchema = z.object({
  sourceOffsetMs: millisecondsSchema,
  durationMs: millisecondsSchema.refine((value) => value > 0),
}).strict();

export const thumbnailSpriteIdentitySchema = z.object({
  contractVersion: z.literal(1),
  profile: z.literal(THUMBNAIL_POLICY.profile),
  source: thumbnailSourceIdentitySchema,
  interval: thumbnailIntervalSchema,
  stepMs: z.number().int().refine((value) => THUMBNAIL_POLICY.lodStepsMs.some((step) => step === value)),
  pageIndex: z.number().int().min(0).max(Math.ceil(
    THUMBNAIL_POLICY.maxSourceDurationMs / THUMBNAIL_POLICY.lodStepsMs[0] / THUMBNAIL_POLICY.tilesPerSprite,
  ) - 1),
}).strict().superRefine((identity, context) => {
  if (identity.interval.sourceOffsetMs + identity.interval.durationMs > identity.source.sourceDurationMs) {
    context.addIssue({ code: "custom", message: "THUMBNAIL_SOURCE_INTERVAL_EXCEEDED" });
  }
  const count = Math.ceil(identity.interval.durationMs / identity.stepMs);
  if (identity.pageIndex * THUMBNAIL_POLICY.tilesPerSprite >= count) {
    context.addIssue({ code: "custom", message: "THUMBNAIL_PAGE_OUT_OF_RANGE" });
  }
});

export type ThumbnailSpriteIdentity = z.infer<typeof thumbnailSpriteIdentitySchema>;

/** An identity, not an authorization token or a path supplied by a caller. */
export function thumbnailSpriteCacheKey(input: ThumbnailSpriteIdentity): string {
  const identity = thumbnailSpriteIdentitySchema.parse(input);
  return ["thumbnail", identity.contractVersion, identity.source.organizationId,
    identity.source.sourceSha256, identity.source.sourceDurationMs, identity.profile,
    identity.interval.sourceOffsetMs, identity.interval.durationMs, identity.stepMs, identity.pageIndex].join(":");
}

export const thumbnailSpriteManifestSchema = z.object({
  identity: thumbnailSpriteIdentitySchema,
  spriteSha256: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.literal("image/webp"),
  byteLength: z.number().int().positive().max(THUMBNAIL_POLICY.maxSpriteBytes),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sourceTimestampsMs: z.array(millisecondsSchema).min(1).max(THUMBNAIL_POLICY.tilesPerSprite),
}).strict().superRefine((manifest, context) => {
  const { identity } = manifest;
  const firstIndex = identity.pageIndex * THUMBNAIL_POLICY.tilesPerSprite;
  const count = Math.min(THUMBNAIL_POLICY.tilesPerSprite,
    Math.ceil(identity.interval.durationMs / identity.stepMs) - firstIndex);
  if (manifest.sourceTimestampsMs.length !== count
    || manifest.sourceTimestampsMs.some((timestamp, index) =>
      timestamp !== identity.interval.sourceOffsetMs + (firstIndex + index) * identity.stepMs)) {
    context.addIssue({ code: "custom", message: "THUMBNAIL_TIMESTAMPS_MISMATCH" });
  }
  if (manifest.width !== THUMBNAIL_POLICY.columns * THUMBNAIL_POLICY.tileWidth
    || manifest.height !== Math.ceil(count / THUMBNAIL_POLICY.columns) * THUMBNAIL_POLICY.tileHeight) {
    context.addIssue({ code: "custom", message: "THUMBNAIL_SPRITE_GEOMETRY_MISMATCH" });
  }
});
