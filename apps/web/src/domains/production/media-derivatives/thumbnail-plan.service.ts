import { z } from "zod";
import { THUMBNAIL_POLICY, thumbnailIntervalSchema, thumbnailSourceIdentitySchema,
  thumbnailSpriteCacheKey, type ThumbnailSpriteIdentity } from "./thumbnail-derivative.contract";

const planInputSchema = z.object({
  source: thumbnailSourceIdentitySchema,
  interval: thumbnailIntervalSchema,
  viewport: z.object({
    startMs: z.number().int().min(0).max(THUMBNAIL_POLICY.maxSourceDurationMs),
    endMs: z.number().int().positive().max(THUMBNAIL_POLICY.maxSourceDurationMs),
    pixelsPerSecond: z.number().finite().positive().max(100_000),
  }).strict(),
  playheadMs: z.number().int().min(0).max(THUMBNAIL_POLICY.maxSourceDurationMs),
}).strict().superRefine((input, context) => {
  if (input.interval.sourceOffsetMs + input.interval.durationMs > input.source.sourceDurationMs) {
    context.addIssue({ code: "custom", message: "THUMBNAIL_SOURCE_INTERVAL_EXCEEDED" });
  }
  if (input.viewport.endMs <= input.viewport.startMs) {
    context.addIssue({ code: "custom", message: "THUMBNAIL_VIEWPORT_INVALID" });
  }
});

export type ThumbnailPlanInput = z.infer<typeof planInputSchema>;
export class ThumbnailPlanError extends Error {
  constructor(readonly code: "THUMBNAIL_PLAN_INVALID" | "THUMBNAIL_VISIBLE_BUDGET_EXCEEDED") {
    super(code);
  }
}

/** Clip-relative viewport; source timestamps remain absolute. No decoding or proxy selection. */
export function planThumbnailSprites(rawInput: ThumbnailPlanInput) {
  const parsed = planInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new ThumbnailPlanError("THUMBNAIL_PLAN_INVALID");
  const input = parsed.data;
  const requiredStepMs = THUMBNAIL_POLICY.tileWidth * 1_000 / input.viewport.pixelsPerSecond;
  const stepMs = THUMBNAIL_POLICY.lodStepsMs.find((step) => step >= requiredStepMs)
    ?? THUMBNAIL_POLICY.lodStepsMs[THUMBNAIL_POLICY.lodStepsMs.length - 1];
  const totalTileCount = Math.ceil(input.interval.durationMs / stepMs);
  const visibleEndMs = Math.min(input.interval.durationMs, input.viewport.endMs);
  const firstIndex = Math.floor(input.viewport.startMs / stepMs);
  const lastIndexExclusive = Math.min(totalTileCount, Math.ceil(visibleEndMs / stepMs));
  const visibleCount = Math.max(0, lastIndexExclusive - firstIndex);
  if (visibleCount > THUMBNAIL_POLICY.maxVisibleTiles) {
    throw new ThumbnailPlanError("THUMBNAIL_VISIBLE_BUDGET_EXCEEDED");
  }
  const pages = new Map<number, { identity: ThumbnailSpriteIdentity; cacheKey: string; priorityDistanceMs: number }>();
  const tiles = Array.from({ length: visibleCount }, (_, visibleIndex) => {
    const index = firstIndex + visibleIndex;
    const startMs = index * stepMs;
    const endMs = Math.min(input.interval.durationMs, startMs + stepMs);
    const pageIndex = Math.floor(index / THUMBNAIL_POLICY.tilesPerSprite);
    const pageTileIndex = index % THUMBNAIL_POLICY.tilesPerSprite;
    const distance = input.playheadMs < startMs ? startMs - input.playheadMs
      : input.playheadMs >= endMs ? input.playheadMs - endMs : 0;
    let page = pages.get(pageIndex);
    if (!page) {
      const identity: ThumbnailSpriteIdentity = { contractVersion: 1, profile: THUMBNAIL_POLICY.profile,
        source: input.source, interval: input.interval, stepMs, pageIndex };
      page = { identity, cacheKey: thumbnailSpriteCacheKey(identity), priorityDistanceMs: distance };
      pages.set(pageIndex, page);
    } else page.priorityDistanceMs = Math.min(page.priorityDistanceMs, distance);
    return { index, startMs, endMs, sourceTimestampMs: input.interval.sourceOffsetMs + startMs,
      cacheKey: page.cacheKey, x: (pageTileIndex % THUMBNAIL_POLICY.columns) * THUMBNAIL_POLICY.tileWidth,
      y: Math.floor(pageTileIndex / THUMBNAIL_POLICY.columns) * THUMBNAIL_POLICY.tileHeight };
  });
  return { contractVersion: 1 as const, stepMs, totalTileCount, tiles,
    pages: [...pages.values()].sort((left, right) => left.priorityDistanceMs - right.priorityDistanceMs
      || left.identity.pageIndex - right.identity.pageIndex) };
}
