import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHtmlEditingInitializationOperationHandler } from "../http/composition-html-editing-initialization-operation-handler.server";
import { htmlEditingInitializationReceiptsEnabled } from "../composition-html-editing-initialization-operation-http-policy";
import { computeHtmlEditingInitializationRequestSha256 } from "../composition-html-editing-initialization-operation-digest.server";
import { HtmlEditingRevisionError } from "../html-editing/html-editing-revision.contract";

const uuid = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const body = { templateId: "intro", templateVersion: 1, expectedDocumentHash: "a".repeat(64) };
const params = { draftId: uuid, clipId: "slide-1", operationId: other };
const digest = computeHtmlEditingInitializationRequestSha256(body);
const receipt = { scope: "HTML_INITIALIZATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED", owner: { actorId: uuid, organizationId: uuid, draftId: uuid },
  operationId: other, requestSha256: digest, clipId: params.clipId, request: body,
  acknowledgment: { status: "CONFIRMED", created: true, version: 1, sha256: "b".repeat(64), compositionDocumentHash: body.expectedDocumentHash } };
const endpoint = `https://courseforge.example/api/production/hyperframes/drafts/${uuid}/html-editing/slide-1/initialize/operations/${other}`;
function request(method = "POST", options: RequestInit = {}, url?: string) {
  return new Request(url ?? (method === "GET" ? `${endpoint}?requestSha256=${digest}` : endpoint), { method,
    headers: { origin: "https://courseforge.example", "content-type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}), ...options });
}
function setup() {
  const state = { reads: true, writes: true, auth: { actorId: uuid as string | null,
    tenant: { organizationId: uuid, userId: uuid, platformRole: "ADMIN" as string | null } },
    authCalls: 0, clients: 0, registers: 0, receiptReads: 0, quotaAllowed: true, quotaError: false,
    postResult: receipt as unknown, readResult: { status: "RECORDED", receipt } as unknown, fail: false };
  const quotas: Array<Record<string, unknown>> = [], inputs: unknown[] = [];
  const client = { rpc: (_name: string, args: Record<string, unknown>) => ({ abortSignal: async () => {
    quotas.push(args); return { data: [{ allowed: state.quotaAllowed, reset_at: "2026-10-06T00:00:00Z" }], error: state.quotaError ? { message: "private" } : null };
  } }) } as unknown as SupabaseClient;
  const handle = createHtmlEditingInitializationOperationHandler({ enabled: method => method === "GET" ? state.reads : state.writes,
    authenticate: async () => { state.authCalls++; return state.auth; }, serviceClient: () => { state.clients++; return client; },
    register: async (_client, input) => { state.registers++; inputs.push(input); if (state.fail) throw new HtmlEditingRevisionError("COMMIT_UNCONFIRMED"); return state.postResult; },
    read: async (_client, input) => { state.receiptReads++; inputs.push(input); if (state.fail) throw new Error("PRIVATE_TOKEN"); return state.readResult; },
  });
  return { state, quotas, inputs, handle };
}

test("durable initial HTTP POST derives owner/digest, shares legacy write quotas and returns historical correlated metadata", async () => {
  const f = setup(), response = await f.handle(request(), params), result = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(result.data, { status: "RECORDED", receipt });
  assert.equal(result.requestId, result.correlationId); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(f.inputs[0], { ...body, actorId: uuid, organizationId: uuid, documentId: uuid, clipId: params.clipId, operationId: other });
  assert.equal(f.quotas[0]!.p_rate_key, `html-editing-initialization:org:${uuid}`); assert.equal(f.quotas[1]!.p_limit, 3);
});

test("durable initial GET works with new writes disabled and never registers; NOT_FOUND stays unknown", async () => {
  const f = setup(); f.state.writes = false; f.state.readResult = { status: "NOT_FOUND" };
  const response = await f.handle(request("GET", { headers: {} }), params);
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).data, { status: "NOT_FOUND" });
  assert.equal(f.state.registers, 0); assert.equal(f.state.receiptReads, 1); assert.equal(f.quotas[0]!.p_limit, 60);
  assert.equal((f.inputs[0] as { requestSha256: string }).requestSha256, digest);
});

test("initial receipt gate defaults off and disabled handler cannot authenticate or get service role", async () => {
  for (const value of [undefined, "", "false", "TRUE", "1"]) assert.equal(htmlEditingInitializationReceiptsEnabled(value), false);
  assert.equal(htmlEditingInitializationReceiptsEnabled("true"), true);
  const f = setup(); f.state.reads = false; f.state.writes = false;
  assert.equal((await f.handle(request(), params)).status, 503); assert.equal((await f.handle(request("GET"), params)).status, 503);
  assert.equal(f.state.authCalls, 0); assert.equal(f.state.clients, 0);
});

test("method/origin/site/query/path/MIME reject before authentication", async () => {
  const f = setup();
  for (const [req, path, status] of [
    [request("DELETE"), params, 405], [request("POST", { headers: { origin: "https://foreign.example", "content-type": "application/json" } }), params, 403],
    [request("GET", { headers: { "sec-fetch-site": "same-site" } }), params, 403],
    [request("GET", {}, `${endpoint}?requestSha256=${digest}&requestSha256=${digest}`), params, 400],
    [request("POST", {}, `${endpoint}?extra=1`), params, 400], [request(), { ...params, operationId: "invalid" }, 400],
    [request("POST", { headers: { origin: "https://courseforge.example", "content-type": "text/plain" } }), params, 415],
  ] as const) assert.equal((await f.handle(req, path)).status, status);
  assert.equal(f.state.authCalls, 0);
});

test("anonymous, foreign tenant and non-reviewer never get service-role initialization access", async () => {
  for (const failure of ["anonymous", "tenant", "role"] as const) {
    const f = setup();
    if (failure === "anonymous") f.state.auth.actorId = null;
    else if (failure === "tenant") f.state.auth.tenant.userId = other;
    else f.state.auth.tenant.platformRole = "USER";
    assert.equal((await f.handle(request(), params)).status, failure === "anonymous" ? 401 : 403);
    assert.equal(f.state.clients, 0); assert.equal(f.state.registers, 0);
  }
});

test("typed initial body rejects authority extras and actual oversize before service register", async () => {
  for (const invalid of [{ ...body, actorId: other }, { ...body, operationId: other }, { ...body, sourceHtml: "forged" }, { ...body, grantedAssetIds: [uuid] }]) {
    const f = setup(); assert.equal((await f.handle(request("POST", { body: JSON.stringify(invalid) }), params)).status, 400); assert.equal(f.state.registers, 0);
  }
  const f = setup(); assert.equal((await f.handle(request("POST", { body: " ".repeat(4097) }), params)).status, 413); assert.equal(f.state.registers, 0);
});

test("quota denial/error fails closed before either initial receipt service port", async () => {
  for (const failure of ["denied", "error"] as const) {
    const f = setup(); f.state.quotaAllowed = failure !== "denied"; f.state.quotaError = failure === "error";
    assert.equal((await f.handle(request(), params)).status, failure === "denied" ? 429 : 503);
    assert.equal(f.state.registers, 0); assert.equal(f.state.receiptReads, 0);
  }
});

test("foreign/malformed receipt and wrong returned request digest never become successful POST or GET", async () => {
  for (const method of ["POST", "GET"]) for (const invalid of [
    { ...receipt, owner: { ...receipt.owner, actorId: other } }, { ...receipt, operationId: uuid },
    { ...receipt, request: { ...body, templateVersion: 2 } }, { ...receipt, requestSha256: "e".repeat(64) }, " ".repeat(4097),
  ]) {
    const f = setup(); f.state.postResult = invalid; f.state.readResult = { status: "RECORDED", receipt: invalid };
    const response = await f.handle(request(method), params); assert.equal(response.status, 503);
    assert.equal(f.state.registers + f.state.receiptReads, 1); assert.equal((await response.json()).retryable, false);
  }
});

test("initial HTTP provider failure is safe unknown without retry or token leakage; pre-abort does no auth work", async () => {
  const f = setup(); f.state.fail = true;
  const response = await f.handle(request("GET"), params), encoded = JSON.stringify(await response.json());
  assert.equal(response.status, 503); assert.doesNotMatch(encoded, /PRIVATE_TOKEN/); assert.equal(f.state.receiptReads, 1);
  const cancelled = setup(), controller = new AbortController(); controller.abort();
  assert.equal((await cancelled.handle(request("POST", { signal: controller.signal }), params)).status, 503); assert.equal(cancelled.state.authCalls, 0);
});
