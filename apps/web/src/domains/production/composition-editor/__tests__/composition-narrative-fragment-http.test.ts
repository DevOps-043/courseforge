import assert from "node:assert/strict";
import test from "node:test";
import { createNarrativeFragmentPlanHttpHandler, type NarrativeFragmentPlanHttpDependencies } from "../http/composition-narrative-fragment-plan-handler.server";
import { createNarrativeDocumentFixture } from "./fixtures/composition-narrative.fixture";
import { deriveNarrativeNavigationOccurrences } from "../composition-narrative-occurrence.service";
import { compositionNativeTextSourceSchema } from "../composition-text-layer.types";

const draftId = "55555555-5555-4555-8555-555555555555";
const organizationId = "33333333-3333-4333-8333-333333333333";
const userId = "22222222-2222-4222-8222-222222222222";
const componentId = "44444444-4444-4444-8444-444444444444";
function setup() {
  const document = createNarrativeDocumentFixture(); document.format = "courseforge-composition-v3";
  document.tracks.push({ id: "text", kind: "OVERLAY", semanticRole: "TEXT", label: "Texto", order: 1, locked: false });
  document.clips.push({ ...document.clips[0]!, id: "title", hfId: "hf-title", sceneId: undefined, kind: "TEXT", trackId: "text",
    sourceOffsetSeconds: undefined, sourceDurationSeconds: undefined,
    source: compositionNativeTextSourceSchema.parse({ type: "NATIVE_TEXT", text: "Texto manual", style: {} }) });
  const occurrence = deriveNarrativeNavigationOccurrences(document).occurrences[0]!;
  const body = { contract: "NARRATIVE_FRAGMENT_QUERY_V1", selectedTrackIds: ["voice", "text"],
    selection: { documentHash: "b".repeat(64), occurrenceId: occurrence.id, firstSourceIndex: 1, lastSourceIndex: 2 } };
  const calls: string[] = [];
  const dependencies: NarrativeFragmentPlanHttpDependencies = {
    configuredAppUrl: () => "https://courseforge.example",
    authorize: async () => { calls.push("authorize"); return { status: "AUTHORIZED", organizationId, userId }; },
    consumeRateLimit: async scope => { calls.push("limit"); assert.deepEqual(scope, { organizationId, userId }); return { status: "ALLOWED" }; },
    createRepository: signal => { calls.push("repository"); assert.equal(signal.aborted, false); return {
      readComponentId: async (draft, org) => { assert.equal(draft, draftId); assert.equal(org, organizationId); return componentId; },
      readDocument: async () => ({ document, documentHash: "b".repeat(64) }),
      readAssets: async () => [{ id: occurrence.assetId, organization_id: organizationId, material_component_id: componentId,
        asset_type: "VOICE_AUDIO", mime_type: "audio/mpeg", checksum: "c".repeat(64), qa_status: "APPROVED", duration_milliseconds: 10_000,
        metadata: { script_hash: occurrence.scriptHash, word_timestamps: document.narrativeScenes![0]!.wordTimestamps } }],
      readFonts: async () => [],
    }; },
    logFailure: () => calls.push("failure"),
  };
  const request = (overrides: RequestInit = {}, url = "https://courseforge.example/api/plan") => new Request(url, {
    method: "POST", headers: { origin: "https://courseforge.example", "content-type": "application/json" }, body: JSON.stringify(body), ...overrides });
  return { document, body, calls, dependencies, request, handle: createNarrativeFragmentPlanHttpHandler(dependencies) };
}
test("authorized audiovisual review returns only summary, no operations and no write receipt", async () => {
  const current = setup();
  const response = await current.handle(current.request(), draftId);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  const envelope = await response.json();
  assert.equal(envelope.data.scope, "AUDIOVISUAL"); assert.equal(envelope.data.clipCount, 2);
  assert.equal(envelope.data.requiresRevalidationBeforeApply, true);
  assert.equal(envelope.data.commandId, undefined); assert.equal(envelope.data.operations, undefined);
  assert.deepEqual(current.calls, ["authorize", "limit", "repository"]);
});
test("origin, MIME, method, identifier and URL parameters fail before authorization", async () => {
  for (const [request, id, status] of [
    [setup().request({ headers: { origin: "https://evil.example", "content-type": "application/json" } }), draftId, 403],
    [setup().request({ headers: { origin: "https://courseforge.example", "content-type": "text/plain" } }), draftId, 415],
    [setup().request({ method: "GET", body: undefined }), draftId, 405],
    [setup().request(), "invalid", 400],
    [setup().request({}, "https://courseforge.example/api/plan?q=words"), draftId, 400],
  ] as const) {
    const current = setup(); assert.equal((await current.handle(request, id)).status, status); assert.deepEqual(current.calls, []);
  }
  const current = setup(); current.dependencies.configuredAppUrl = () => null;
  assert.equal((await current.handle(current.request(), draftId)).status, 503); assert.deepEqual(current.calls, []);
});
test("authentication and scope denial never instantiate service role repository", async () => {
  for (const status of ["AUTH_REQUIRED", "TENANT_FORBIDDEN", "ROLE_FORBIDDEN"] as const) {
    const current = setup(); current.dependencies.authorize = async () => ({ status });
    assert.equal((await current.handle(current.request(), draftId)).status, status === "AUTH_REQUIRED" ? 401 : 403);
    assert.deepEqual(current.calls, []);
  }
  const current = setup(); current.dependencies.authorize = async () => ({ status: "AUTHORIZED", organizationId: "bad", userId });
  assert.equal((await current.handle(current.request(), draftId)).status, 403); assert.deepEqual(current.calls, []);
});
test("distributed limit failure and excess prevent reads with bounded retry hint", async () => {
  for (const status of ["UNAVAILABLE", "LIMITED"] as const) {
    const current = setup(); current.dependencies.consumeRateLimit = async () => status === "LIMITED" ? { status, retryAfterSeconds: 999 } : { status };
    const response = await current.handle(current.request(), draftId);
    assert.equal(response.status, status === "LIMITED" ? 429 : 503);
    if (status === "LIMITED") assert.equal(response.headers.get("retry-after"), "60");
    assert.deepEqual(current.calls, ["authorize"]);
  }
});
test("strict body, real byte cap and malformed UTF-8 fail before repository", async () => {
  for (const body of [JSON.stringify({ ...setup().body, operations: [] }), " ".repeat(8193), new Uint8Array([0xff])]) {
    const current = setup(); const response = await current.handle(current.request({ body }), draftId);
    assert.equal(response.status, typeof body === "string" && body.length > 8192 ? 413 : 400);
    assert.deepEqual(current.calls, ["authorize", "limit"]);
  }
});
test("stale and missing drafts stay explicit; unexpected errors expose no internal content", async () => {
  const stale = setup(); stale.body.selection.documentHash = "e".repeat(64);
  assert.equal((await stale.handle(stale.request(), draftId)).status, 409);
  const missing = setup(); missing.dependencies.createRepository = () => ({ readComponentId: async () => null,
    readDocument: async () => { throw Error("must not read"); }, readAssets: async () => [], readFonts: async () => [] });
  assert.equal((await missing.handle(missing.request(), draftId)).status, 404);
  const failed = setup(); failed.dependencies.createRepository = () => { throw Error("secret internal path"); };
  const response = await failed.handle(failed.request(), draftId); assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes("secret internal path")); assert.ok(failed.calls.includes("failure"));
});
test("aborted review cannot start authorization or become eligible", async () => {
  const current = setup(); const controller = new AbortController(); controller.abort();
  assert.equal((await current.handle(current.request({ signal: controller.signal }), draftId)).status, 503);
  assert.deepEqual(current.calls, ["failure"]);
});
