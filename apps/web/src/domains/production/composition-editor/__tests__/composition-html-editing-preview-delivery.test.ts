import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, unlink, rmdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { issueHtmlPreviewResourceCapability, verifyHtmlPreviewResourceCapability, type HtmlPreviewResourceClaims } from "../composition-html-editing-preview-capability.server";
import { createHtmlPreviewResourceResponse, parseHtmlPreviewResourceRange, HTML_PREVIEW_FILE_STREAM_POLICY } from "../composition-html-editing-preview-file-stream.server";
import { createHtmlPreviewResourceHandler } from "../http/composition-html-editing-preview-resource-handler.server";
import { createHtmlPreviewDeliveryBudget, HTML_PREVIEW_DELIVERY_BUDGET } from "../composition-html-editing-preview-delivery-budget.server";

const uuid = "11111111-1111-4111-8111-111111111111", audience = "https://app.example.test";
const key = new Uint8Array(32).fill(42);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const claims: HtmlPreviewResourceClaims = { format: "courseforge-html-preview-resource-v1", actorId: uuid,
  organizationId: uuid, documentId: uuid, session: { version: 1, nonce: "a".repeat(64), documentHash: "b".repeat(64), previewGeneration: 1 },
  audience, bundleSha256: "c".repeat(64), inventoryFingerprint: "d".repeat(64), localPath: `conformance-media/${uuid}`,
  checksum: "e".repeat(64), fileSizeBytes: 42, mimeType: "video/mp4", issuedAt: 100, expiresAt: 280 };

test("resource capability binds exact scope/session/inventory/content and expires without accepting forged or oversized claims", () => {
  const token = issueHtmlPreviewResourceCapability(claims, key);
  const verify = { token, key, audience, documentId: uuid, nowSeconds: 100 };
  assert.deepEqual(verifyHtmlPreviewResourceCapability(verify), claims);
  for (const changed of [{ token: token.replace(token[0]!, token[0] === "a" ? "b" : "a") },
    { key: new Uint8Array(32).fill(43) }, { nowSeconds: 99 }, { nowSeconds: 280 },
    { audience: "https://other.test" }, { documentId: "22222222-2222-4222-8222-222222222222" },
    { token: "x".repeat(4097) }, { token: token + ".extra" }, { key: new Uint8Array(31) }]) {
    assert.throws(() => verifyHtmlPreviewResourceCapability({ ...verify, ...changed }), /CAPABILITY_INVALID/);
  }
  for (const invalid of [{ ...claims, expiresAt: 999 }, { ...claims, localPath: "../private" },
    { ...claims, audience: audience + "/path" }, { ...claims, suppliedGrant: true }]) {
    assert.throws(() => issueHtmlPreviewResourceCapability(invalid as HtmlPreviewResourceClaims, key), /CAPABILITY_INVALID/);
  }
});

test("single byte ranges cover complete, open-ended and suffix reads and reject ambiguous/unsafe requests", () => {
  assert.deepEqual(parseHtmlPreviewResourceRange(null, 10), { start: 0, end: 9, partial: false });
  assert.deepEqual(parseHtmlPreviewResourceRange("bytes=2-4", 10), { start: 2, end: 4, partial: true });
  assert.deepEqual(parseHtmlPreviewResourceRange("bytes=2-", 10), { start: 2, end: 9, partial: true });
  assert.deepEqual(parseHtmlPreviewResourceRange("bytes=-3", 10), { start: 7, end: 9, partial: true });
  assert.deepEqual(parseHtmlPreviewResourceRange("bytes=2-99", 10), { start: 2, end: 9, partial: true });
  for (const range of ["bytes=", "bytes=-", "bytes=10-", "bytes=5-2", "bytes=-0", "bytes=0-1,3-4", "items=0-1", "bytes=9007199254740992-"]) {
    assert.throws(() => parseHtmlPreviewResourceRange(range, 10), /RANGE_INVALID/);
  }
});
async function privateFile(bytes: Uint8Array) {
  const directory = await mkdtemp(path.join(tmpdir(), "courseforge-html-delivery-test-")), filePath = path.join(directory, "resource.bin");
  await writeFile(filePath, bytes);
  let disposed = false;
  return { filePath, identity: { checksum: hash(bytes), fileSizeBytes: bytes.length, mimeType: "video/mp4",
    storageBucket: "production-assets", storagePath: "native/file.mp4" },
    scope: "BYTE_VERIFIED_PRIVATE_PREVIEW_FILE_NOT_DECODE_OR_RENDER_EVIDENCE" as const,
    readSmallBytes: async () => bytes,
    dispose: async () => { if (!disposed) { await unlink(filePath); await rmdir(directory); disposed = true; } },
  };
}
test("binary response verifies complete file before reauthorization and serves bounded seekable chunks with cleanup", async () => {
  const bytes = new Uint8Array(HTML_PREVIEW_FILE_STREAM_POLICY.chunkBytes * 2 + 3).fill(7), file = await privateFile(bytes);
  let authorized = 0;
  const response = await createHtmlPreviewResourceResponse({ file, range: "bytes=2-65540", beforeDelivery: async () => { authorized++; } });
  assert.equal(authorized, 1); assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), `bytes 2-65540/${bytes.length}`);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "null");
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
  const reader = response.body!.getReader(); let received = 0;
  while (true) { const next = await reader.read(); if (next.done) break;
    assert.ok(next.value.length <= HTML_PREVIEW_FILE_STREAM_POLICY.chunkBytes); received += next.value.length;
    assert.ok(next.value.every(byte => byte === 7)); }
  assert.equal(received, 65539);
  await assert.rejects(access(file.filePath), { code: "ENOENT" });
});
test("tampered spool, denied final authorization, consumer cancel and request abort dispose without partial success", async () => {
  const corrupt = await privateFile(new Uint8Array([1, 2, 3])); let grants = 0;
  await writeFile(corrupt.filePath, new Uint8Array([1, 2, 4]));
  await assert.rejects(createHtmlPreviewResourceResponse({ file: corrupt, range: "bytes=0-0", beforeDelivery: async () => { grants++; } }), /DELIVERY_UNAVAILABLE/);
  assert.equal(grants, 0); await assert.rejects(access(corrupt.filePath));
  const denied = await privateFile(new Uint8Array([1, 2, 3]));
  await assert.rejects(createHtmlPreviewResourceResponse({ file: denied, range: null, beforeDelivery: async () => { throw new Error("revoked"); } }), /DELIVERY_UNAVAILABLE/);
  await assert.rejects(access(denied.filePath));
  const cancelled = await privateFile(new Uint8Array(65537));
  const response = await createHtmlPreviewResourceResponse({ file: cancelled, range: null, beforeDelivery: async () => undefined });
  await response.body!.cancel(); await assert.rejects(access(cancelled.filePath));
  const aborted = await privateFile(new Uint8Array(65537)), controller = new AbortController();
  const pending = await createHtmlPreviewResourceResponse({ file: aborted, range: null, signal: controller.signal, beforeDelivery: async () => undefined });
  controller.abort(); await assert.rejects(pending.body!.getReader().read(), /DELIVERY_UNAVAILABLE/);
  for (let attempt = 0; attempt < 100; attempt++) { try { await access(aborted.filePath); } catch { break; } await new Promise(resolve => setTimeout(resolve, 5)); }
  await assert.rejects(access(aborted.filePath));
});

test("per-instance admission bounds simultaneous reads and disk bytes with idempotent releases", () => {
  const budget = createHtmlPreviewDeliveryBudget();
  const release = budget.reserve(HTML_PREVIEW_DELIVERY_BUDGET.privateDiskBytes);
  assert.throws(() => budget.reserve(1), /BACKPRESSURE/); release(); release();
  const releases = Array.from({ length: 4 }, () => budget.reserve(1));
  assert.throws(() => budget.reserve(1), /BACKPRESSURE/);
  releases.forEach(release => release()); assert.deepEqual(budget.state(), { reads: 0, bytes: 0 });
});

test("resource HTTP boundary validates capability before privileged client, applies shared quotas and rejects navigation", async () => {
  let clients = 0, quotaCalls = 0, deliveries = 0;
  const client = { rpc: (name: string) => { assert.equal(name, "consume_api_rate_limit"); quotaCalls++;
    return { abortSignal: async () => ({ error: null, data: [{ allowed: true, reset_at: "2026-10-08T12:00:00Z" }] }) }; } } as unknown as SupabaseClient;
  const handle = createHtmlPreviewResourceHandler({ enabled: () => true, configuration: () => ({ key, audience, storageOrigin: "https://storage.test" }),
    serviceClient: () => { clients++; return client; }, nowSeconds: () => 100,
    deliver: async input => { assert.ok(await input.consumeQuota(claims)); deliveries++; return new Response(new Uint8Array([7])); } });
  const token = issueHtmlPreviewResourceCapability(claims, key), url = `${audience}/api/resource?cap=${token}`;
  for (const request of [new Request(url, { headers: { "sec-fetch-dest": "document" } }),
    new Request(url, { headers: { Origin: "https://foreign.test" } }), new Request(url + "&cap=duplicate"),
    new Request(url + "&actorId=forged"), new Request(`${audience}/api/resource?cap=bad`)]) {
    assert.equal((await handle(request, { draftId: uuid })).status, 403);
  }
  assert.equal(clients, 0); assert.equal(deliveries, 0);
  const response = await handle(new Request(url, { headers: { Origin: "null", "sec-fetch-dest": "video" } }), { draftId: uuid });
  assert.equal(response.status, 200); assert.equal(deliveries, 1); assert.equal(quotaCalls, 2);
  assert.equal((await handle(new Request(url, { method: "POST" }), { draftId: uuid })).status, 405);
  const disabled = createHtmlPreviewResourceHandler({ enabled: () => false, configuration: () => { throw new Error(); }, serviceClient: () => client });
  assert.equal((await disabled(new Request(url), { draftId: uuid })).status, 503);
});

test("resource HTTP errors distinguish quota/range failures without disclosing tokens or provider internals", async () => {
  const token = issueHtmlPreviewResourceCapability(claims, key), url = `${audience}/api/resource?cap=${token}`;
  let reads = 0;
  for (const allowed of [false, true]) {
    const client = { rpc: () => ({ abortSignal: async () => {
      reads++; return { error: null, data: [{ allowed, reset_at: "2026-10-08T12:00:00Z" }] };
    } }) } as unknown as SupabaseClient;
    const handle = createHtmlPreviewResourceHandler({ enabled: () => true, configuration: () => ({ key, audience, storageOrigin: "https://storage.test" }),
      serviceClient: () => client, nowSeconds: () => 100, deliver: async input => {
        await input.consumeQuota(claims);
        parseHtmlPreviewResourceRange(input.range, claims.fileSizeBytes);
        throw new Error(`PRIVATE_PROVIDER_INTERNAL ${token}`);
      } });
    const response = await handle(new Request(url, { headers: allowed ? { Range: "bytes=100-" } : undefined }), { draftId: uuid });
    assert.equal(response.status, allowed ? 416 : 429);
    if (allowed) assert.equal(response.headers.get("Content-Range"), "bytes */42");
    else assert.equal(response.headers.get("Retry-After"), "60");
    assert.ok(!(await response.text()).includes(token));
    if (allowed) {
      const failed = await handle(new Request(url), { draftId: uuid });
      assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /PRIVATE_PROVIDER_INTERNAL/);
    }
  }
  assert.ok(reads > 0);
});
