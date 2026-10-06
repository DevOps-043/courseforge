import assert from "node:assert/strict";
import test from "node:test";
import { planThumbnailSprites, ThumbnailPlanError, type ThumbnailPlanInput } from "../thumbnail-plan.service";
import { thumbnailSpriteCacheKey, thumbnailSpriteManifestSchema } from "../thumbnail-derivative.contract";

const input: ThumbnailPlanInput = {
  source: { organizationId: "11111111-1111-4111-8111-111111111111", sourceSha256: "a".repeat(64), sourceDurationMs: 120_000 },
  interval: { sourceOffsetMs: 10_000, durationMs: 90_000 },
  viewport: { startMs: 0, endMs: 20_000, pixelsPerSecond: 640 },
  playheadMs: 18_000,
};

test("plan uses source offsets, half-open viewport and sprite cells", () => {
  const plan = planThumbnailSprites(input);
  assert.equal(plan.stepMs, 250);
  assert.equal(plan.totalTileCount, 360);
  assert.equal(plan.tiles.length, 80);
  assert.equal(plan.tiles[0].sourceTimestampMs, 10_000);
  assert.equal(plan.tiles[79].sourceTimestampMs, 29_750);
  assert.equal(plan.tiles[8].x, 0);
  assert.equal(plan.tiles[8].y, 90);
  assert.equal(plan.tiles[64].y, 0);
  assert.deepEqual(plan.pages.map((page) => page.identity.pageIndex), [1, 0]);
});

test("zoom changes LOD without changing source offset or duration", () => {
  const plan = planThumbnailSprites({ ...input, viewport: { ...input.viewport, pixelsPerSecond: 40 } });
  assert.equal(plan.stepMs, 4_000);
  assert.deepEqual(plan.tiles.map((tile) => tile.sourceTimestampMs), [10_000, 14_000, 18_000, 22_000, 26_000]);
  assert.deepEqual(plan.pages[0].identity.interval, input.interval);
});

test("partial tile covers viewport left edge and source tail never samples EOF", () => {
  const plan = planThumbnailSprites({ ...input, interval: { sourceOffsetMs: 119_501, durationMs: 499 },
    viewport: { ...input.viewport, startMs: 100, endMs: 1_000 } });
  assert.deepEqual(plan.tiles.map((tile) => [tile.startMs, tile.endMs, tile.sourceTimestampMs]),
    [[0, 250, 119_501], [250, 499, 119_751]]);
});

test("viewport outside clip produces no work and input remains unchanged", () => {
  const original = structuredClone(input);
  const plan = planThumbnailSprites({ ...input, viewport: { ...input.viewport, startMs: 90_000, endMs: 100_000 } });
  assert.equal(plan.tiles.length, 0);
  assert.equal(plan.pages.length, 0);
  assert.deepEqual(input, original);
  assert.deepEqual(planThumbnailSprites(input), planThumbnailSprites(input));
});

test("identity invalidates for tenant, bytes, duration, interval, LOD and page", () => {
  const identity = planThumbnailSprites(input).pages[0].identity;
  const key = thumbnailSpriteCacheKey(identity);
  for (const changed of [
    { ...identity, source: { ...identity.source, organizationId: "22222222-2222-4222-8222-222222222222" } },
    { ...identity, source: { ...identity.source, sourceSha256: "b".repeat(64) } },
    { ...identity, source: { ...identity.source, sourceDurationMs: 130_000 } },
    { ...identity, interval: { ...identity.interval, sourceOffsetMs: 11_000 } },
    { ...identity, interval: { ...identity.interval, durationMs: 89_000 } },
    { ...identity, stepMs: 1_000 },
    { ...identity, pageIndex: 0 },
  ]) assert.notEqual(thumbnailSpriteCacheKey(changed), key);
});

test("malformed values, source overrun and unknown fields fail explicitly", () => {
  for (const changed of [
    { ...input, interval: { sourceOffsetMs: 119_000, durationMs: 2_000 } },
    { ...input, viewport: { ...input.viewport, pixelsPerSecond: Number.NaN } },
    { ...input, viewport: { ...input.viewport, pixelsPerSecond: 0 } },
    { ...input, viewport: { ...input.viewport, startMs: 1_000, endMs: 1_000 } },
    { ...input, interval: { ...input.interval, sourceOffsetMs: -1 } },
    { ...input, interval: { ...input.interval, durationMs: 0.5 } },
    { ...input, source: { ...input.source, sourceSha256: "../source" } },
    { ...input, source: { ...input.source, url: "https://untrusted.invalid" } },
  ]) assert.throws(() => planThumbnailSprites(changed), (error: unknown) =>
    error instanceof ThumbnailPlanError && error.code === "THUMBNAIL_PLAN_INVALID");
});

test("visible allocation is bounded before building tiles", () => {
  assert.throws(() => planThumbnailSprites({ ...input,
    source: { ...input.source, sourceDurationMs: 3_600_000 },
    interval: { sourceOffsetMs: 0, durationMs: 3_600_000 },
    viewport: { startMs: 0, endMs: 3_600_000, pixelsPerSecond: 640 } }),
  (error: unknown) => error instanceof ThumbnailPlanError && error.code === "THUMBNAIL_VISIBLE_BUDGET_EXCEEDED");
});

test("sprite manifest validates complete page timestamps, geometry and bounded bytes", () => {
  const identity = planThumbnailSprites(input).pages[0].identity;
  const manifest = { identity, spriteSha256: "c".repeat(64), mimeType: "image/webp", byteLength: 100,
    width: 1_280, height: 720, sourceTimestampsMs: Array.from({ length: 64 }, (_, index) => 26_000 + index * 250) };
  assert.equal(thumbnailSpriteManifestSchema.safeParse(manifest).success, true);
  for (const changed of [
    { ...manifest, sourceTimestampsMs: [...manifest.sourceTimestampsMs].reverse() },
    { ...manifest, sourceTimestampsMs: manifest.sourceTimestampsMs.slice(1) },
    { ...manifest, width: 160 },
    { ...manifest, byteLength: 8 * 1024 * 1024 + 1 },
    { ...manifest, url: "https://untrusted.invalid" },
    { ...manifest, identity: { ...identity, pageIndex: 225 } },
  ]) assert.equal(thumbnailSpriteManifestSchema.safeParse(changed).success, false);
});

test("last partial sprite has only allocated rows and exact remaining timestamps", () => {
  const plan = planThumbnailSprites({ ...input, interval: { sourceOffsetMs: 10_000, durationMs: 2_001 } });
  const identity = plan.pages[0].identity;
  assert.equal(thumbnailSpriteManifestSchema.safeParse({ identity, spriteSha256: "c".repeat(64),
    mimeType: "image/webp", byteLength: 100, width: 1_280, height: 180,
    sourceTimestampsMs: Array.from({ length: 9 }, (_, index) => 10_000 + index * 250) }).success, true);
});
