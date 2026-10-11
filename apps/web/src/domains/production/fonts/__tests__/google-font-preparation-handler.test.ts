import assert from "node:assert/strict";
import test from "node:test";
import { handleGoogleFontPreparation, type GoogleFontPreparationHttpDependencies } from "../google-font-preparation-handler.server";
import { BoundedConcurrencyLimiter } from "../../../../lib/server/external-import-concurrency";
import { GoogleFontBundleCommitError } from "../google-font-bundle-store.server";

const fontId = "00000000-0000-4000-8000-000000000001";
const organizationId = "00000000-0000-4000-8000-000000000002";
const cssUrl = "https://fonts.googleapis.com/css2?family=Inter";
const binaryUrl = "https://fonts.gstatic.com/s/inter/v18/Regular.woff2";
const row = { id: fontId, organization_id: organizationId, family: "Inter", source: "google", status: "READY", css_url: cssUrl };
const request = (body = "{}", changes: RequestInit = {}) => new Request("https://engine.test/api/admin/fonts/font/google-preparation", {
  method: "POST", headers: { origin: "https://engine.test", "content-type": "application/json", "sec-fetch-site": "same-origin" }, body, ...changes,
});

function fixture() {
  const counters = { authentication: 0, reads: 0, fetches: 0, failures: [] as string[] };
  const dependencies: GoogleFontPreparationHttpDependencies = {
    capacity: new BoundedConcurrencyLimiter(2, 2, 2000),
    authenticate: async () => { counters.authentication++; return { authenticated: true, organizationId, platformRole: "ADMIN" }; },
    repository: { readFont: async (org, id) => { counters.reads++; assert.equal(org, organizationId); assert.equal(id, fontId); return row; } },
    fetchImpl: async url => {
      counters.fetches++;
      if (String(url) === cssUrl) return new Response(`@font-face{font-family:'Inter';font-weight:400;src:url(${binaryUrl}) format('woff2');}`, { headers: { "content-type": "text/css" } });
      const bytes = new Uint8Array(48); bytes.set(new TextEncoder().encode("wOF2"));
      new DataView(bytes.buffer).setUint32(8, 48); new DataView(bytes.buffer).setUint16(12, 1);
      return new Response(bytes.buffer, { headers: { "content-type": "font/woff2" } });
    },
    recordFailure: reason => { counters.failures.push(reason); },
  };
  return { dependencies, counters };
}

for (const [name, headers, status] of [
  ["missing Origin", { "content-type": "application/json" }, 403],
  ["different Origin", { origin: "https://evil.test", "content-type": "application/json" }, 403],
  ["cross-site metadata", { origin: "https://engine.test", "content-type": "application/json", "sec-fetch-site": "cross-site" }, 403],
  ["form submission", { origin: "https://engine.test", "content-type": "text/plain" }, 415],
] as const) test(`rejects ${name} before authenticating or accessing dependencies`, async () => {
  const { dependencies, counters } = fixture();
  const result = await handleGoogleFontPreparation(request("{}", { headers }), { fontId }, dependencies);
  assert.equal(result.status, status); assert.equal(counters.authentication, 0); assert.equal(counters.reads, 0); assert.equal(counters.fetches, 0);
});

test("rejects GET with no side effects", async () => {
  const { dependencies, counters } = fixture();
  const result = await handleGoogleFontPreparation(new Request("https://engine.test/"), { fontId }, dependencies);
  assert.equal(result.status, 405); assert.equal(counters.authentication, 0);
});

for (const [name, context, status] of [
  ["anonymous", { authenticated: false, organizationId: null, platformRole: null }, 401],
  ["no tenant", { authenticated: true, organizationId: null, platformRole: "ADMIN" }, 403],
  ["builder", { authenticated: true, organizationId, platformRole: "BUILDER" }, 403],
  ["architect", { authenticated: true, organizationId, platformRole: "ARCHITECT" }, 403],
  ["missing role", { authenticated: true, organizationId, platformRole: null }, 403],
] as const) test(`rejects ${name} before querying registry or network`, async () => {
  const { dependencies, counters } = fixture(); dependencies.authenticate = async () => context;
  const result = await handleGoogleFontPreparation(request(), { fontId }, dependencies);
  assert.equal(result.status, status); assert.equal(counters.reads, 0); assert.equal(counters.fetches, 0);
});

for (const [name, body, params, status] of [
  ["invalid UUID", "{}", { fontId: "invalid" }, 400], ["client supplied URL", '{"cssUrl":"https://evil.test"}', { fontId }, 400],
  ["invalid JSON", "{", { fontId }, 400], ["oversized request", " ".repeat(1025), { fontId }, 413],
] as const) test(`rejects ${name} before querying registry or network`, async () => {
  const { dependencies, counters } = fixture();
  const result = await handleGoogleFontPreparation(request(body), params, dependencies);
  assert.equal(result.status, status); assert.equal(counters.reads, 0); assert.equal(counters.fetches, 0);
});

for (const role of ["ADMIN", "SUPERADMIN"]) test(`allows ${role} to prepare a candidate, not activate a font`, async () => {
  const { dependencies, counters } = fixture(); dependencies.authenticate = async () => ({ authenticated: true, organizationId, platformRole: role });
  const result = await handleGoogleFontPreparation(request(), { fontId }, dependencies);
  assert.equal(result.status, 200); assert.equal(counters.reads, 1); assert.equal(counters.fetches, 2);
  if (!("preparation" in result)) assert.fail("expected preparation");
  assert.equal(result.preparation.renderEligible, false);
  assert.equal(result.preparation.status, "NATIVE_BUNDLE_INTEGRATION_REQUIRED");
});

test("returns unavailable without logging arbitrary provider/registry errors", async () => {
  const { dependencies, counters } = fixture();
  dependencies.repository.readFont = async () => { throw new Error("private token=secret"); };
  const result = await handleGoogleFontPreparation(request(), { fontId }, dependencies);
  assert.equal(result.status, 503); assert.equal(counters.fetches, 0);
  assert.deepEqual(counters.failures, ["GOOGLE_FONT_PREPARATION_UNAVAILABLE"]);
  assert.doesNotMatch(JSON.stringify(result), /private|token|secret/);
});

test("returns not-found and conflict without acquiring unapproved bytes", async () => {
  const { dependencies, counters } = fixture();
  dependencies.repository.readFont = async () => null;
  assert.equal((await handleGoogleFontPreparation(request(), { fontId }, dependencies)).status, 404);
  dependencies.repository.readFont = async () => ({ ...row, status: "REJECTED" });
  assert.equal((await handleGoogleFontPreparation(request(), { fontId }, dependencies)).status, 409);
  assert.equal(counters.fetches, 0);
});

test("applies per-instance backpressure before a second registry query", async () => {
  const { dependencies, counters } = fixture(); dependencies.capacity = new BoundedConcurrencyLimiter(1, 0, 2000);
  let release: () => void = () => { assert.fail("not started"); };
  dependencies.repository.readFont = async () => { counters.reads++; await new Promise<void>(resolve => { release = resolve; }); return null; };
  const first = handleGoogleFontPreparation(request(), { fontId }, dependencies);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal((await handleGoogleFontPreparation(request(), { fontId }, dependencies)).status, 429);
  assert.equal(counters.reads, 1); assert.equal(counters.fetches, 0);
  release(); assert.equal((await first).status, 404);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(dependencies.capacity.snapshot(), { active: 0, queued: 0 });
});

test("an aborted request does not reach the repository", async () => {
  const { dependencies, counters } = fixture(), controller = new AbortController(); controller.abort();
  const result = await handleGoogleFontPreparation(request("{}", { signal: controller.signal }), { fontId }, dependencies);
  assert.equal(result.status, 503); assert.equal(counters.reads, 0); assert.equal(counters.fetches, 0);
});

test("rejects a chunked oversized body before dependencies and cancels ingestion", async () => {
  const { dependencies, counters } = fixture(); let canceled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(1025)); }, cancel() { canceled = true; } });
  const input = request("", { body: stream, duplex: "half" } as RequestInit);
  assert.equal((await handleGoogleFontPreparation(input, { fontId }, dependencies)).status, 413);
  assert.equal(canceled, true); assert.equal(input.body!.locked, false);
  assert.equal(counters.reads, 0); assert.equal(counters.fetches, 0);
});

test("canceling a stalled request body prevents all registry and provider work", async () => {
  const { dependencies, counters } = fixture(); const controller = new AbortController(); let canceled = false;
  const input = request("", { body: new ReadableStream<Uint8Array>({ cancel() { canceled = true; } }), signal: controller.signal, duplex: "half" } as RequestInit);
  const pending = handleGoogleFontPreparation(input, { fontId }, dependencies);
  await new Promise<void>(resolve => setImmediate(resolve)); controller.abort();
  assert.equal((await pending).status, 503); assert.equal(canceled, true); assert.equal(input.body!.locked, false);
  assert.equal(counters.reads, 0); assert.equal(counters.fetches, 0);
});

test("persist:true requires a server actor and an explicit reviewed digest", async () => {
  const { dependencies, counters } = fixture();
  let writes = 0;
  dependencies.materialize = async () => { writes++; assert.fail("must not write"); };
  const body = JSON.stringify({ persist: true, expectedCandidateSha256: "a".repeat(64) });
  assert.equal((await handleGoogleFontPreparation(request(body), { fontId }, dependencies)).status, 403);
  dependencies.authenticate = async () => ({ authenticated: true, organizationId, platformRole: "ADMIN", actorId: fontId });
  assert.equal((await handleGoogleFontPreparation(request('{"persist":true}'), { fontId }, dependencies)).status, 400);
  assert.equal((await handleGoogleFontPreparation(request('{"persist":false,"expectedCandidateSha256":"' + "a".repeat(64) + '"}'), { fontId }, dependencies)).status, 400);
  assert.equal(writes, 0); assert.equal(counters.reads, 0); assert.equal(counters.fetches, 0);
});

test("{} never invokes materialization; explicit persistence receives only trusted scope and reviewed hash", async () => {
  const { dependencies } = fixture(); let writes = 0;
  dependencies.authenticate = async () => ({ authenticated: true, organizationId, platformRole: "ADMIN", actorId: fontId });
  dependencies.materialize = async input => {
    writes++; assert.equal(input.organizationId, organizationId); assert.equal(input.actorId, fontId); assert.equal(input.fontId, fontId);
    assert.equal(input.expectedCandidateSha256, "a".repeat(64)); assert.ok(input.signal instanceof AbortSignal);
    return { bundleId: fontId, candidateSha256: input.expectedCandidateSha256, status: "PREPARED", renderEligible: false, created: true };
  };
  assert.equal((await handleGoogleFontPreparation(request(), { fontId }, dependencies)).status, 200); assert.equal(writes, 0);
  const result = await handleGoogleFontPreparation(request(JSON.stringify({ persist: true, expectedCandidateSha256: "a".repeat(64) })), { fontId }, dependencies);
  assert.equal(result.status, 200); assert.equal(writes, 1); assert.ok("bundle" in result);
});

for (const reason of ["FORBIDDEN", "STALE", "REVOKED"] as const) test(`a commit-time ${reason} prevents a successful persistence response`, async () => {
  const { dependencies } = fixture();
  dependencies.authenticate = async () => ({ authenticated: true, organizationId, platformRole: "ADMIN", actorId: fontId });
  dependencies.materialize = async () => { throw new GoogleFontBundleCommitError(reason); };
  const result = await handleGoogleFontPreparation(request(JSON.stringify({ persist: true, expectedCandidateSha256: "a".repeat(64) })), { fontId }, dependencies);
  assert.equal(result.status, reason === "FORBIDDEN" ? 403 : 409);
});

test("native validation is a separate explicit action with server actor, reviewed hash and no provider fetch", async () => {
  const { dependencies, counters } = fixture(); let admissions = 0;
  const body = JSON.stringify({ admit: true, expectedCandidateSha256: "a".repeat(64) });
  dependencies.admit = async input => {
    admissions++; assert.equal(input.actorId, fontId); assert.equal(input.organizationId, organizationId);
    assert.equal(input.fontId, fontId); assert.equal(input.expectedCandidateSha256, "a".repeat(64));
    return { admissionId: fontId, bundleId: fontId, fontId, candidateSha256: input.expectedCandidateSha256,
      status: "READY", faceIds: [fontId], created: true, scope: "DECODED_FONT_FILES_NOT_RENDER_ATTESTATION" };
  };
  assert.equal((await handleGoogleFontPreparation(request(body), { fontId }, dependencies)).status, 403);
  dependencies.authenticate = async () => ({ authenticated: true, organizationId, platformRole: "ADMIN", actorId: fontId });
  for (const invalid of [{ admit: true }, { admit: false, expectedCandidateSha256: "a".repeat(64) },
    { admit: true, persist: true, expectedCandidateSha256: "a".repeat(64) },
    { admit: true, expectedCandidateSha256: "a".repeat(64), actorId: fontId }])
    assert.equal((await handleGoogleFontPreparation(request(JSON.stringify(invalid)), { fontId }, dependencies)).status, 400);
  assert.equal(admissions, 0);
  const result = await handleGoogleFontPreparation(request(body), { fontId }, dependencies);
  assert.equal(result.status, 200); assert.ok("admission" in result); assert.equal(admissions, 1);
  assert.equal(counters.reads, 0); assert.equal(counters.fetches, 0);
});

test("unknown native admission outcomes return a safe error without retries or provider fallbacks", async () => {
  const { dependencies, counters } = fixture(); let admissions = 0;
  dependencies.authenticate = async () => ({ authenticated: true, organizationId, platformRole: "ADMIN", actorId: fontId });
  dependencies.admit = async () => { admissions++; throw new Error("private SQL token=secret"); };
  const result = await handleGoogleFontPreparation(request(JSON.stringify({ admit: true, expectedCandidateSha256: "a".repeat(64) })), { fontId }, dependencies);
  assert.equal(result.status, 503); assert.equal(admissions, 1); assert.equal(counters.fetches, 0);
  assert.doesNotMatch(JSON.stringify(result), /private|SQL|token|secret/);
});
