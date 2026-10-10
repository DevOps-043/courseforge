import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createHtmlHistoricalPublicationHandler } from "../http/composition-html-editing-historical-publication-handler.server";
import { htmlHistoricalPublicationEnabled } from "../composition-html-editing-historical-publication-http.contract";
import { historicalHtmlPublicationRequestPreimage } from "../composition-html-editing-historical-publication-preimage";
import { computeHistoricalHtmlPublicationDigest, consultHistoricalHtmlPublication,
  sendHistoricalHtmlPublication } from "../composition-html-editing-historical-publication.client";
import { createHtmlHistoricalCandidateHandler } from "../http/composition-html-editing-historical-candidate-handler.server";
import { consultHistoricalHtmlCandidate } from "../composition-html-editing-historical-candidate.client";
import { htmlHistoricalCandidateViewSchema } from "../composition-html-editing-historical-candidate.contract";
import { coordinateHistoricalHtmlPublication } from "../composition-html-editing-historical-publication-coordinator.client";
import { readHistoricalHtmlJournal } from "../composition-html-editing-historical-publication-journal.client";

const uuid = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const params = {draftId: uuid, operationId: uuid};
const body = {compositionId: uuid, candidateId: uuid, candidateSha256: "a".repeat(64)};
const command = {...params, actorId: uuid, organizationId: uuid, compositionId: uuid,
  request: {candidateId: uuid, candidateSha256: body.candidateSha256}};
const hash = createHash("sha256").update(historicalHtmlPublicationRequestPreimage(command)).digest("hex");
const receipt = {...command, scope: "HISTORICAL_PUBLICATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED",
  requestSha256: hash, originalRevisionId: uuid, originalProjectHash: "b".repeat(64), projectHash: "c".repeat(64),
  revisionId: other, revisionNumber: 2, activeRevisionIdAtCommit: uuid, currentDraftHashAtCommit: "d".repeat(64), activated: false, draftChanged: false};
const url = "https://app.example/api/history";
const getUrl = `${url}?${new URLSearchParams({...body, requestSha256: hash})}`;
const post = (value: unknown = body, headers: Record<string,string> = {}) => new Request(url, {method: "POST",
  headers: {origin: "https://app.example", "content-type": "application/json", ...headers}, body: JSON.stringify(value)});
function fixture() {
  const calls: string[] = [];
  const state = {enabled: true, actorId: uuid as string | null, tenantActor: uuid, role: "ADMIN", allowed: true,
    commit: receipt as unknown, read: {status: "RECORDED", receipt} as unknown, fail: false};
  const handle = createHtmlHistoricalPublicationHandler({enabled: () => state.enabled,
    authenticate: async () => {calls.push("auth"); return {actorId: state.actorId,
      tenant: {organizationId: uuid, userId: state.tenantActor, platformRole: state.role}};},
    serviceClient: () => ({rpc: (name: string) => ({abortSignal: async () => {
      assert.equal(name, "consume_api_rate_limit"); calls.push("quota");
      return {data: [{allowed: state.allowed, reset_at: "2026-10-09T00:00:00Z"}], error: null};
    }})}) as never,
    commit: async (_client, intent) => {calls.push("commit"); assert.deepEqual(intent, command);
      if (state.fail) throw new Error("SECRET_INTERNAL"); return state.commit;},
    read: async (_client, intent) => {calls.push("read"); assert.deepEqual(intent, command); return state.read;},
  });
  return {handle, calls, state};
}

test("historical HTTP POST commits identifiers only and GET recovers bound inactive receipt", async () => {
  for (const request of [post(), new Request(getUrl)]) {
    const fixtureState = fixture(), response = await fixtureState.handle(request, params);
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
    const envelope = await response.json(); assert.deepEqual(envelope.data, {status: "RECORDED", receipt});
    assert.equal(envelope.requestId, envelope.correlationId);
    assert.deepEqual(fixtureState.calls, ["auth", "quota", "quota", request.method === "POST" ? "commit" : "read"]);
  }
});

test("historical write gates fail closed while receipt reads survive mutation disable", () => {
  const environment = {COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED: "true", COMPOSITION_HTML_SNAPSHOT_RECOVERY_ENABLED: "true",
    COMPOSITION_HTML_SNAPSHOT_PUBLICATION_ENABLED: "true", COMPOSITION_HTML_EDITING_MUTATIONS_ENABLED: "true"};
  assert.equal(htmlHistoricalPublicationEnabled("POST", environment), true);
  assert.equal(htmlHistoricalPublicationEnabled("GET", {...environment, COMPOSITION_HTML_EDITING_MUTATIONS_ENABLED: "false"}), true);
  for (const key of Object.keys(environment)) assert.equal(htmlHistoricalPublicationEnabled("POST", {...environment, [key]: "TRUE"}), false);
  assert.equal(htmlHistoricalPublicationEnabled("GET", {}), false);
});

test("method, origins, query, params and content type reject before authority", async () => {
  for (const [request, status] of [[new Request(url, {method: "DELETE"}), 405],
    [post(body, {origin: "https://foreign.example"}), 403], [post(body, {"sec-fetch-site": "cross-site"}), 403],
    [post(body, {"content-type": "text/plain"}), 415], [new Request(getUrl + "&candidateId=" + uuid), 400],
    [new Request(getUrl + "&approval=true"), 400], [new Request(url), 400]] as const) {
    const fixtureState = fixture(); assert.equal((await fixtureState.handle(request, params)).status, status);
    assert.deepEqual(fixtureState.calls, []);
  }
  const fixtureState = fixture(); fixtureState.state.enabled = false;
  assert.equal((await fixtureState.handle(post(), params)).status, 503); assert.deepEqual(fixtureState.calls, []);
});

test("HTTP rejects actor/tenant/approval/source injection and oversized request without commit", async () => {
  for (const value of [{...body, actorId: other}, {...body, organizationId: other}, {...body, approval: true},
    {...body, archiveBytes: [1]}, {...body, sourceHtml: "<script>bad</script>"}, {...body, candidateSha256: "bad"},
    {...body, sourceHtml: "x".repeat(2000)}]) {
    const fixtureState = fixture(), response = await fixtureState.handle(post(value), params);
    assert.ok([400,413].includes(response.status)); assert.equal(fixtureState.calls.includes("commit"), false);
  }
});

test("authentication, tenant ownership, role and quotas fail before repository call", async () => {
  for (const failure of ["auth", "owner", "role", "quota"] as const) {
    const fixtureState = fixture();
    if (failure === "auth") fixtureState.state.actorId = null;
    if (failure === "owner") fixtureState.state.tenantActor = other;
    if (failure === "role") fixtureState.state.role = "BUILDER";
    if (failure === "quota") fixtureState.state.allowed = false;
    const response = await fixtureState.handle(post(), params);
    assert.equal(response.status, failure === "auth" ? 401 : failure === "quota" ? 429 : 403);
    assert.equal(fixtureState.calls.includes("commit"), false);
  }
});

test("HTTP rejects activated, owner-swapped, request-swapped and oversized receipts", async () => {
  for (const patch of [{activated: true}, {draftChanged: true}, {actorId: other}, {requestSha256: "e".repeat(64)},
    {request: {...command.request, candidateId: other}}, {sourceHtml: "x".repeat(6000)}]) {
    for (const method of ["POST", "GET"]) {
      const fixtureState = fixture(); fixtureState.state.commit = {...receipt, ...patch};
      fixtureState.state.read = {status: "RECORDED", receipt: fixtureState.state.commit};
      const response = await fixtureState.handle(method === "POST" ? post() : new Request(getUrl), params);
      assert.equal(response.status, 503); assert.equal((await response.json()).retryable, false);
    }
  }
});

test("NOT_FOUND remains read-only and private POST errors expose no provider details or retries", async () => {
  const fixtureState = fixture(); fixtureState.state.read = {status: "NOT_FOUND"};
  assert.deepEqual((await (await fixtureState.handle(new Request(getUrl), params)).json()).data, {status: "NOT_FOUND"});
  assert.equal(fixtureState.calls.includes("commit"), false);
  fixtureState.state.fail = true;
  const response = await fixtureState.handle(post(), params);
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /SECRET_INTERNAL/);
  assert.equal(fixtureState.calls.filter(call => call === "commit").length, 1);
});

test("GET digest substitution and cancellation cannot call the repository", async () => {
  const fixtureState = fixture();
  assert.equal((await fixtureState.handle(new Request(getUrl.replace(hash, "e".repeat(64))), params)).status, 400);
  const controller = new AbortController(); controller.abort();
  assert.equal((await fixtureState.handle(new Request(getUrl, {signal: controller.signal}), params)).status, 503);
  assert.equal(fixtureState.calls.includes("read"), false);
});

test("browser digest matches server and client transports integrate with HTTP using session-derived owner", async () => {
  const fixtureState = fixture(); const methods: string[] = [];
  assert.equal(await computeHistoricalHtmlPublicationDigest(command), hash);
  const fetcher = async (target: unknown, init?: RequestInit) => {
    assert.equal(init?.credentials, "same-origin"); assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store");
    const request = new Request(new URL(String(target), "https://app.example"), {...init,
      headers: {...init?.headers, origin: "https://app.example"}});
    methods.push(request.method); return fixtureState.handle(request, params);
  };
  const input = {command, requestSha256: hash, signal: new AbortController().signal, fetcher: fetcher as typeof fetch};
  assert.deepEqual(await sendHistoricalHtmlPublication(input), receipt);
  assert.deepEqual(await consultHistoricalHtmlPublication(input), {status: "RECORDED", receipt});
  assert.deepEqual(methods, ["POST", "GET"]);
});

test("client rejects bad local digest before network and never retries unconfirmed POST", async () => {
  let calls = 0;
  const input = {command, requestSha256: "f".repeat(64), signal: new AbortController().signal,
    fetcher: (async () => {calls++; throw new Error("PRIVATE_TRANSPORT");}) as typeof fetch};
  await assert.rejects(sendHistoricalHtmlPublication(input), /OUTCOME_UNCONFIRMED/); assert.equal(calls, 0);
  await assert.rejects(sendHistoricalHtmlPublication({...input, requestSha256: hash}), /OUTCOME_UNCONFIRMED/); assert.equal(calls, 1);
});

test("client bounds and validates receipts, rejects active ACK and accepts NOT_FOUND only for GET", async () => {
  const input = {command, requestSha256: hash, signal: new AbortController().signal};
  for (const data of [{status: "RECORDED", receipt: {...receipt, activated: true}},
    {status: "RECORDED", receipt: {...receipt, actorId: other}}, {status: "RECORDED", receipt: {...receipt, privateSource: "x".repeat(8000)}},
    {status: "NOT_FOUND"}]) {
    const fetcher = (async () => Response.json({success: true, data, requestId: uuid, correlationId: uuid})) as typeof fetch;
    await assert.rejects(sendHistoricalHtmlPublication({...input, fetcher}), /OUTCOME_UNCONFIRMED/);
    if (data.status === "NOT_FOUND") assert.deepEqual(await consultHistoricalHtmlPublication({...input, fetcher}), data);
    else await assert.rejects(consultHistoricalHtmlPublication({...input, fetcher}), /OUTCOME_UNCONFIRMED/);
  }
});

function candidateFixture() {
  const request = {actorId: uuid, organizationId: uuid, compositionId: uuid, draftId: uuid, request: command.request};
  const provenance = {organizationId: uuid, compositionId: uuid, draftId: uuid, candidateId: uuid,
    originalRevisionId: uuid, originalProjectHash: "b".repeat(64), originalBundleSha256: "c".repeat(64),
    documentId: uuid, documentHash: "d".repeat(64), candidateBundleSha256: "e".repeat(64),
    publicationMode: "HISTORICAL_REVISION_WITHOUT_ACTIVATION_OR_DRAFT_CHANGE"};
  const view = {...request, scope: "AUTHORIZED_HISTORICAL_CANDIDATE_NOT_PUBLISHED_OR_RENDERED", provenance,
    projectHash: receipt.projectHash, approval: {reviewerId: other, evidenceSha256: "a".repeat(64), reviewedProjectHash: receipt.projectHash,
      completedReviews: ["HISTORICAL_VISUAL_COMPARISON", "CURRENT_CONTENT_AND_ACCESSIBILITY", "AUTHORIZED_REPUBLICATION"]}};
  const calls: string[] = [], state = {result: view as unknown};
  const handle = createHtmlHistoricalCandidateHandler({enabled: () => true,
    authenticate: async () => ({actorId: uuid, tenant: {organizationId: uuid, userId: uuid, platformRole: "ADMIN"}}),
    serviceClient: () => ({rpc: () => ({abortSignal: async () => {calls.push("quota");
      return {data: [{allowed: true, reset_at: "2026-10-09T00:00:00Z"}], error: null};}})}) as never,
    read: async (_client, input) => {calls.push("read"); assert.deepEqual(input, request); return state.result;},
  });
  const fetcher = (async (target, init) => {
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store");
    return handle(new Request(new URL(String(target), "https://app.example"), init), {draftId: uuid, candidateId: uuid});
  }) as typeof fetch;
  return {request, view, state, calls, handle, fetcher};
}
test("approved candidate client/HTTP GET is bounded, owner-derived and exposes metadata only", async () => {
  const fixtureState = candidateFixture();
  assert.deepEqual(await consultHistoricalHtmlCandidate({request: fixtureState.request, signal: new AbortController().signal,
    fetcher: fixtureState.fetcher}), fixtureState.view);
  assert.deepEqual(fixtureState.calls, ["quota", "quota", "read"]);
});
test("candidate transport rejects swapped owner, original scope, approval pin and private bundle", async () => {
  for (const patch of [{actorId: other}, {provenance: {...candidateFixture().view.provenance, organizationId: other}},
    {approval: {...candidateFixture().view.approval, reviewedProjectHash: "a".repeat(64)}}, {encodedBundle: "PRIVATE"}]) {
    const fixtureState = candidateFixture(); fixtureState.state.result = {...fixtureState.view, ...patch};
    await assert.rejects(consultHistoricalHtmlCandidate({request: fixtureState.request,
      signal: new AbortController().signal, fetcher: fixtureState.fetcher}), /CANDIDATE_UNAVAILABLE/);
  }
});
test("candidate HTTP rejects POST, duplicate digest, approval injection and foreign origin without reading", async () => {
  const target = `${url}?compositionId=${uuid}&candidateSha256=${body.candidateSha256}`;
  for (const [request, status] of [[new Request(target, {method: "POST"}), 405],
    [new Request(target + "&candidateSha256=" + body.candidateSha256), 400],
    [new Request(target + "&approval=true"), 400], [new Request(target, {headers: {origin: "https://foreign.example"}}), 403]] as const) {
    const fixtureState = candidateFixture();
    assert.equal((await fixtureState.handle(request, {draftId: uuid, candidateId: uuid})).status, status);
    assert.deepEqual(fixtureState.calls, []);
  }
});

function coordinatorFixture() {
  const candidate = candidateFixture(), publication = fixture(), values = new Map<string,string>(), methods: string[] = [];
  const scope = {actorId: uuid, organizationId: uuid, compositionId: uuid, draftId: uuid};
  const storage = {getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, raw: string) => {values.set(key, raw);},
    removeItem: () => {throw new Error("no implicit cleanup");}};
  const fetcher = (async (target, init) => {
    methods.push(`${init?.method}:${String(target).includes("html-historical-candidates") ? "candidate" : "operation"}`);
    if (String(target).includes("html-historical-candidates")) return candidate.fetcher(target, init);
    if (init?.method === "POST") {
      const journal = await readHistoricalHtmlJournal(storage, scope);
      assert.equal(journal.status, "PENDING"); if (journal.status === "PENDING") assert.equal(journal.entry.command.operationId, uuid);
    }
    return publication.handle(new Request(new URL(String(target), "https://app.example"), {...init,
      headers: {...init?.headers, origin: "https://app.example"}}), params);
  }) as typeof fetch;
  const input = {scope, storage, lock: {runExclusive: async <T>(_scope: unknown, task: () => Promise<T>) => task()},
    signal: new AbortController().signal, isCurrent: () => true, fetcher, createOperationId: () => uuid,
    action: {mode: "SEND" as const, candidate: htmlHistoricalCandidateViewSchema.parse(candidate.view), confirmedHistoricalOnly: true as const}};
  return {input, candidate, publication, methods, values};
}
test("coordinator verifies candidate then persists intent before the only POST; cached ACK recovery still GETs", async () => {
  const fixtureState = coordinatorFixture();
  assert.deepEqual(await coordinateHistoricalHtmlPublication(fixtureState.input), receipt);
  assert.deepEqual(fixtureState.methods, ["GET:candidate", "POST:operation"]);
  assert.deepEqual(await coordinateHistoricalHtmlPublication({...fixtureState.input, action: {mode: "RECOVER", operationId: uuid}}), receipt);
  assert.deepEqual(fixtureState.methods, ["GET:candidate", "POST:operation", "GET:operation"]);
  assert.equal(fixtureState.values.size, 1);
});
test("uncertain coordinator POST retains intent, prevents a second SEND and recovers only via GET", async () => {
  const fixtureState = coordinatorFixture(); fixtureState.publication.state.fail = true;
  await assert.rejects(coordinateHistoricalHtmlPublication(fixtureState.input), /OUTCOME_UNKNOWN/);
  await assert.rejects(coordinateHistoricalHtmlPublication(fixtureState.input), /NOT_READY/);
  assert.deepEqual(fixtureState.methods, ["GET:candidate", "POST:operation"]);
  assert.deepEqual(await coordinateHistoricalHtmlPublication({...fixtureState.input, action: {mode: "RECOVER", operationId: uuid}}), receipt);
  assert.deepEqual(fixtureState.methods, ["GET:candidate", "POST:operation", "GET:operation"]);
});
test("NOT_FOUND recovery keeps pending operation without reapproval, source recompilation or POST", async () => {
  const fixtureState = coordinatorFixture(); fixtureState.publication.state.fail = true;
  await assert.rejects(coordinateHistoricalHtmlPublication(fixtureState.input));
  fixtureState.publication.state.read = {status: "NOT_FOUND"};
  await assert.rejects(coordinateHistoricalHtmlPublication({...fixtureState.input, action: {mode: "RECOVER", operationId: uuid}}), /ACK_REQUIRED/);
  const state = await readHistoricalHtmlJournal(fixtureState.input.storage, fixtureState.input.scope);
  assert.equal(state.status, "PENDING"); assert.deepEqual(fixtureState.methods, ["GET:candidate", "POST:operation", "GET:operation"]);
});
test("coordinator refuses unavailable persistence, lock, scope fence and unconfirmed semantics before POST", async () => {
  for (const failure of ["storage", "lock", "fence", "confirmation"] as const) {
    const fixtureState = coordinatorFixture();
    const input = {...fixtureState.input, ...(failure === "storage" ? {storage: null} : failure === "lock" ? {lock: null}
      : failure === "fence" ? {isCurrent: () => false} : {action: {...fixtureState.input.action, confirmedHistoricalOnly: false}})};
    await assert.rejects(coordinateHistoricalHtmlPublication(input as never));
    assert.deepEqual(fixtureState.methods, []);
  }
});
test("candidate evidence drift and failed local readback cannot dispatch historical registration", async () => {
  for (const failure of ["drift", "storage"] as const) {
    const fixtureState = coordinatorFixture();
    if (failure === "drift") fixtureState.candidate.state.result = {...fixtureState.candidate.view,
      approval: {...fixtureState.candidate.view.approval, evidenceSha256: "b".repeat(64)}};
    const input = {...fixtureState.input, ...(failure === "storage" ? {storage: {...fixtureState.input.storage, setItem: () => {}}} : {})};
    await assert.rejects(coordinateHistoricalHtmlPublication(input));
    assert.deepEqual(fixtureState.methods, ["GET:candidate"]);
  }
});

test("coordinator cannot acknowledge a different ZIP or original snapshot despite a matching operation", async () => {
  for (const patch of [{projectHash: "e".repeat(64)}, {originalRevisionId: "33333333-3333-4333-8333-333333333333"},
    {originalProjectHash: "e".repeat(64)}]) {
    const fixtureState = coordinatorFixture(); fixtureState.publication.state.commit = {...receipt, ...patch};
    await assert.rejects(coordinateHistoricalHtmlPublication(fixtureState.input), /OUTCOME_UNKNOWN/);
    const state = await readHistoricalHtmlJournal(fixtureState.input.storage, fixtureState.input.scope);
    assert.equal(state.status, "PENDING"); if (state.status === "PENDING") assert.equal(state.entry.receipt, undefined);
  }
});

test("explicit history closure reauthorizes cached receipt via GET and removes only the local journal", async () => {
  const fixtureState = coordinatorFixture(); await coordinateHistoricalHtmlPublication(fixtureState.input);
  const input = {...fixtureState.input, storage: {...fixtureState.input.storage, removeItem: (key: string) => {fixtureState.values.delete(key);}},
    action: {mode: "CLOSE_HISTORY" as const, operationId: uuid, confirmedHistoryOnly: true as const}};
  assert.deepEqual(await coordinateHistoricalHtmlPublication(input), receipt);
  assert.deepEqual(fixtureState.methods, ["GET:candidate", "POST:operation", "GET:operation"]);
  assert.deepEqual(await readHistoricalHtmlJournal(input.storage, input.scope), {status: "EMPTY"});
});

test("history closure fails closed on NOT_FOUND, denied deletion and missing explicit confirmation", async () => {
  for (const failure of ["not-found", "delete", "confirmation"] as const) {
    const fixtureState = coordinatorFixture(); await coordinateHistoricalHtmlPublication(fixtureState.input);
    if (failure === "not-found") fixtureState.publication.state.read = {status: "NOT_FOUND"};
    await assert.rejects(coordinateHistoricalHtmlPublication({...fixtureState.input, action: {mode: "CLOSE_HISTORY",
      operationId: uuid, confirmedHistoryOnly: failure !== "confirmation"}} as never));
    assert.equal((await readHistoricalHtmlJournal(fixtureState.input.storage, fixtureState.input.scope)).status, "PENDING");
    assert.equal(fixtureState.methods.filter(method => method === "POST:operation").length, 1);
    assert.equal(fixtureState.methods.filter(method => method === "GET:operation").length, failure === "confirmation" ? 0 : 1);
  }
});

test("owner fence changing after receipt consultation cannot close journal", async () => {
  const fixtureState = coordinatorFixture(); await coordinateHistoricalHtmlPublication(fixtureState.input);
  let current = true;
  await assert.rejects(coordinateHistoricalHtmlPublication({...fixtureState.input,
    storage: {...fixtureState.input.storage, removeItem: (key: string) => {fixtureState.values.delete(key);}},
    isCurrent: () => current,
    fetcher: (async (target, init) => {const response = await fixtureState.input.fetcher(target, init); current = false; return response;}) as typeof fetch,
    action: {mode: "CLOSE_HISTORY", operationId: uuid, confirmedHistoryOnly: true}}), /TRACKING_CHANGED/);
  assert.equal(fixtureState.values.size, 1);
});

test("historical UI wiring is draft-rooted, keyed by owner and cannot adopt native state (structural, not browser QA)", async () => {
  const root = "src/domains/materials/components/composition-editor/";
  const center = await readFile(root + "CompositionHtmlRecoveryCenter.tsx", "utf8");
  const panel = await readFile(root + "CompositionHtmlHistoricalPublicationPanel.tsx", "utf8");
  const preview = await readFile(root + "NativeCompositionPreview.tsx", "utf8");
  assert.match(preview, /<CompositionHtmlRecoveryCenter/);
  assert.match(center, /<CompositionHtmlHistoricalPublicationPanel key=\{`historical-publication:\$\{context.key\}:\$\{compositionId\}`\}/);
  assert.match(panel, /if \(!readsEnabled && tracking.status === "EMPTY"\) return null/);
  assert.match(panel, /useAuthStore.getState\(\).user\?\.id === context.actorId/);
  assert.match(panel, /activeOrganizationId === context.organizationId/);
  assert.match(panel, /window.removeEventListener\("storage", changed\)/);
  assert.match(panel, /historicalHtmlJournalStorageKey\(context\)/);
  assert.match(panel, /mode: "CLOSE_HISTORY"/); assert.match(panel, /confirmedHistoricalOnly: true/);
  assert.doesNotMatch(panel, /\b(?:applyPatch|acceptVerified|adoptNative|setActiveRevision|restoreSnapshot|recordApproval)\s*\(/);
});
