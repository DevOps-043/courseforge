import test from "node:test";
import assert from "node:assert/strict";
import { createHtmlEditingInitializationHandler } from "../http/composition-html-editing-initialization-handler.server";
import { htmlEditingInitializationEnabled } from "../composition-html-editing-initialization-http.contract";
import { HtmlEditingRevisionError } from "../html-editing/html-editing-revision.contract";
import { HtmlEditingCatalogError } from "../html-editing/html-editing-template-catalog.server";

const uuid = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222", hash = "a".repeat(64);
const body = { expectedDocumentHash: hash, templateId: "intro", templateVersion: 1 };
function fixture() {
  const calls: string[] = [], keys: string[] = [];
  const state = { enabled: true, actorId: uuid as string | null,
    tenant: { organizationId: uuid, userId: uuid, platformRole: "ADMIN" as string | null },
    allowed: true, badRate: false, loggerFailure: false, failure: null as Error | null,
    ack: { status: "CONFIRMED", created: true, version: 1, sha256: hash, compositionDocumentHash: hash } as unknown };
  const handler = createHtmlEditingInitializationHandler({ enabled: () => state.enabled,
    authenticate: async () => { calls.push("auth"); return { actorId: state.actorId, tenant: state.tenant }; },
    serviceClient: () => {
      calls.push("client"); return { rpc: (name: string, args: Record<string, unknown>) => ({ abortSignal: async () => {
        calls.push(name); keys.push(String(args.p_rate_key));
        return { error: null, data: state.badRate ? [] : [{ allowed: state.allowed, reset_at: "2026-10-06T23:00:00Z" }] };
      } }) } as never;
    },
    register: async (_client, input, signal) => {
      calls.push("register"); assert.deepEqual(input, { ...body, actorId: uuid, organizationId: uuid, documentId: uuid, clipId: "intro" });
      assert.ok(signal instanceof AbortSignal); if (state.failure) throw state.failure; return state.ack;
    },
    logFailure: () => { if (state.loggerFailure) throw new Error("PRIVATE_LOGGER_FAILURE"); },
  });
  const request = (payload: unknown = body, headers: Record<string, string> = {}, method = "POST", signal?: AbortSignal) =>
    new Request("https://app.example/api/initialize", { method, headers: { origin: "https://app.example", "content-type": "application/json", ...headers },
      ...(method === "POST" ? { body: JSON.stringify(payload) } : {}), signal });
  return { handler, state, calls, keys, request, params: { draftId: uuid, clipId: "intro" } };
}

test("initialization flag is literal true only; disabled path has no auth or database work", async () => {
  for (const value of [undefined, "TRUE", "false", "1", ""]) assert.equal(htmlEditingInitializationEnabled(value), false);
  assert.equal(htmlEditingInitializationEnabled("true"), true);
  const f = fixture(); f.state.enabled = false;
  assert.equal((await f.handler(f.request(), f.params)).status, 503); assert.deepEqual(f.calls, []);
});

test("origin/method/MIME/path constraints reject before authentication", async () => {
  const cases: Array<{ method?: string; headers?: Record<string, string>; params?: unknown; status: number }> = [
    { method: "GET", status: 405 }, { headers: { origin: "https://evil.example" }, status: 403 },
    { headers: { "sec-fetch-site": "cross-site" }, status: 403 }, { headers: { "content-type": "text/plain" }, status: 415 },
    { params: { draftId: uuid, clipId: "../evil" }, status: 400 }];
  for (const options of cases) {
    const f = fixture();
    assert.equal((await f.handler(f.request(body, options.headers, options.method), options.params ?? f.params)).status, options.status);
    assert.deepEqual(f.calls, []);
  }
});

test("unauthenticated, mismatched tenant and non-reviewer paths cannot create service client", async () => {
  for (const mode of ["anonymous", "foreign", "role"] as const) {
    const f = fixture();
    if (mode === "anonymous") f.state.actorId = null;
    else if (mode === "foreign") f.state.tenant.userId = other;
    else f.state.tenant.platformRole = "BUILDER";
    assert.equal((await f.handler(f.request(), f.params)).status, mode === "anonymous" ? 401 : 403);
    assert.deepEqual(f.calls, ["auth"]);
  }
});

test("confirmed initialization and reuse return bounded correlated metadata without source", async () => {
  for (const created of [true, false]) {
    const f = fixture(); f.state.ack = { status: "CONFIRMED", created, version: 1, sha256: hash, compositionDocumentHash: hash };
    const response = await f.handler(f.request(), f.params);
    assert.equal(response.status, created ? 201 : 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const result = await response.json(); assert.equal(result.success, true);
    assert.equal(result.requestId, result.correlationId); assert.equal(result.requestId, response.headers.get("x-request-id"));
    assert.deepEqual(f.keys, [`html-editing-initialization:org:${uuid}`, `html-editing-initialization:actor:${uuid}:${uuid}`]);
    assert.equal(f.calls.filter(call => call === "register").length, 1);
  }
});

test("shared quota denial or malformed response fails closed before registration", async () => {
  for (const mode of ["deny", "malformed"]) {
    const f = fixture(); if (mode === "deny") f.state.allowed = false; else f.state.badRate = true;
    assert.equal((await f.handler(f.request(), f.params)).status, mode === "deny" ? 429 : 503);
    assert.ok(!f.calls.includes("register"));
  }
});

test("authority extras, malformed JSON contract and size limits cannot reach registration", async () => {
  for (const payload of [{ ...body, sourceHtml: "unsafe" }, { ...body, actorId: other }, { ...body, grants: [uuid] },
    { ...body, templateVersion: 0 }, { ...body, padding: "x".repeat(5000) }]) {
    const f = fixture(); const result = await f.handler(f.request(payload), f.params);
    assert.equal(result.status, JSON.stringify(payload).length > 4096 ? 413 : 400);
    assert.ok(!f.calls.includes("register"));
  }
});

test("conflicts are explicit; uncertain writes and invalid ACKs never become success or retry", async () => {
  for (const failure of [new HtmlEditingRevisionError("REVISION_CONFLICT"), new HtmlEditingCatalogError("TEMPLATE_UNAVAILABLE"),
    new HtmlEditingRevisionError("COMMIT_UNCONFIRMED"), new Error("PRIVATE_TOKEN")]) {
    const f = fixture(); f.state.failure = failure;
    const response = await f.handler(f.request(), f.params);
    assert.equal(response.status, failure.message.includes("CONFLICT") || failure.message.includes("TEMPLATE_UNAVAILABLE") ? 409 : 503);
    const text = await response.text(); assert.ok(!text.includes("PRIVATE_TOKEN")); assert.match(text, /"retryable":false/);
    assert.equal(f.calls.filter(call => call === "register").length, 1);
  }
  for (const ack of [null, { status: "CONFIRMED" }, { status: "CONFIRMED", created: true, version: 1, sha256: hash, compositionDocumentHash: "b".repeat(64) }]) {
    const f = fixture(); f.state.ack = ack; assert.equal((await f.handler(f.request(), f.params)).status, 503);
    assert.equal(f.calls.filter(call => call === "register").length, 1);
  }
});

test("pre-cancelled request cannot authenticate or dispatch registration", async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  assert.equal((await f.handler(f.request(body, {}, "POST", controller.signal), f.params)).status, 503);
  assert.deepEqual(f.calls, []);
});

test("observability failure cannot replace the safe unconfirmed response", async () => {
  const f = fixture(); f.state.loggerFailure = true; f.state.failure = new HtmlEditingRevisionError("COMMIT_UNCONFIRMED");
  const response = await f.handler(f.request(), f.params);
  assert.equal(response.status, 503); assert.ok(!(await response.text()).includes("PRIVATE_LOGGER_FAILURE"));
});
