import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHtmlLegacyAdoptionHandler } from "../http/composition-html-editing-legacy-adoption-handler.server";
import { htmlLegacyAdoptionEnabled } from "../composition-html-editing-legacy-adoption-http-policy";
import { computeHtmlLegacyAdoptionRequestSha256 } from "../composition-html-editing-legacy-adoption-digest.server";
import { HtmlLegacyAdoptionPersistenceError } from "../composition-html-editing-legacy-adoption-repository.server";
import type { HtmlLegacyAdoptionCommand } from "../composition-html-editing-legacy-adoption.contract";

const uuid = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const baseUrl = "https://app.example/api/adopt/operations/operation";
const params = { draftId: uuid, clipId: "slide_intro", operationId: other };
const body = { candidateId: other, provenanceSha256: "a".repeat(64), expectedDocumentHash: "b".repeat(64) };
const command: HtmlLegacyAdoptionCommand = { organizationId: uuid, documentId: uuid, clipId: params.clipId,
  actorId: uuid, operationId: other, request: body };
const digest = computeHtmlLegacyAdoptionRequestSha256(command);
function setup() {
  const calls: string[] = [], commands: HtmlLegacyAdoptionCommand[] = [], logs: string[] = [];
  const receipt = { scope: "HTML_LEGACY_ADOPTION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED",
    owner: { actorId: uuid, organizationId: uuid, draftId: uuid }, clipId: params.clipId,
    operationId: other, requestSha256: digest, request: body,
    acknowledgment: { status: "CONFIRMED", compositionDocumentHash: "c".repeat(64),
      compositionDocumentVersion: 2, revisionVersion: 1, revisionSha256: "d".repeat(64) } };
  const state = { enabled: true, actorId: uuid as string | null,
    tenant: { organizationId: uuid, userId: uuid, platformRole: "ADMIN" as string | null } as { organizationId: string; userId: string; platformRole: string | null } | null,
    result: receipt as unknown, read: { status: "RECORDED", receipt } as unknown,
    rate: [{ allowed: true, reset_at: "2026-10-08T00:00:00Z" }] as unknown, failure: null as Error | null };
  const client = { rpc: (name: string, input: Record<string, unknown>) => ({ abortSignal: async (signal: AbortSignal) => {
    signal.throwIfAborted(); assert.equal(name, "consume_api_rate_limit"); assert.equal(input.p_window_seconds, 60);
    calls.push("quota"); return { data: state.rate, error: null };
  } }) } as unknown as SupabaseClient;
  const handle = createHtmlLegacyAdoptionHandler({ enabled: () => state.enabled,
    authenticate: async () => { calls.push("auth"); return { actorId: state.actorId, tenant: state.tenant }; },
    serviceClient: () => { calls.push("service"); return client; },
    commit: async (_client, input, signal) => { signal.throwIfAborted(); calls.push("commit"); commands.push(input);
      if (state.failure) throw state.failure; return state.result; },
    read: async (_client, input, signal) => { signal.throwIfAborted(); calls.push("read"); commands.push(input);
      if (state.failure) throw state.failure; return state.read; },
    logFailure: requestId => logs.push(requestId),
  });
  return { calls, commands, logs, receipt, state, handle };
}
function post(value: unknown = body, headers: Record<string, string> = {}) {
  return new Request(baseUrl, { method: "POST", headers: { origin: "https://app.example", "content-type": "application/json", ...headers }, body: JSON.stringify(value) });
}
function get(values: Record<string, string> = { ...body, requestSha256: digest }) {
  return new Request(`${baseUrl}?${new URLSearchParams(values)}`);
}

test("adoption HTTP derives scope from authenticated tenant, validates receipt and GET never writes", async () => {
  for (const method of ["GET", "POST"]) {
    const f = setup(), response = await f.handle(method === "GET" ? get() : post(), params);
    assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.ok(response.headers.get("x-request-id"));
    assert.deepEqual(f.calls, ["auth", "service", "quota", "quota", method === "GET" ? "read" : "commit"]);
    assert.deepEqual(f.commands, [command]); assert.equal((await response.json()).data.status, "RECORDED");
  }
});

test("adoption gates default closed and preserve receipt reads when new writes stop", () => {
  const environment = { COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED: "true",
    COMPOSITION_HTML_EDITING_LEGACY_ADOPTION_RECEIPTS_ENABLED: "true",
    COMPOSITION_HTML_EDITING_LEGACY_ADOPTION_ENABLED: "true", COMPOSITION_HTML_EDITING_MUTATIONS_ENABLED: "true" };
  assert.equal(htmlLegacyAdoptionEnabled("POST", environment), true);
  for (const key of Object.keys(environment)) assert.equal(htmlLegacyAdoptionEnabled("POST", { ...environment, [key]: "false" }), false);
  assert.equal(htmlLegacyAdoptionEnabled("GET", { ...environment, COMPOSITION_HTML_EDITING_LEGACY_ADOPTION_ENABLED: "false", COMPOSITION_HTML_EDITING_MUTATIONS_ENABLED: "false" }), true);
  assert.equal(htmlLegacyAdoptionEnabled("GET", {}), false);
  assert.equal(htmlLegacyAdoptionEnabled("GET", { ...environment, COMPOSITION_HTML_EDITING_LEGACY_ADOPTION_RECEIPTS_ENABLED: "TRUE" }), false);
});

test("method, gate, origin, cross-site and malformed URL reject before authentication", async () => {
  for (const [request, status] of [
    [new Request(baseUrl, { method: "PUT" }), 405],
    [post(body, { origin: "https://foreign.example" }), 403],
    [post(body, { "sec-fetch-site": "cross-site" }), 403],
    [new Request(baseUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), 403],
    [new Request(`${get().url}&candidateId=${uuid}`), 400],
    [new Request(`${baseUrl}?candidateId=${other}`), 400],
    [new Request(`${get().url}&extra=${"x".repeat(3000)}`), 400],
    [post(body, { "content-type": "text/plain" }), 415],
  ] as const) {
    const f = setup(); assert.equal((await f.handle(request, params)).status, status); assert.deepEqual(f.calls, []);
  }
  const disabled = setup(); disabled.state.enabled = false;
  assert.equal((await disabled.handle(post(), params)).status, 503); assert.deepEqual(disabled.calls, []);
  const invalid = setup(); assert.equal((await invalid.handle(post(), { ...params, draftId: "../escape" })).status, 400); assert.deepEqual(invalid.calls, []);
});

test("missing authentication, foreign tenant, inactive role and forged actor never obtain service client", async () => {
  for (const failure of ["actor", "tenant", "membership", "role", "invalid"] as const) {
    const f = setup();
    if (failure === "actor") f.state.actorId = null;
    else if (failure === "tenant") f.state.tenant = null;
    else if (failure === "membership") f.state.tenant!.userId = other;
    else if (failure === "role") f.state.tenant!.platformRole = "BUILDER";
    else f.state.actorId = "invalid";
    const response = await f.handle(post(), params);
    assert.equal(response.status, failure === "actor" ? 401 : 403); assert.deepEqual(f.calls, ["auth"]);
  }
});

test("request body cannot supply source, approvals, grants or authority and byte limits are enforced", async () => {
  for (const [value, status] of [[{ ...body, sourceHtml: "PRIVATE" }, 400], [{ ...body, approval: { reviewerId: uuid } }, 400],
    [{ ...body, grantedAssetIds: [uuid] }, 400], [{ ...body, organizationId: uuid }, 400],
    [{ ...body, encodedPilot: "x".repeat(2000) }, 413], [{ ...body, candidateId: "bad" }, 400]] as const) {
    const f = setup(), response = await f.handle(post(value), params);
    assert.equal(response.status, status); assert.equal(f.calls.includes("commit"), false);
    assert.equal(JSON.stringify(await response.json()).includes("PRIVATE"), false);
  }
  const f = setup(); assert.equal((await f.handle(new Request(baseUrl, { method: "POST", headers: {
    origin: "https://app.example", "content-type": "application/json" }, body: "{" }), params)).status, 400);
});

test("quota refusal and malformed rate authority fail closed without adoption", async () => {
  for (const [rate, status] of [[[{ allowed: false, reset_at: "2026-10-08T00:00:00Z" }], 429],
    [null, 503], [[], 503], [[{ allowed: true }], 503], [[{ allowed: "yes", reset_at: "2026-10-08T00:00:00Z" }], 503]] as const) {
    const f = setup(); f.state.rate = rate; const response = await f.handle(post(), params);
    assert.equal(response.status, status); assert.equal(f.calls.includes("commit"), false);
    if (status === 429) assert.equal(response.headers.get("Retry-After"), "60");
  }
});

test("HTTP rejects substituted receipt and ambiguous ACK safely without a second commit", async () => {
  for (const key of ["owner", "operation", "digest", "request", "scope", "oversized", "failure"] as const) {
    const f = setup();
    if (key === "failure") f.state.failure = new Error("PRIVATE_PROVIDER_SOURCE");
    else f.state.result = { ...f.receipt,
      ...(key === "owner" ? { owner: { ...f.receipt.owner, actorId: other } } : key === "operation" ? { operationId: uuid } :
        key === "digest" ? { requestSha256: "e".repeat(64) } : key === "request" ? { request: { ...body, expectedDocumentHash: "e".repeat(64) } } :
          key === "scope" ? { scope: "CURRENT" } : { secret: "x".repeat(5000) }),
    };
    const response = await f.handle(post(), params);
    assert.equal(response.status, 503); assert.equal(f.calls.filter(call => call === "commit").length, 1);
    const safe = JSON.stringify(await response.json()); assert.equal(safe.includes("PRIVATE"), false); assert.match(safe, /"retryable":false/);
    assert.equal(f.logs.length, 1);
  }
  const conflict = setup(); conflict.state.failure = new HtmlLegacyAdoptionPersistenceError("CONFLICT");
  assert.equal((await conflict.handle(post(), params)).status, 409);
});

test("GET missing receipt is read-only and identity mismatch never authorizes retry", async () => {
  const f = setup(); f.state.read = { status: "NOT_FOUND" };
  const response = await f.handle(get(), params); assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { status: "NOT_FOUND" }); assert.equal(f.calls.includes("commit"), false);
  const wrong = setup(); assert.equal((await wrong.handle(get({ ...body, requestSha256: "e".repeat(64) }), params)).status, 400);
  assert.equal(wrong.calls.includes("read"), false); assert.equal(wrong.calls.includes("commit"), false);
});

test("an aborted HTTP request fails before auth and cannot dispatch adoption", async () => {
  const f = setup(), abort = new AbortController(); abort.abort();
  const response = await f.handle(new Request(baseUrl, { method: "POST", signal: abort.signal,
    headers: { origin: "https://app.example", "content-type": "application/json" }, body: JSON.stringify(body) }), params);
  assert.equal(response.status, 503); assert.deepEqual(f.calls, []);
});
