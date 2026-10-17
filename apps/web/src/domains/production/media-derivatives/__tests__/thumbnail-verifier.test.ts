import assert from "node:assert/strict";
import test from "node:test";
import { THUMBNAIL_POLICY } from "../thumbnail-derivative.contract";
import { collectThumbnailBytes, inspectThumbnailWebpHeader, thumbnailObjectKey, thumbnailPageRecipe,
  thumbnailSha256, verifyThumbnailSprite } from "../thumbnail-verifier.server";
import { withThumbnailDeadline } from "../thumbnail-runtime.contract";
import { headerFixture, identity, otherTenant, signal, spriteFixture, stream } from "./thumbnail-fixtures";

test("page recipe reuses exact V1 timing, tail and fixed cells", () => {
  const recipe = thumbnailPageRecipe(identity);
  assert.equal(recipe.width, 1280); assert.equal(recipe.height, 180);
  assert.deepEqual(recipe.timestampsMs, Array.from({ length: 9 }, (_, i) => 10_000 + i * 250));
});

test("verifier hashes real bytes, checks header and requires separate full-decode port", async () => {
  const fixture = spriteFixture(); let inspected = 0;
  const manifest = await verifyThumbnailSprite({ ...fixture, identity, signal: signal(), inspector: {
    inspectSprite: async () => { inspected++; return { mimeType: "image/webp", width: 1280, height: 180, frameCount: 1 }; },
  } });
  assert.equal(manifest.spriteSha256, thumbnailSha256(fixture.bytes)); assert.equal(inspected, 1);
});

test("altered bytes (same size), wrong tenant, geometry and malformed manifest rejected before decode", async () => {
  const original = spriteFixture(); const altered = Uint8Array.from(original.bytes); altered[24] ^= 1;
  let inspected = 0;
  const inspector = { inspectSprite: async () => { inspected++; return { mimeType: "image/webp" as const, width: 1280, height: 180, frameCount: 1 as const }; } };
  for (const change of [
    { ...original, bytes: altered },
    { ...original, bytes: original.bytes.subarray(1) },
    { ...original, manifest: { ...original.manifest, width: 1 } },
    { ...original, manifest: { ...original.manifest, sourceTimestampsMs: [0] } },
    { ...original, manifest: { ...original.manifest, identity: { ...identity, source: { ...identity.source, organizationId: otherTenant } } } },
  ]) await assert.rejects(verifyThumbnailSprite({ ...change, identity, inspector, signal: signal() }), /THUMBNAIL_/);
  assert.equal(inspected, 0);
});

test("header rejects HTML, animation/extended WebP, truncated RIFF, trailing data and bad padding", () => {
  const original = spriteFixture().bytes;
  const variants = [Buffer.from("<html>not a sprite</html>"), original.subarray(0, 24), Buffer.concat([original, Buffer.from([0])])];
  for (const chunk of ["VP8X", "ANIM", "ANMF", "EXIF"]) {
    const bytes = Buffer.from(original); bytes.write(chunk, 12); variants.push(bytes);
  }
  const badPadding = Buffer.from(original); badPadding[25] = 1; variants.push(badPadding);
  for (const bytes of variants) {
    assert.throws(() => inspectThumbnailWebpHeader(bytes), /THUMBNAIL_WEBP_INVALID/);
  }
  assert.deepEqual(inspectThumbnailWebpHeader(headerFixture(160, 90)), { width: 160, height: 90 });
});

test("full-decode failure, wrong geometry and mutation by inspector never authorize a sprite", async () => {
  const fixture = spriteFixture();
  for (const inspectSprite of [
    async () => { throw new Error("decode failed in fixture port"); },
    async () => ({ mimeType: "image/webp" as const, width: 160, height: 90, frameCount: 1 as const }),
    async (bytes: Uint8Array) => { bytes[24] ^= 1; return { mimeType: "image/webp" as const, width: 1280, height: 180, frameCount: 1 as const }; },
  ]) await assert.rejects(verifyThumbnailSprite({ ...fixture, bytes: Uint8Array.from(fixture.bytes), identity,
    inspector: { inspectSprite }, signal: signal() }));
});

test("stream limits enforced while consuming, cancellation closes iterator, empty streams rejected", async () => {
  let closed = false;
  async function* tooLarge() { try { yield Buffer.alloc(10); yield Buffer.alloc(11); } finally { closed = true; } }
  await assert.rejects(collectThumbnailBytes(tooLarge(), 20, signal()), /THUMBNAIL_BYTES_LIMIT/);
  assert.equal(closed, true);
  async function* empty() {}
  await assert.rejects(collectThumbnailBytes(empty(), 20, signal()), /THUMBNAIL_BYTES_EMPTY/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(collectThumbnailBytes(stream(Buffer.from([1])), 20, aborted.signal), /THUMBNAIL_CANCELLED/);
  await assert.rejects(collectThumbnailBytes(stream(Buffer.alloc(0)), 20, signal()), /THUMBNAIL_BYTES_INVALID/);
  assert.equal((await collectThumbnailBytes(stream(Buffer.alloc(20)), 20, signal())).length, 20);
});

test("object path is generated from tenant/full identity/output digest, never caller text", () => {
  const original = spriteFixture().manifest;
  assert.match(thumbnailObjectKey(original), /^organizations\/11111111-1111-4111-8111-111111111111\/media-derivatives\/thumbnails\/v1\/[a-f0-9]{64}\/[a-f0-9]{64}\.webp$/);
  assert.notEqual(thumbnailObjectKey(original), thumbnailObjectKey({ ...original,
    identity: { ...identity, interval: { ...identity.interval, sourceOffsetMs: 11_000 } } }));
  assert.equal(THUMBNAIL_POLICY.maxSpriteBytes, 8 * 1024 * 1024);
});

test("deadline settles noncooperative dependencies and propagates AbortSignal without asserting containment", async () => {
  let runtimeSignal: AbortSignal | undefined;
  await assert.rejects(withThumbnailDeadline(signal(), async (active) => {
    runtimeSignal = active; return new Promise<never>(() => {});
  }, 10), /THUMBNAIL_TIMEOUT/);
  assert.equal(runtimeSignal?.aborted, true);
  const parent = new AbortController();
  const pending = withThumbnailDeadline(parent.signal, async () => new Promise<never>(() => {}));
  parent.abort(); await assert.rejects(pending, /THUMBNAIL_CANCELLED/);
});
