import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHtmlSnapshotInspectionHandler } from "../http/composition-html-editing-snapshot-inspection-handler.server";
import { consultHtmlSnapshotInspection } from "../composition-html-editing-snapshot-inspection.client";

const uuid = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const command = { actorId: uuid, organizationId: uuid, compositionId: uuid, draftId: uuid, revisionId: uuid };
const result = { ...command, scope: "AUTHORIZED_ARCHIVE_DIAGNOSTIC_NOT_EXECUTION_OR_PUBLICATION",
  documentId: uuid, documentHash: "a".repeat(64), projectHash: "b".repeat(64), bundleSha256: "c".repeat(64),
  diagnostic: { scope: "OFFLINE_COMPATIBILITY_NOT_AUTHORIZATION", status: "LEGACY_V1_REQUIRES_REVIEW", revisionCount: 1, profileDifferences: [] } };
const url = `https://app.test/api/production/hyperframes/drafts/${uuid}/html-snapshot-history/${uuid}/inspection?compositionId=${uuid}`;
function fixture() {
  const state = { reads: 0, rates: 0, enabled: true, actorId: uuid as string | null, role: "ADMIN", allowed: true,
    response: result as unknown };
  const client = { rpc: (name: string, parameters: Record<string, unknown>) => ({ abortSignal: async () => {
    assert.equal(name, "consume_api_rate_limit"); state.rates++;
    assert.equal(parameters.p_limit, state.rates === 1 ? 10 : 3);
    return { data: [{ allowed: state.allowed, reset_at: "2026-10-09T12:00:00Z" }], error: null };
  } }) } as unknown as SupabaseClient;
  const handle = createHtmlSnapshotInspectionHandler({ enabled: () => state.enabled,
    authenticate: async () => ({ actorId: state.actorId, tenant: { userId: uuid, organizationId: uuid, platformRole: state.role } }),
    serviceClient: () => client, read: async (_client, request, signal) => {
      signal.throwIfAborted(); state.reads++; assert.deepEqual(request, command); return state.response;
    },
  });
  return { state, handle, params: { draftId: uuid, revisionId: uuid } };
}

test("inspection GET derives authenticated identity, has independent quotas and no-store diagnostic response", async () => {
  const f = fixture(), response = await f.handle(new Request(url), f.params);
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control")!, /no-store/);
  const body = await response.json(); assert.deepEqual(body.data, result);
  assert.equal(body.requestId, body.correlationId); assert.equal(f.state.rates, 2); assert.equal(f.state.reads, 1);
});

test("inspection gates, origin, method, strict query, roles and quotas reject before content reads", async () => {
  for (const failure of ["gate", "origin", "method", "actor", "query", "duplicate", "role", "rate"] as const) {
    const f = fixture(); let target = url, method = "GET", headers: Record<string, string> = {};
    if (failure === "gate") f.state.enabled = false;
    if (failure === "origin") headers = { origin: "https://attacker.test" };
    if (failure === "method") method = "POST";
    if (failure === "actor") f.state.actorId = null;
    if (failure === "query") target += `&actorId=${uuid}`;
    if (failure === "duplicate") target += `&compositionId=${uuid}`;
    if (failure === "role") f.state.role = "builder";
    if (failure === "rate") f.state.allowed = false;
    const response = await f.handle(new Request(target, { method, headers }), f.params);
    assert.notEqual(response.status, 200); assert.equal(f.state.reads, 0);
  }
});

test("inspection response rejects swapped scope and source/storage authority extensions", async () => {
  for (const change of [{ revisionId: other }, { organizationId: other }, { bundle: { sourceHtml: "secret" } },
    { storagePath: "private/path" }, { diagnostic: { ...result.diagnostic, status: "COMPATIBLE" } }]) {
    const f = fixture(); f.state.response = { ...result, ...change };
    const response = await f.handle(new Request(url), f.params);
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /secret|private\/path|COMPATIBLE/);
  }
});

test("inspection client does one bounded GET and rejects owner/correlation/payload substitution", async () => {
  for (const failure of ["none", "owner", "correlation", "source", "size"] as const) {
    let calls = 0;
    const fetcher = (async (target: string, options: RequestInit) => {
      calls++; assert.equal(new URL(target, "https://app.test").href, url);
      assert.equal(options.method, "GET"); assert.equal(options.credentials, "same-origin");
      assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store");
      return Response.json({ success: true, requestId: uuid, correlationId: failure === "correlation" ? other : uuid,
        data: { ...result, ...(failure === "owner" ? { actorId: other } : failure === "source" ? { sourceHtml: "private" }
          : failure === "size" ? { sourceHtml: "a".repeat(20 * 1024) } : {}) } });
    }) as typeof fetch;
    const input = { request: command, signal: new AbortController().signal, fetcher };
    if (failure === "none") assert.deepEqual(await consultHtmlSnapshotInspection(input), result);
    else await assert.rejects(consultHtmlSnapshotInspection(input), /READ_UNAVAILABLE/);
    assert.equal(calls, 1);
  }
});

test("cancelled inspection client does not send a request", async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(consultHtmlSnapshotInspection({ request: command, signal: controller.signal,
    fetcher: (async () => { calls++; throw new Error(); }) as typeof fetch }));
  assert.equal(calls, 0);
});
