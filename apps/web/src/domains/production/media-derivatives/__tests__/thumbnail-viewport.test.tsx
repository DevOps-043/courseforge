import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadThumbnailViewport, type ThumbnailViewportResources } from "../thumbnail-viewport.client";
import { ThumbnailViewportStrip, ThumbnailViewportTiles } from "../ThumbnailViewportStrip";
import { planThumbnailSprites } from "../thumbnail-plan.service";
import { thumbnailSha256 } from "../thumbnail-verifier.server";
import { input, otherTenant, signal, spriteFixture } from "./thumbnail-fixtures";

function resourcesHarness() {
  const created: string[] = []; const revoked: string[] = [];
  const resources: ThumbnailViewportResources = { sha256: async (bytes) => thumbnailSha256(bytes),
    create: () => { const url = `blob:contract-fixture-${created.length}`; created.push(url); return url; },
    revoke: (url) => { revoked.push(url); } };
  return { resources, created, revoked };
}

test("viewport consumes planner priority, bounds simultaneous reads and releases each URL exactly once", async () => {
  const r = resourcesHarness(); const expanded = { ...input, interval: { ...input.interval, durationMs: 90_000 },
    viewport: { ...input.viewport, endMs: 20_000 }, playheadMs: 18_000 };
  const original = structuredClone(expanded);
  let inFlight = 0; let maximum = 0; const order: number[] = [];
  const viewport = await loadThumbnailViewport({ input: expanded, signal: signal(), resources: r.resources,
    load: async (identity) => {
      order.push(identity.pageIndex); inFlight++; maximum = Math.max(maximum, inFlight);
      await new Promise<void>((resolve) => setImmediate(resolve)); inFlight--;
      return spriteFixture(identity);
    } });
  assert.deepEqual(order, [1, 0]); assert.equal(maximum, 2); assert.equal(viewport.plan.tiles.length, 80);
  assert.equal(viewport.pages.size, 2); assert.deepEqual(expanded, original);
  viewport.dispose(); viewport.dispose(); assert.deepEqual(r.revoked.sort(), r.created.sort()); assert.equal(viewport.pages.size, 0);
});

test("viewport outside clip requires no network or resources; missing sprites remain explicit", async () => {
  const r = resourcesHarness(); let reads = 0;
  const outside = { ...input, viewport: { ...input.viewport, startMs: 90_000, endMs: 100_000 } };
  const empty = await loadThumbnailViewport({ input: outside, resources: r.resources, signal: signal(), load: async () => { reads++; return null; } });
  assert.equal(reads, 0); assert.equal(empty.plan.tiles.length, 0); empty.dispose();
  const missing = await loadThumbnailViewport({ input, resources: r.resources, signal: signal(), load: async () => null });
  assert.equal(missing.missing.length, 1); assert.equal(missing.pages.size, 0); assert.equal(r.created.length, 0);
});

test("client rejects cross-tenant manifests and altered bytes before making object URLs", async () => {
  for (const result of [
    spriteFixture({ ...planThumbnailSprites(input).pages[0].identity, source: { ...input.source, organizationId: otherTenant } }),
    { ...spriteFixture(), bytes: new Uint8Array(spriteFixture().bytes.length) },
    { ...spriteFixture(), bytes: new Uint8Array(8 * 1024 * 1024 + 1) },
  ]) {
    const r = resourcesHarness();
    await assert.rejects(loadThumbnailViewport({ input, signal: signal(), resources: r.resources, load: async () => result }), /THUMBNAIL_IDENTITY_MISMATCH|THUMBNAIL_INTEGRITY_MISMATCH/);
    assert.equal(r.created.length, 0);
  }
});

test("abort while awaiting noncooperative loader settles caller and ignores late data", async () => {
  const r = resourcesHarness(); const controller = new AbortController(); let release: (() => void) | undefined;
  let markStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const pending = loadThumbnailViewport({ input, signal: controller.signal, resources: r.resources,
    load: async (identity) => {
      markStarted(); await new Promise<void>((done) => { release = done; }); return spriteFixture(identity);
    } });
  await started; controller.abort(); await assert.rejects(pending, /THUMBNAIL_CANCELLED/); release!();
  await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(r.created.length, 0);
});

test("partial failure frees previously allocated images and aborts remaining reads", async () => {
  const r = resourcesHarness(); const expanded = { ...input, interval: { ...input.interval, durationMs: 90_000 },
    viewport: { ...input.viewport, endMs: 20_000 } };
  let firstReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => { firstReady = resolve; });
  const create = r.resources.create; r.resources.create = (bytes) => { const url = create(bytes); firstReady(); return url; };
  await assert.rejects(loadThumbnailViewport({ input: expanded, signal: signal(), resources: r.resources,
    load: async (identity) => {
      if (identity.pageIndex === 0) return spriteFixture(identity);
      await ready; throw new Error("reader unavailable");
    } }), /reader unavailable/);
  assert.equal(r.created.length, 1); assert.deepEqual(r.revoked, r.created);
});

test("planner budgets reject excessive viewport before invoking the loader", async () => {
  let reads = 0;
  await assert.rejects(loadThumbnailViewport({ input: { ...input,
    source: { ...input.source, sourceDurationMs: 3_600_000 }, interval: { sourceOffsetMs: 0, durationMs: 3_600_000 },
    viewport: { startMs: 0, endMs: 3_600_000, pixelsPerSecond: 640 } }, signal: signal(),
    load: async () => { reads++; return null; } }), /THUMBNAIL_VISIBLE_BUDGET_EXCEEDED/);
  assert.equal(reads, 0);
});

test("isolated React views render loading/missing states and exact sprite cells without links or document mutation", async () => {
  const original = structuredClone(input);
  const initial = renderToStaticMarkup(<ThumbnailViewportStrip input={input} accessKey="actor:tenant:component:asset:epoch"
    load={async () => spriteFixture()} />);
  assert.match(initial, /data-thumbnail-state="loading"/); assert.doesNotMatch(initial, /background-image/);
  const r = resourcesHarness(); const viewport = await loadThumbnailViewport({ input, signal: signal(), resources: r.resources, load: async () => spriteFixture() });
  const rendered = renderToStaticMarkup(<ThumbnailViewportTiles input={input} viewport={viewport} />);
  assert.match(rendered, /aria-hidden="true"/); assert.match(rendered, /pointer-events:none/);
  assert.match(rendered, /background-position:-0px -90px/); assert.match(rendered, /width:0.64px/);
  assert.equal((rendered.match(/<span /g) ?? []).length, 9); assert.doesNotMatch(rendered, /<a |https:|sourceAssetId/);
  assert.deepEqual(input, original); viewport.dispose();
});
