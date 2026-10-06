import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHtmlEditingOperationHandler } from "../http/composition-html-editing-operation-handler.server";
import { computeHtmlEditingOperationRequestSha256 } from "../composition-html-editing-operation-digest.server";
import { htmlEditingOperationReceiptsEnabled } from "../composition-html-editing-operation-http-policy";
import { htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

function setup() {
  const params = { draftId: uuid, clipId: "slide-1", operationId: other };
  const url = `https://editor.example/api/production/hyperframes/drafts/${uuid}/html-editing/slide-1/operations/${other}`;
  const body = { action: "COMMAND", expected: { version: 1, sha256: "a".repeat(64) }, expectedCompositionDocumentHash: "c".repeat(64),
    overrides: [{ operation: "SET_TEXT", elementId: "title", value: "Changed" }] };
  const digest = computeHtmlEditingOperationRequestSha256(body);
  const receipt = { scope: "EDITORIAL_OPERATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED", owner: { actorId: uuid, organizationId: uuid, draftId: uuid },
    operationId: other, requestSha256: digest, clipId: "slide-1", acknowledgment: { scope: "EDITORIAL_RESULT_NOT_CURRENT_STATE_OR_RENDERED",
      changed: true, previous: body.expected, next: { version: 2, sha256: "b".repeat(64) } } };
  const state = { actorId: uuid as string | null, tenantUserId: uuid, organizationId: uuid, role: "ADMIN", getEnabled: true, postEnabled: true,
    allowed: true, rateError: false, ratePayload: null as unknown, commitResponse: receipt as unknown,
    readResponse: { status: "RECORDED", receipt } as unknown, privateError: false };
  const calls: Array<{ name: string; input?: unknown }> = [];
  const client = { rpc: (_name: string, args: unknown) => ({ abortSignal: async () => {
    calls.push({ name: "quota", input: args });
    return { data: state.ratePayload ?? [{ allowed: state.allowed, reset_at: "2026-10-06T00:00:00Z" }], error: state.rateError ? { message: "PRIVATE_RATE_SECRET" } : null };
  } }) } as unknown as SupabaseClient;
  const handle = createHtmlEditingOperationHandler({ enabled: method => method === "GET" ? state.getEnabled : state.postEnabled,
    authenticate: async () => { calls.push({ name: "auth" }); return { actorId: state.actorId,
      tenant: { organizationId: state.organizationId, userId: state.tenantUserId, platformRole: state.role } }; },
    serviceClient: () => { calls.push({ name: "client" }); return client; },
    commit: async (_client, input, operationId, signal) => {
      assert.equal(signal.aborted, false); calls.push({ name: "commit", input: { input, operationId } });
      if (state.privateError) throw new Error("PRIVATE_PROVIDER_SECRET"); return state.commitResponse;
    },
    read: async (_client, input) => { calls.push({ name: "read", input }); if (state.privateError) throw new Error("PRIVATE_PROVIDER_SECRET"); return state.readResponse; },
  });
  const post = (value: unknown = body, headers: Record<string, string> = {}) => new Request(url, { method: "POST",
    headers: { origin: "https://editor.example", "content-type": "application/json", ...headers }, body: JSON.stringify(value) });
  const get = (query = `requestSha256=${digest}`, headers: Record<string, string> = {}) => new Request(`${url}?${query}`, { headers });
  return { handle, state, calls, params, url, body, digest, receipt, post, get };
}

test("durable HTTP POST derives authenticated owner and digest, returns correlated historical receipt", async () => {
  const f = setup(), response = await f.handle(f.post(), f.params);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  const envelope = await response.json(); assert.deepEqual(envelope.data, { status: "RECORDED", receipt: f.receipt });
  assert.equal(envelope.requestId, envelope.correlationId);
  assert.deepEqual(f.calls.map(call => call.name), ["auth", "client", "quota", "quota", "commit"]);
  const commit = f.calls.at(-1)!.input as { input: { actorId: string; organizationId: string; documentId: string }; operationId: string };
  assert.equal(commit.input.actorId, uuid); assert.equal(commit.input.organizationId, uuid); assert.equal(commit.input.documentId, uuid); assert.equal(commit.operationId, other);
  const firstQuota = f.calls[2]!.input as { p_rate_key: string };
  assert.equal(firstQuota.p_rate_key, `html-editing-mutation:org:${uuid}`);
});

test("GET remains read-only with new writes disabled; missing receipt is not failure/retry permission", async () => {
  const f = setup(); f.state.postEnabled = false;
  assert.equal((await f.handle(f.get(), f.params)).status, 200);
  assert.equal(f.calls.filter(call => call.name === "commit").length, 0);
  f.state.readResponse = { status: "NOT_FOUND" };
  assert.deepEqual((await (await f.handle(f.get(), f.params)).json()).data, { status: "NOT_FOUND" });
  assert.equal((await f.handle(f.post(), f.params)).status, 503);
});

test("receipt gate is literal true and rejects before authentication when disabled", async () => {
  assert.equal(htmlEditingOperationReceiptsEnabled("true"), true);
  for (const value of [undefined, "TRUE", "1", "false"]) assert.equal(htmlEditingOperationReceiptsEnabled(value), false);
  const f = setup(); f.state.getEnabled = false; f.state.postEnabled = false;
  assert.equal((await f.handle(f.get(), f.params)).status, 503); assert.equal((await f.handle(f.post(), f.params)).status, 503);
  assert.equal(f.calls.length, 0);
});

test("unauthenticated, foreign tenant and non-reviewer requests never construct privileged client", async () => {
  for (const failure of ["anonymous", "tenant", "role"] as const) {
    const f = setup(); if (failure === "anonymous") f.state.actorId = null;
    if (failure === "tenant") f.state.tenantUserId = other;
    if (failure === "role") f.state.role = "BUILDER";
    assert.equal((await f.handle(f.get(), f.params)).status, failure === "anonymous" ? 401 : 403);
    assert.deepEqual(f.calls.map(call => call.name), ["auth"]);
  }
});

test("foreign origin/site, invalid operation IDs, duplicate/extra query and non-JSON POST fail before auth", async () => {
  const f = setup();
  for (const request of [f.post(f.body, { origin: "https://foreign.example" }), f.get(undefined, { "sec-fetch-site": "cross-site" }),
    f.get(`requestSha256=${f.digest}&requestSha256=${f.digest}`), f.get(`requestSha256=${f.digest}&actorId=${uuid}`), f.get("requestSha256=bad"),
    f.post(f.body, { "content-type": "text/plain" })]) assert.ok((await f.handle(request, f.params)).status >= 400);
  assert.equal((await f.handle(f.get(), { ...f.params, operationId: "bad" })).status, 400); assert.equal(f.calls.length, 0);
});

test("actor/scope/grants/source/digest supplied in POST body cannot enter durable service", async () => {
  for (const extra of [{ actorId: other }, { organizationId: other }, { sourceHtml: "private" }, { grantedAssetIds: [other] }, { requestSha256: "f".repeat(64) }]) {
    const f = setup(); assert.equal((await f.handle(f.post({ ...f.body, ...extra }), f.params)).status, 400);
    assert.equal(f.calls.filter(call => call.name === "commit").length, 0);
  }
});

test("body limits reject declared and actual oversize without commit", async () => {
  const f = setup(); assert.equal((await f.handle(f.post(f.body, { "content-length": "65537" }), f.params)).status, 413);
  assert.equal((await f.handle(f.post({ ...f.body, padding: "x".repeat(65537) }), f.params)).status, 413);
  assert.equal(f.calls.filter(call => call.name === "commit").length, 0);
});

test("shared quotas deny or fail closed before either receipt port is called", async () => {
  for (const failure of ["deny", "error", "malformed"] as const) {
    const f = setup(); if (failure === "deny") f.state.allowed = false;
    if (failure === "error") f.state.rateError = true;
    if (failure === "malformed") f.state.ratePayload = [];
    const response = await f.handle(f.get(), f.params);
    assert.equal(response.status, failure === "deny" ? 429 : 503);
    assert.equal(f.calls.filter(call => call.name === "read" || call.name === "commit").length, 0);
    assert.equal((await response.json()).retryable, false);
  }
});

test("foreign or malformed POST/GET receipts cannot become successful acknowledgments", async () => {
  for (const patch of [{ operationId: uuid }, { requestSha256: "f".repeat(64) }, { clipId: "other" },
    { owner: { actorId: other, organizationId: uuid, draftId: uuid } }]) {
    const f = setup(); f.state.commitResponse = { ...f.receipt, ...patch };
    f.state.readResponse = { status: "RECORDED", receipt: f.state.commitResponse };
    assert.equal((await f.handle(f.post(), f.params)).status, 503); assert.equal((await f.handle(f.get(), f.params)).status, 503);
  }
});

test("oversized/private errors do not leak provider internals or trigger a second dispatch", async () => {
  const f = setup(); f.state.privateError = true;
  const response = await f.handle(f.post(), f.params);
  assert.equal(response.status, 503); assert.equal((await response.text()).includes("PRIVATE_PROVIDER_SECRET"), false);
  assert.equal(f.calls.filter(call => call.name === "commit").length, 1);
  const oversized = setup(); oversized.state.readResponse = "x".repeat(4097);
  assert.equal((await oversized.handle(oversized.get(), oversized.params)).status, 503);
});

test("pre-abort and unsupported methods perform no privileged read/write", async () => {
  const f = setup(), controller = new AbortController(); controller.abort();
  assert.equal((await f.handle(new Request(f.get(), { signal: controller.signal }), f.params)).status, 503);
  assert.equal((await f.handle(new Request(f.url, { method: "DELETE" }), f.params)).status, 405);
  assert.equal(f.calls.length, 0);
});
