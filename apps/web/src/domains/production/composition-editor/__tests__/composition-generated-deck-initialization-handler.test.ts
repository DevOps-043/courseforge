import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createGeneratedDeckInitializationHandler } from "../http/composition-generated-deck-initialization-handler.server";
import { computeGeneratedDeckInitializationRequestSha256 } from "../composition-generated-deck-initialization.server";

const uuid = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002";
function scenario() {
  const hash = "a".repeat(64), body = { operationId: other, expectedDocumentHash: hash, requestSha256: computeGeneratedDeckInitializationRequestSha256(hash) };
  const owner = { actorId: uuid, organizationId: uuid, draftId: uuid };
  const receipt = { scope: "GENERATED_DECK_INITIALIZATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED", owner, ...body,
    documentHash: "b".repeat(64), documentVersion: 2, items: [{ clipId: "slide-one", revisionVersion: 1, revisionSha256: "c".repeat(64),
      templateId: "generated-template", templateVersion: 1, sourceSha256: "d".repeat(64), manifestSha256: "e".repeat(64), created: true }] };
  const state = { enabled: true, actor: uuid as string | null, tenantUser: uuid, role: "ADMIN", allowed: true,
    rateFailure: false, failure: false, result: receipt as unknown, readResult: { status: "NOT_FOUND" } as unknown, reads: 0, writes: 0 };
  const limits: Array<Record<string, unknown>> = [];
  const client = { rpc: (_name: string, args: Record<string, unknown>) => ({ abortSignal: async () => {
    limits.push(args); return { error: state.rateFailure ? { message: "PRIVATE" } : null, data: [{ allowed: state.allowed }] };
  } }) } as unknown as SupabaseClient;
  const handler = createGeneratedDeckInitializationHandler({ enabled: () => state.enabled,
    authenticate: async () => ({ actorId: state.actor, tenant: { userId: state.tenantUser, organizationId: uuid, platformRole: state.role } }),
    serviceClient: () => client,
    read: async (_client, requestedOwner, identity) => {
      state.reads++; assert.deepEqual(requestedOwner, owner); assert.equal(identity.operationId, other);
      if (state.failure) throw new Error("SECRET PROVIDER DETAIL"); return state.readResult;
    },
    initialize: async (_client, requestedOwner, input) => {
      state.writes++; assert.deepEqual(requestedOwner, owner); assert.deepEqual(input, body);
      if (state.failure) throw new Error("SECRET PROVIDER DETAIL"); return state.result;
    },
    logFailure: () => { throw new Error("SECRET LOGGER DETAIL"); },
  });
  const request = (method = "POST", content: unknown = body, origin = "https://engine.example") => new Request(
    `https://engine.example/deck${method === "GET" ? `?operationId=${body.operationId}&requestSha256=${body.requestSha256}` : ""}`, {
      method, headers: { origin, "Content-Type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(content) } : {}),
    });
  return { state, body, receipt, limits, handler, request };
}

test("one authorized POST submits only authenticated owner, operation identity and saved CAS, with existing write quotas", async () => {
  const f = scenario(), response = await f.handler(f.request(), { draftId: uuid });
  assert.equal(response.status, 200); assert.equal(f.state.writes, 1); assert.equal(f.state.reads, 0);
  assert.deepEqual(f.limits.map(rate => rate.p_limit), [10, 3]);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const encoded = await response.text();
  for (const forbidden of ["sourceHtml", "storagePath", "grantedAssetIds", "SECRET"]) assert.ok(!encoded.includes(forbidden));
});

test("GET recovery reads metadata only, with no preparation/registration or automatic retry permission", async () => {
  const f = scenario(), response = await f.handler(f.request("GET"), { draftId: uuid });
  assert.equal(response.status, 200); assert.equal(f.state.reads, 1); assert.equal(f.state.writes, 0);
  assert.equal((await response.json()).data.status, "NOT_FOUND");
  assert.deepEqual(f.limits.map(rate => rate.p_limit), [60, 30]);
  f.state.readResult = { status: "RECORDED", receipt: f.receipt };
  assert.equal((await f.handler(f.request("GET"), { draftId: uuid })).status, 200);
  assert.equal(f.state.writes, 0);
});

test("feature gates, actor/tenant ownership, role, cross-origin and fail-closed quota prevent preparation", async () => {
  for (const mode of ["disabled", "actor", "tenant", "role", "origin", "quota", "rateFailure"] as const) {
    const f = scenario();
    if (mode === "disabled") f.state.enabled = false;
    if (mode === "actor") f.state.actor = null;
    if (mode === "tenant") f.state.tenantUser = other;
    if (mode === "role") f.state.role = "STUDENT";
    if (mode === "quota") f.state.allowed = false;
    if (mode === "rateFailure") f.state.rateFailure = true;
    const response = await f.handler(f.request("POST", undefined, mode === "origin" ? "https://evil.example" : undefined), { draftId: uuid });
    assert.equal(response.status, { disabled: 503, actor: 401, tenant: 403, role: 403, origin: 403, quota: 429, rateFailure: 503 }[mode]);
    assert.equal(f.state.writes, 0); assert.equal(f.state.reads, 0);
  }
});

test("forged client authority, digest mismatch, duplicate query, malformed JSON and large body are rejected", async () => {
  const f = scenario();
  for (const extra of [{ organizationId: other }, { templates: [] }, { grants: [] }, { sourceHtml: "forged" }, { requestSha256: "f".repeat(64) }])
    assert.equal((await f.handler(f.request("POST", { ...f.body, ...extra }), { draftId: uuid })).status, 400);
  assert.equal((await f.handler(f.request("POST", { padding: "x".repeat(4097) }), { draftId: uuid })).status, 413);
  const duplicate = new Request(`${f.request("GET").url}&operationId=${other}`);
  assert.equal((await f.handler(duplicate, { draftId: uuid })).status, 400);
  assert.equal((await f.handler(new Request("https://engine.example/deck", { method: "POST", headers: { origin: "https://engine.example", "Content-Type": "application/json" }, body: "{" }), { draftId: uuid })).status, 400);
  assert.equal(f.state.writes, 0);
});

test("lost ACK remains a safe nonretryable error and foreign or stale receipts are not returned as success", async () => {
  for (const mode of ["lost", "owner", "digest", "version", "scope"] as const) {
    const f = scenario();
    if (mode === "lost") f.state.failure = true;
    else f.state.result = { ...f.receipt, ...(mode === "owner" ? { owner: { ...f.receipt.owner, draftId: other } }
      : mode === "digest" ? { requestSha256: "f".repeat(64) } : mode === "version" ? { documentVersion: 0 } : { scope: "READY" }) };
    const response = await f.handler(f.request(), { draftId: uuid });
    assert.equal(response.status, 503); assert.equal(f.state.writes, 1);
    const encoded = await response.text();
    assert.match(encoded, /"retryable":false/); assert.doesNotMatch(encoded, /SECRET|PRIVATE/);
  }
});
