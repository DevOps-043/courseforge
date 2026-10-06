import test from "node:test";
import assert from "node:assert/strict";
import { createHtmlEditingInspectorView } from "../html-editing/html-editing-inspector.server";
import { htmlEditingInspectorViewSchema } from "../html-editing/html-editing-inspector.contract";
import { createHtmlEditingInspectorHandler } from "../http/composition-html-editing-inspector-handler.server";
import { htmlEditingInspectorEnabled } from "../composition-html-editing-inspector-http-policy";
import { computeHtmlEditableManifestSha256 } from "../html-editing/html-editing-manifest-digest.server";
import { createHtmlEditingRevisionFixture as fixture, htmlEditingFixtureId as uuid,
  htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

function view() {
  const input = fixture();
  return { input, params: { ...input.authority, encodedRevision: JSON.stringify(input.next.revision),
    compositionDocumentHash: input.row.compositionDocumentHash } };
}
test("inspector returns original defaults, current overrides and identity without HTML or paths", () => {
  const { params, input } = view();
  const result = createHtmlEditingInspectorView(params);
  assert.equal(result.revisionSha256, input.next.sha256);
  assert.equal(result.revisionVersion, 2);
  assert.equal(result.usedResourcesGranted, true);
  assert.deepEqual(result.defaults, [{ kind: "TEXT", elementId: "title", value: "Original" },
    { kind: "IMAGE", elementId: "photo", assetId: uuid, fit: null }]);
  assert.equal(result.state.overrides[0]!.operation, "SET_TEXT");
  assert.ok(!JSON.stringify(result).includes("conformance-media/"));
  assert.ok(!JSON.stringify(result).includes("sourceHtml"));
});
test("revoked used image remains inspectable for removal but is not a currently granted choice", () => {
  const { params } = view();
  const result = createHtmlEditingInspectorView({ ...params, grantedAssetIds: [other] });
  assert.equal(result.usedResourcesGranted, false);
  assert.deepEqual(result.grantedAssetIds, [other]);
  assert.equal(result.defaults[1]!.kind, "IMAGE");
});
test("theme defaults stay symbolic and entity-encoded markup remains an inert text value", () => {
  const input = fixture(`<section><h1 id="title">&lt;script&gt;literal&lt;/script&gt;</h1><img id="photo" src="conformance-media/${uuid}">
    <div id="palette" data-courseforge-theme-token="palette" data-courseforge-theme-choice="dark"></div></section>`);
  const revision = structuredClone(input.current.revision);
  revision.manifest.elements.push({ kind: "THEME", elementId: "palette", label: "Palette", tokenId: "palette", allowedChoiceIds: ["dark", "light"] });
  const binding = revision.manifest.binding;
  binding.manifestSha256 = computeHtmlEditableManifestSha256(JSON.stringify(revision.manifest), binding);
  revision.state.binding = { ...binding };
  const result = createHtmlEditingInspectorView({ ...input.authority, authoritativeBinding: binding,
    encodedRevision: JSON.stringify(revision), compositionDocumentHash: input.row.compositionDocumentHash });
  assert.deepEqual(result.defaults[0], { kind: "TEXT", elementId: "title", value: "<script>literal</script>" });
  assert.deepEqual(result.defaults[2], { kind: "THEME", elementId: "palette", choiceId: "dark" });
});
test("projection does not mutate inputs, accept foreign grants or trust tampered source", () => {
  const { params } = view(), before = params.encodedRevision;
  const result = createHtmlEditingInspectorView(params);
  result.state.overrides.length = 0;
  assert.equal(params.encodedRevision, before);
  assert.throws(() => createHtmlEditingInspectorView({ ...params, grantedAssetIds: ["33333333-3333-4333-8333-333333333333"] }), /INVALID_REVISION/);
  const revision = JSON.parse(before); revision.sourceHtml += " ";
  assert.throws(() => createHtmlEditingInspectorView({ ...params, encodedRevision: JSON.stringify(revision) }), /SOURCE_DIGEST_MISMATCH/);
});
test("JSON contract rejects injected HTML, unknown overrides, foreign state binding and incorrect defaults", () => {
  const { params } = view(); const original = createHtmlEditingInspectorView(params);
  assert.equal(htmlEditingInspectorViewSchema.safeParse({ ...original, html: "<script>" }).success, false);
  for (const mode of ["state", "default", "override"]) {
    const changed = structuredClone(original);
    if (mode === "state") changed.state.binding.organizationId = other;
    else if (mode === "default") changed.defaults[0]!.elementId = "unknown";
    else changed.state.overrides[0]!.elementId = "unknown";
    assert.equal(htmlEditingInspectorViewSchema.safeParse(changed).success, false);
  }
});

function httpFixture() {
  const { params } = view();
  const state = { enabled: true, actorId: uuid as string | null,
    tenant: { organizationId: uuid, userId: uuid, platformRole: "ADMIN" },
    rateAllowed: true, badRate: false, data: createHtmlEditingInspectorView(params) as unknown, fail: false };
  const calls: string[] = [], keys: string[] = [];
  const handler = createHtmlEditingInspectorHandler({ enabled: () => state.enabled,
    authenticate: async () => { calls.push("auth"); return { actorId: state.actorId, tenant: state.tenant }; },
    serviceClient: () => { calls.push("client"); return { rpc: (name: string, args: Record<string, unknown>) => ({ abortSignal: async () => {
      calls.push(name); keys.push(String(args.p_rate_key)); return { error: null, data: state.badRate ? [] :
        [{ allowed: state.rateAllowed, reset_at: "2026-10-06T23:00:00Z" }] };
    } }) } as never; },
    read: async (_client, input) => {
      calls.push("read"); assert.equal(input.actorId, uuid); assert.deepEqual(input.scope, { organizationId: uuid, documentId: uuid, clipId: params.authoritativeBinding.clipId });
      assert.ok(input.signal instanceof AbortSignal); if (state.fail) throw new Error("PRIVATE_TOKEN"); return state.data;
    },
  });
  const request = (headers: Record<string, string> = {}, method = "GET", signal?: AbortSignal) =>
    new Request("https://app.example/api/inspector", { method, headers, signal });
  return { handler, state, calls, keys, request, scope: { draftId: uuid, clipId: params.authoritativeBinding.clipId } };
}
test("read flag defaults off and disabled handler has no authentication or quota activity", async () => {
  for (const value of [undefined, "TRUE", "false", "1", ""]) assert.equal(htmlEditingInspectorEnabled(value), false);
  assert.equal(htmlEditingInspectorEnabled("true"), true);
  const f = httpFixture(); f.state.enabled = false;
  assert.equal((await f.handler(f.request(), f.scope)).status, 503); assert.deepEqual(f.calls, []);
});
test("method, cross-site, foreign origin and invalid path fail before auth", async () => {
  const cases: Array<{ method?: string; headers?: Record<string, string>; scope?: unknown; status: number }> = [
    { method: "POST", status: 405 }, { headers: { "sec-fetch-site": "cross-site" }, status: 403 },
    { headers: { "sec-fetch-site": "same-site" }, status: 403 },
    { headers: { origin: "https://evil.example" }, status: 403 }, { scope: { draftId: uuid, clipId: "../evil" }, status: 400 }];
  for (const options of cases) {
    const f = httpFixture(); assert.equal((await f.handler(f.request(options.headers, options.method), options.scope ?? f.scope)).status, options.status);
    assert.deepEqual(f.calls, []);
  }
});
test("anonymous, tenant mismatch and non-reviewer never obtain service access", async () => {
  for (const mode of ["anonymous", "tenant", "role"]) {
    const f = httpFixture(); if (mode === "anonymous") f.state.actorId = null;
    else if (mode === "tenant") f.state.tenant.userId = other; else f.state.tenant.platformRole = "BUILDER";
    assert.equal((await f.handler(f.request(), f.scope)).status, mode === "anonymous" ? 401 : 403);
    assert.deepEqual(f.calls, ["auth"]);
  }
});
test("read returns scoped correlated no-store view using org and actor shared quotas only", async () => {
  const f = httpFixture(); const response = await f.handler(f.request(), f.scope);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  const result = await response.json(); assert.equal(result.requestId, result.correlationId); assert.equal(result.success, true);
  assert.deepEqual(f.keys, [`html-editing-inspector:org:${uuid}`, `html-editing-inspector:actor:${uuid}:${uuid}`]);
  assert.deepEqual(f.calls, ["auth", "client", "consume_api_rate_limit", "consume_api_rate_limit", "read"]);
});
test("quota denial/malformed result, foreign view and provider failure cannot leak state or invoke mutations", async () => {
  for (const mode of ["denied", "badRate", "foreign", "failure"]) {
    const f = httpFixture(); if (mode === "denied") f.state.rateAllowed = false;
    else if (mode === "badRate") f.state.badRate = true;
    else if (mode === "foreign") {
      const foreign = createHtmlEditingInspectorView(view().params);
      foreign.manifest.binding.organizationId = other; foreign.state.binding.organizationId = other; f.state.data = foreign;
    } else f.state.fail = true;
    const response = await f.handler(f.request(), f.scope);
    assert.equal(response.status, mode === "denied" ? 429 : 503); assert.ok(!(await response.text()).includes("PRIVATE_TOKEN"));
    assert.ok(f.calls.every(call => ["auth", "client", "consume_api_rate_limit", "read"].includes(call)));
  }
});
test("pre-cancelled read has no side effects", async () => {
  const f = httpFixture(), controller = new AbortController(); controller.abort();
  assert.equal((await f.handler(f.request({}, "GET", controller.signal), f.scope)).status, 503); assert.deepEqual(f.calls, []);
});
