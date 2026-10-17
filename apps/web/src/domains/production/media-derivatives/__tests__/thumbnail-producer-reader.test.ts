import assert from "node:assert/strict";
import test from "node:test";
import { produceThumbnailSprite } from "../thumbnail-producer.server";
import { readAuthorizedThumbnail } from "../thumbnail-reader.server";
import { THUMBNAIL_RUNTIME_LIMITS, thumbnailAuthorizedSourceSchema } from "../thumbnail-runtime.contract";
import { thumbnailObjectKey, thumbnailSha256 } from "../thumbnail-verifier.server";
import { access, harness, identity, otherTenant, signal, sourceBytes, spriteFixture, stream } from "./thumbnail-fixtures";

function producer(h: ReturnType<typeof harness>) {
  return { access, identity, authority: h.authority, runtime: h.runtime, store: h.store, signal: signal(), now: () => 1_000 };
}
function reader(h: ReturnType<typeof harness>) {
  return { access, identity, authority: h.authority, inspector: h.runtime, store: h.store, signal: signal(), now: () => 1_000 };
}

test("producer verifies source and readback, reuses cache without decoding source, reader reauthorizes every hit", async () => {
  const h = harness(); const original = structuredClone(identity); const sourceCopy = Buffer.from(sourceBytes);
  const generated = await produceThumbnailSprite(producer(h));
  assert.equal(generated.cacheHit, false); assert.equal(h.calls.written, 1);
  const resolvedBefore = h.calls.resolved;
  const cached = await produceThumbnailSprite(producer(h));
  assert.equal(cached.cacheHit, true);
  const delivered = await readAuthorizedThumbnail(reader(h));
  assert.equal(delivered?.manifest.spriteSha256, generated.manifest.spriteSha256);
  assert.equal(h.calls.generated, 1); assert.equal(h.calls.opened, 1);
  assert.ok(h.calls.resolved >= resolvedBefore + 4);
  assert.deepEqual(identity, original); assert.deepEqual(sourceBytes, sourceCopy);
  assert.deepEqual(Object.keys(delivered!).sort(), ["bytes", "manifest"]);
});

test("tenant mismatch cannot consult cache or open source, even with a known identity", async () => {
  const h = harness();
  await assert.rejects(readAuthorizedThumbnail({ ...reader(h), access: { ...access, organizationId: otherTenant } }), /THUMBNAIL_ACCESS_DENIED/);
  await assert.rejects(produceThumbnailSprite({ ...producer(h), access: { ...access, organizationId: otherTenant } }), /THUMBNAIL_ACCESS_DENIED/);
  assert.equal(h.calls.cacheRead, 0); assert.equal(h.calls.opened, 0); assert.equal(h.calls.generated, 0);
});

test("server authority must match actor, component, asset and tenant independently of cache key", async () => {
  for (const field of ["actorId", "organizationId", "componentId", "sourceAssetId"] as const) {
    const h = harness(); h.changeSource({ [field]: otherTenant });
    await assert.rejects(readAuthorizedThumbnail(reader(h)), /THUMBNAIL_ACCESS_DENIED/);
    assert.equal(h.calls.cacheRead, 0);
  }
});

test("changed source hash/duration/status invalidates cached authorization without reading bytes", async () => {
  for (const changed of [{ sourceSha256: "f".repeat(64) }, { sourceDurationMs: 119_000 }]) {
    const h = harness(); await produceThumbnailSprite(producer(h)); h.changeSource(changed);
    await assert.rejects(readAuthorizedThumbnail(reader(h)), /THUMBNAIL_SOURCE_CHANGED/);
  }
  const h = harness(); h.authority.resolve = async () => null;
  await assert.rejects(readAuthorizedThumbnail(reader(h)), /THUMBNAIL_ACCESS_DENIED/);
});

test("tampered source bytes and truncated/oversize downloads fail before any source probe/decoder", async () => {
  for (const bytes of [Buffer.from(sourceBytes).fill(1), sourceBytes.subarray(0, sourceBytes.length - 1), Buffer.alloc(sourceBytes.length + 1)]) {
    const h = harness(); h.authority.open = async () => stream(bytes);
    await assert.rejects(produceThumbnailSprite(producer(h)), /THUMBNAIL_SOURCE_INTEGRITY_MISMATCH|THUMBNAIL_BYTES_LIMIT/);
    assert.equal(h.calls.probed, 0); assert.equal(h.calls.generated, 0); assert.equal(h.calls.written, 0);
  }
});

test("source admission bounds size, decoded pixels, MIME and arbitrary transport fields", () => {
  const valid = harness().source();
  for (const changed of [{ byteLength: THUMBNAIL_RUNTIME_LIMITS.maxSourceBytes + 1 }, { width: 16_384, height: 16_384 },
    { mimeType: "text/html" }, { url: "https://untrusted.invalid" }, { byteLength: 0 }, { sourceDurationMs: 3_600_001 }]) {
    assert.equal(thumbnailAuthorizedSourceSchema.safeParse({ ...valid, ...changed }).success, false);
  }
});

test("probe must measure all source metadata and production timestamps must match the planned samples", async () => {
  for (const changed of [{ durationMs: 120_001 }, { mimeType: "video/webm" as const }, { width: 1280 }, { height: 720 }]) {
    const h = harness(); const probe = h.runtime.probeSource;
    h.runtime.probeSource = async (bytes, active) => ({ ...await probe(bytes, active), ...changed });
    await assert.rejects(produceThumbnailSprite(producer(h)), /THUMBNAIL_SOURCE_PROBE_MISMATCH/);
    assert.equal(h.calls.generated, 0); assert.equal(h.calls.written, 0);
  }
  const h = harness(); const generate = h.runtime.generateSprite;
  h.runtime.generateSprite = async (request) => ({ ...await generate(request), sourceTimestampsMs: [...request.timestampsMs].reverse() });
  await assert.rejects(produceThumbnailSprite(producer(h)), /THUMBNAIL_MANIFEST_INVALID/);
  assert.equal(h.calls.written, 0);
});

test("runtime mutation of source buffer is detected and original bytes remain untouched", async () => {
  const h = harness(); const generate = h.runtime.generateSprite; const original = Buffer.from(sourceBytes);
  h.runtime.generateSprite = async (request) => { request.sourceBytes[0] ^= 1; return generate(request); };
  await assert.rejects(produceThumbnailSprite(producer(h)), /THUMBNAIL_SOURCE_INTEGRITY_MISMATCH/);
  assert.equal(h.calls.written, 0); assert.deepEqual(sourceBytes, original);
});

test("runtime receives copies of canonical identity, source metadata and sampling recipe", async () => {
  const h = harness(); const generate = h.runtime.generateSprite;
  h.runtime.generateSprite = async (request) => {
    const result = await generate(request);
    request.identity.interval.sourceOffsetMs = 11_000;
    request.source.componentId = otherTenant;
    (request.timestampsMs as number[])[0] = 0;
    return result;
  };
  const result = await produceThumbnailSprite(producer(h));
  assert.deepEqual(result.manifest.identity, identity);
  assert.equal(result.manifest.sourceTimestampsMs[0], 10_000);
  assert.equal(h.source().componentId, access.componentId);
});

test("cache tampering is detected on every reader request, even if size is unchanged", async () => {
  const h = harness(); await produceThumbnailSprite(producer(h));
  const row = [...h.records.values()][0]; row.bytes[24] ^= 1;
  await assert.rejects(readAuthorizedThumbnail(reader(h)), /THUMBNAIL_INTEGRITY_MISMATCH/);
  await assert.rejects(produceThumbnailSprite(producer(h)), /THUMBNAIL_INTEGRITY_MISMATCH/);
  assert.equal(h.calls.generated, 1);
});

test("cache index rejects cross-tenant bindings, caller paths, corrupt manifest and excessive TTL", async () => {
  for (const changed of [
    { objectKey: "../arbitrary" },
    { expiresAtMs: 1_001 + THUMBNAIL_RUNTIME_LIMITS.maxCacheLifetimeMs },
    { manifest: { ...spriteFixture().manifest, byteLength: 0 } },
    { manifest: { ...spriteFixture().manifest, identity: { ...identity, source: { ...identity.source, organizationId: otherTenant } } } },
  ]) {
    const h = harness(); const fixture = spriteFixture();
    h.store.lookup = async () => ({ manifest: fixture.manifest, objectKey: thumbnailObjectKey(fixture.manifest), expiresAtMs: 10_000, ...changed });
    await assert.rejects(readAuthorizedThumbnail(reader(h)), /THUMBNAIL_CACHE_/);
    assert.equal(h.calls.inspected, 0);
  }
});

test("expired entries are misses and never serve a stale authorization or bytes", async () => {
  const h = harness(); await produceThumbnailSprite(producer(h));
  [...h.records.values()][0].record.expiresAtMs = 1_000;
  const inspections = h.calls.inspected;
  assert.equal(await readAuthorizedThumbnail(reader(h)), null);
  assert.equal(h.calls.inspected, inspections);
  const bytesBefore = Uint8Array.from([...h.records.values()][0].bytes);
  const refreshed = await produceThumbnailSprite(producer(h));
  assert.equal(refreshed.cacheHit, false);
  assert.equal(h.calls.written, 1); // Index renewal does not overwrite the immutable object.
  assert.deepEqual([...h.records.values()][0].bytes, bytesBefore);
  assert.ok(await readAuthorizedThumbnail(reader(h)));
});

test("revocation during delivery blocks bytes and during generation blocks publication", async () => {
  const h = harness(); await produceThumbnailSprite(producer(h));
  const inspect = h.runtime.inspectSprite;
  h.runtime.inspectSprite = async (bytes, active) => {
    const result = await inspect(bytes, active); h.changeSource({ componentId: otherTenant }); return result;
  };
  await assert.rejects(readAuthorizedThumbnail(reader(h)), /THUMBNAIL_ACCESS_DENIED/);
  const p = harness(); const generate = p.runtime.generateSprite;
  p.runtime.generateSprite = async (request) => {
    const result = await generate(request); p.changeSource({ sourceSha256: "f".repeat(64) }); return result;
  };
  await assert.rejects(produceThumbnailSprite(producer(p)), /THUMBNAIL_SOURCE_CHANGED/);
  assert.equal(p.calls.written, 0);
});

test("cancelled generation discards late noncooperative output and cannot write cache", async () => {
  const h = harness(); const controller = new AbortController(); let release: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    h.runtime.generateSprite = async (request) => {
      resolve(); await new Promise<void>((done) => { release = done; });
      return { bytes: stream(spriteFixture().bytes), sourceTimestampsMs: [...request.timestampsMs] };
    };
  });
  const pending = produceThumbnailSprite({ ...producer(h), signal: controller.signal });
  await started; controller.abort(); await assert.rejects(pending, /THUMBNAIL_CANCELLED/);
  release!(); await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(h.calls.written, 0);
});

test("concurrent create-only publication is idempotent but does not claim scheduler/DB correctness", async () => {
  const h = harness();
  const results = await Promise.all([produceThumbnailSprite(producer(h)), produceThumbnailSprite(producer(h))]);
  assert.equal(h.calls.written, 1); assert.equal(h.records.size, 1);
  assert.equal(results[0].manifest.spriteSha256, results[1].manifest.spriteSha256);
  assert.equal(thumbnailSha256(results[0].bytes), results[0].manifest.spriteSha256);
});

test("publication readback is mandatory, rejects substitution and does not delete shared cache on lost ACK", async () => {
  const h = harness(); h.store.putCreateOnly = async () => {};
  await assert.rejects(produceThumbnailSprite(producer(h)), /THUMBNAIL_PUBLICATION_UNCONFIRMED/);
  const p = harness(); const put = p.store.putCreateOnly;
  p.store.putCreateOnly = async (record, bytes, active) => { await put(record, bytes, active); throw new Error("lost ack"); };
  await assert.rejects(produceThumbnailSprite(producer(p)), /lost ack/);
  assert.equal(p.records.size, 1);
  assert.equal((await produceThumbnailSprite(producer(p))).cacheHit, true);
});
