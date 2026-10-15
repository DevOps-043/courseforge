import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHtmlSnapshotHistoryHandler } from "../http/composition-html-editing-snapshot-history-handler.server";
import { htmlSnapshotHistoryEnabled } from "../composition-html-editing-snapshot-history-http.contract";
import { consultHtmlSnapshotHistory } from "../composition-html-editing-snapshot-history.client";
import type { HtmlSnapshotHistoryRequest, HtmlSnapshotHistoryPage } from "../composition-html-editing-snapshot-history.contract";

const uuid = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const scope = { actorId: uuid, organizationId: uuid, compositionId: uuid, draftId: uuid };
const url = `https://app.example/api/history?compositionId=${uuid}`, params = { draftId: uuid };
function fixture() {
  const page: HtmlSnapshotHistoryPage = { ...scope, scope: "AUTHORIZED_HISTORY_METADATA_NOT_CONTENT_OR_EXECUTION_AUTHORITY",
    ceilingRevision: 0, entries: [], nextCursor: null };
  const calls: string[] = [], commands: HtmlSnapshotHistoryRequest[] = [];
  const state = { enabled: true, actorId: uuid as string | null, tenantActor: uuid, role: "ADMIN", quota: true, result: page as unknown, fail: false };
  const client = { rpc: (name: string, input: Record<string, unknown>) => ({ abortSignal: async (signal: AbortSignal) => {
    signal.throwIfAborted(); assert.equal(name, "consume_api_rate_limit"); assert.ok(String(input.p_rate_key).startsWith("html-snapshot-history:"));
    calls.push("quota"); return { data: [{ allowed: state.quota, reset_at: "2026-10-09T00:00:00Z" }], error: null };
  } }) } as unknown as SupabaseClient;
  const handle = createHtmlSnapshotHistoryHandler({ enabled: () => state.enabled,
    authenticate: async () => { calls.push("auth"); return { actorId: state.actorId,
      tenant: { organizationId: uuid, userId: state.tenantActor, platformRole: state.role } }; },
    serviceClient: () => { calls.push("service"); return client; },
    read: async (_client, command, signal) => { signal.throwIfAborted(); calls.push("read"); commands.push(command);
      if (state.fail) throw new Error("PRIVATE_HISTORY_PATH"); return state.result; },
  });
  return { page, calls, commands, state, handle };
}

test("history HTTP derives actor/tenant from session, reuses bounded GET security and never writes", async () => {
  const f = fixture(), response = await f.handle(new Request(url), params);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(f.calls, ["auth", "service", "quota", "quota", "read"]);
  assert.deepEqual(f.commands, [{ ...scope, cursor: null }]); assert.deepEqual((await response.json()).data, f.page);
});

test("history cursor transport is canonical, paired and session-scoped", async () => {
  const f = fixture(); f.state.result = { ...f.page, ceilingRevision: 20 };
  assert.equal((await f.handle(new Request(`${url}&ceilingRevision=20&afterRevision=20`), params)).status, 200);
  assert.deepEqual(f.commands[0]!.cursor, { ...scope, ceilingRevision: 20, afterRevision: 20 });
  for (const query of ["&ceilingRevision=20", "&afterRevision=0", "&ceilingRevision=2&afterRevision=3", "&ceilingRevision=02&afterRevision=0",
    "&ceilingRevision=2147483648&afterRevision=0", "&actorId=" + other, "&compositionId=" + uuid, "&sourceHtml=PRIVATE"]) {
    const rejected = fixture(); assert.equal((await rejected.handle(new Request(url + query), params)).status, 400); assert.deepEqual(rejected.calls, []);
  }
});

test("history gates default closed and method/origin/abort reject before authentication", async () => {
  const environment = { COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED: "true", COMPOSITION_HTML_SNAPSHOT_RECOVERY_ENABLED: "true" };
  assert.equal(htmlSnapshotHistoryEnabled(environment), true); assert.equal(htmlSnapshotHistoryEnabled({}), false);
  for (const key of Object.keys(environment)) assert.equal(htmlSnapshotHistoryEnabled({ ...environment, [key]: "false" }), false);
  for (const [request, expected] of [[new Request(url, { method: "POST" }), 405],
    [new Request(url, { headers: { origin: "https://foreign.test" } }), 403],
    [new Request(url, { headers: { "sec-fetch-site": "cross-site" } }), 403]] as const) {
    const f = fixture(); assert.equal((await f.handle(request, params)).status, expected); assert.deepEqual(f.calls, []);
  }
  const f = fixture(); f.state.enabled = false;
  assert.equal((await f.handle(new Request(url), params)).status, 503); assert.deepEqual(f.calls, []);
  const aborted = fixture(), abort = new AbortController(); abort.abort();
  assert.equal((await aborted.handle(new Request(url, { signal: abort.signal }), params)).status, 503); assert.deepEqual(aborted.calls, []);
});

test("history auth/membership/roles/quota and response substitutions fail safely", async () => {
  for (const failure of ["auth", "membership", "role", "quota", "scope", "response", "failure"] as const) {
    const f = fixture();
    if (failure === "auth") f.state.actorId = null;
    else if (failure === "membership") f.state.tenantActor = other;
    else if (failure === "role") f.state.role = "BUILDER";
    else if (failure === "quota") f.state.quota = false;
    else if (failure === "scope") f.state.result = { ...f.page, organizationId: other };
    else if (failure === "response") f.state.result = { ...f.page, source: "PRIVATE".repeat(20_000) };
    else f.state.fail = true;
    const response = await f.handle(new Request(url), params);
    assert.equal(response.status, failure === "auth" ? 401 : failure === "quota" ? 429 : ["membership", "role"].includes(failure) ? 403 : 503);
    assert.equal(JSON.stringify(await response.json()).includes("PRIVATE"), false);
    if (["auth", "membership", "role"].includes(failure)) assert.deepEqual(f.calls, ["auth"]);
    if (failure === "quota") assert.equal(f.calls.includes("read"), false);
  }
});

test("history client sends one GET per explicit page with no redirect or automatic pagination", async () => {
  const f = fixture(), requests: string[] = [];
  const fetcher: typeof fetch = async (path, options) => {
    requests.push(String(path)); assert.equal(options?.method, "GET"); assert.equal(options?.credentials, "same-origin"); assert.equal(options?.redirect, "error");
    return Response.json({ success: true, requestId: uuid, correlationId: uuid, data: f.state.result });
  };
  assert.deepEqual(await consultHtmlSnapshotHistory({ request: { ...scope, cursor: null }, signal: new AbortController().signal, fetcher }), f.page);
  f.state.result = { ...f.page, ceilingRevision: 20 };
  await consultHtmlSnapshotHistory({ request: { ...scope, cursor: { ...scope, ceilingRevision: 20, afterRevision: 20 } }, signal: new AbortController().signal, fetcher });
  assert.equal(requests.length, 2); assert.ok(requests[1]!.endsWith("ceilingRevision=20&afterRevision=20"));
  assert.ok(requests[0]!.includes(`/drafts/${uuid}/html-snapshot-history?`));
  assert.equal(requests.some(path => path.includes("html-editing/history")), false);
  assert.equal(requests.some(path => path.includes("actorId") || path.includes("organizationId")), false);
});

test("history client rejects altered owner/correlation/watermark, unknown payload and aborted reads", async () => {
  for (const failure of ["owner", "correlation", "watermark", "source"] as const) {
    const f = fixture(), data = { ...f.page, ...(failure === "owner" ? { actorId: other }
      : failure === "source" ? { sourceHtml: "PRIVATE" } : { ceilingRevision: failure === "watermark" ? 21 : 20 }) };
    await assert.rejects(consultHtmlSnapshotHistory({ request: { ...scope, cursor: { ...scope, ceilingRevision: 20, afterRevision: 20 } },
      signal: new AbortController().signal, fetcher: async () => Response.json({ success: true, requestId: uuid,
        correlationId: failure === "correlation" ? other : uuid, data }) }), /READ_UNAVAILABLE/);
  }
  const abort = new AbortController(); abort.abort(); let calls = 0;
  await assert.rejects(consultHtmlSnapshotHistory({ request: { ...scope, cursor: null }, signal: abort.signal,
    fetcher: async () => { calls++; throw new Error(); } })); assert.equal(calls, 0);
});
