import assert from "node:assert/strict";
import test from "node:test";
import { createNarrativeDocumentFixture } from "./fixtures/composition-narrative.fixture";
import { deriveNarrativeNavigationOccurrences } from "../composition-narrative-occurrence.service";
import { queryNarrativeVoiceExtraction } from "../composition-narrative-extraction-query";
import { fingerprintNarrativeExtractionRequest, type NarrativeExtractionReceipt } from "../composition-narrative-extraction-apply.service";
import { narrativeExtractionCommandResultSchema, type NarrativeExtractionApplyRequest } from "../composition-narrative-extraction-contract";
import { createNarrativeExtractionHttpHandler, type NarrativeExtractionHttpDependencies } from "../http/composition-narrative-extraction-handler.server";
import { resolveNarrativeExtractionTrustedOrigin, parseNarrativeExtractionHttpBody } from "../http/composition-narrative-extraction-http-policy";

const origin = "https://courseforge.example";
const organizationId = "33333333-3333-4333-8333-333333333333";
const componentId = "44444444-4444-4444-8444-444444444444";
const draftId = "55555555-5555-4555-8555-555555555555";
const userId = "66666666-6666-4666-8666-666666666666";
const commandId = "77777777-7777-4777-8777-777777777777";
const requestId = "88888888-8888-4888-8888-888888888888";

function request(body: unknown, headers: Record<string, string> = {}, method = "POST", query = "") {
  return new Request(`${origin}/commands${query}`, { method, headers: { origin, "content-type": "application/json",
    "sec-fetch-site": "same-origin", "x-request-id": requestId, ...headers },
    ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) });
}

async function fixture() {
  const document = createNarrativeDocumentFixture();
  const occurrence = deriveNarrativeNavigationOccurrences(document).occurrences[0]!;
  const documentHash = "b".repeat(64);
  const selection = { documentHash, occurrenceId: occurrence.id, firstSourceIndex: 1, lastSourceIndex: 2 };
  const calls = { auth: 0, rate: 0, services: 0, commit: 0, receipt: 0 };
  const failures: Array<{ requestId: string; commandId?: string; error: unknown }> = [];
  let receipt: NarrativeExtractionReceipt | null = null;
  const reads = { async readComponentId() { return componentId; }, async readDocument() { return { document, documentHash }; },
    async readLinkedAsset() { return { id: occurrence.assetId, organization_id: organizationId, material_component_id: componentId,
      asset_type: "VOICE_AUDIO", mime_type: "audio/mpeg", checksum: "c".repeat(64), qa_status: "READY_FOR_QA",
      duration_milliseconds: 10_000, metadata: { script_hash: occurrence.scriptHash, word_timestamps: document.narrativeScenes![0]!.wordTimestamps } }; } };
  const review = await queryNarrativeVoiceExtraction({ draftId, organizationId, selection, repository: reads });
  assert.ok(review.ok);
  const command: NarrativeExtractionApplyRequest = { contract: "NARRATIVE_VOICE_EXTRACTION_APPLY_V1", commandId,
    selection, reviewFingerprint: review.summary.reviewFingerprint };
  const expectedReceipt = { commandId, requestFingerprint: fingerprintNarrativeExtractionRequest(command),
    documentHash: "d".repeat(64), version: 2, newClipId: `voice-extract-${commandId}` };
  const commands = {
    async readReceipt(scope: { draftId: string; organizationId: string; userId: string; commandId: string }) {
      calls.receipt++; assert.deepEqual(scope, { draftId, organizationId, userId, commandId }); return receipt;
    },
    async commit() { calls.commit++; receipt = expectedReceipt; return { status: "COMMITTED" as const, receipt }; },
  };
  const dependencies: NarrativeExtractionHttpDependencies = {
    enabled: () => true, configuredAppUrl: () => origin,
    async authorize() { calls.auth++; return { status: "AUTHORIZED", organizationId, userId }; },
    async consumeRateLimit(scope, _purpose, signal) {
      calls.rate++; assert.deepEqual(scope, { organizationId, userId }); assert.equal(signal.aborted, false); return { status: "ALLOWED" };
    },
    async loadServices(scope) { calls.services++; assert.deepEqual(scope, { draftId, organizationId, userId }); return { reads, commands }; },
    logFailure: (id, error, cmd) => { failures.push({ requestId: id, commandId: cmd, error }); },
  };
  return { command, dependencies, calls, failures, commands, reads, expectedReceipt,
    setReceipt: (value: NarrativeExtractionReceipt | null) => { receipt = value; } };
}

test("disabled handler does not invoke authorization, rate limit or persistence", async () => {
  const { dependencies, command, calls } = await fixture();
  dependencies.enabled = () => false;
  const response = await createNarrativeExtractionHttpHandler("APPLY", dependencies)(request(command), draftId);
  assert.equal(response.status, 503);
  assert.deepEqual(calls, { auth: 0, rate: 0, services: 0, commit: 0, receipt: 0 });
});
test("cross-origin, missing origin and conflicting fetch metadata fail before auth", async () => {
  const rejectedHeaders: Array<Record<string, string>> = [{ origin: "https://evil.example" }, { origin: "null" }, { "sec-fetch-site": "same-site" },
    { "sec-fetch-site": "cross-site", "x-forwarded-host": "courseforge.example" }];
  for (const headers of rejectedHeaders) {
    const { dependencies, command, calls } = await fixture();
    assert.equal((await createNarrativeExtractionHttpHandler("APPLY", dependencies)(request(command, headers), draftId)).status, 403);
    assert.equal(calls.auth, 0);
  }
  const { dependencies, command } = await fixture();
  const missing = request(command); missing.headers.delete("origin");
  assert.equal((await createNarrativeExtractionHttpHandler("APPLY", dependencies)(missing, draftId)).status, 403);
});
test("trusted-origin config is explicit and rejects paths, credentials, unsafe schemes and remote HTTP", () => {
  for (const configured of [null, "", "invalid", "https://user:pass@example.com", `${origin}/tenant`, `${origin}?a=1`,
    "http://remote.example", "file:///tmp"]) assert.equal(resolveNarrativeExtractionTrustedOrigin(configured), null);
  assert.equal(resolveNarrativeExtractionTrustedOrigin(origin), origin);
  assert.equal(resolveNarrativeExtractionTrustedOrigin("http://localhost:3000"), "http://localhost:3000");
});
test("unconfigured origin fails closed before auth", async () => {
  const { dependencies, command, calls } = await fixture(); dependencies.configuredAppUrl = () => null;
  assert.equal((await createNarrativeExtractionHttpHandler("RECOVERY", dependencies)(request(command), draftId)).status, 503);
  assert.equal(calls.auth, 0);
});
test("method, MIME, identifier and query strings are rejected before services", async () => {
  for (const variant of ["method", "mime", "draft", "query"]) {
    const { dependencies, command, calls } = await fixture();
    const req = request(command, variant === "mime" ? { "content-type": "text/plain" } : {}, variant === "method" ? "GET" : "POST", variant === "query" ? "?asset=private" : "");
    const response = await createNarrativeExtractionHttpHandler("APPLY", dependencies)(req, variant === "draft" ? "../" : draftId);
    assert.equal(response.status, variant === "method" ? 405 : variant === "mime" ? 415 : 400);
    assert.equal(calls.auth, 0); assert.equal(calls.services, 0);
  }
});
test("authentication, tenant and role denial never touch rate or repositories", async () => {
  for (const status of ["AUTH_REQUIRED", "TENANT_FORBIDDEN", "ROLE_FORBIDDEN"] as const) {
    const { dependencies, command, calls } = await fixture(); dependencies.authorize = async () => ({ status });
    assert.equal((await createNarrativeExtractionHttpHandler("APPLY", dependencies)(request(command), draftId)).status, status === "AUTH_REQUIRED" ? 401 : 403);
    assert.equal(calls.rate, 0); assert.equal(calls.services, 0);
  }
});
test("malformed authorized scope never reaches service role operations", async () => {
  const { dependencies, command, calls } = await fixture();
  dependencies.authorize = async () => ({ status: "AUTHORIZED", organizationId: "invalid", userId });
  assert.equal((await createNarrativeExtractionHttpHandler("APPLY", dependencies)(request(command), draftId)).status, 403);
  assert.equal(calls.rate, 0);
});
test("distributed limit unavailable or exceeded blocks service creation", async () => {
  for (const status of ["UNAVAILABLE", "LIMITED"] as const) {
    const { dependencies, command, calls } = await fixture();
    dependencies.consumeRateLimit = async () => status === "LIMITED" ? { status, retryAfterSeconds: 1000 } : { status };
    const response = await createNarrativeExtractionHttpHandler("APPLY", dependencies)(request(command), draftId);
    assert.equal(response.status, status === "LIMITED" ? 429 : 503);
    if (status === "LIMITED") assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(calls.services, 0);
  }
});
test("stream cap rejects oversized bodies even with missing or dishonest Content-Length", async () => {
  const sizeHeaders: Array<Record<string, string>> = [{}, { "content-length": "1" }, { "content-length": "999999" }];
  for (const headers of sizeHeaders) {
    const { dependencies, calls } = await fixture();
    assert.equal((await createNarrativeExtractionHttpHandler("APPLY", dependencies)(request("a".repeat(8193), headers), draftId)).status, 413);
    assert.equal(calls.services, 0);
  }
});
test("strict body refuses client operations, scope, assets, malformed JSON and length", async () => {
  const { dependencies, command, calls } = await fixture();
  const handler = createNarrativeExtractionHttpHandler("APPLY", dependencies);
  for (const body of [{ ...command, operations: [] }, { ...command, organizationId }, { ...command, asset: {} }, "not JSON"]) {
    assert.equal((await handler(request(body), draftId)).status, 400);
  }
  assert.equal((await handler(request(command, { "content-length": "NaN" }), draftId)).status, 400);
  assert.equal(calls.services, 0);
});
test("successful apply exposes only the projected receipt and requires reloading current document", async () => {
  const { dependencies, command, calls } = await fixture();
  const response = await createNarrativeExtractionHttpHandler("APPLY", dependencies)(request(command), draftId);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(narrativeExtractionCommandResultSchema.safeParse(body.data).success);
  assert.equal(body.data.status, "COMMITTED"); assert.equal(body.data.reloadDocumentRequired, true);
  assert.equal(body.data.automaticRetryAllowed, false); assert.equal(calls.commit, 1);
  assert.equal(body.data.requestFingerprint, undefined); assert.equal(body.data.operations, undefined);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-request-id"), requestId);
});
test("replayed apply does not replace a newer document or append again", async () => {
  const { dependencies, command, calls, expectedReceipt, setReceipt, reads } = await fixture();
  setReceipt(expectedReceipt); reads.readDocument = async () => { throw new Error("Must not load newer document"); };
  const body = await (await createNarrativeExtractionHttpHandler("APPLY", dependencies)(request(command), draftId)).json();
  assert.equal(body.data.status, "REPLAYED"); assert.equal(calls.commit, 0);
});
test("recovery confirms receipt without calling commit", async () => {
  const { dependencies, command, calls, expectedReceipt, setReceipt } = await fixture(); setReceipt(expectedReceipt);
  const response = await createNarrativeExtractionHttpHandler("RECOVERY", dependencies)(request(command), draftId);
  assert.equal(response.status, 200); assert.equal((await response.json()).data.status, "CONFIRMED"); assert.equal(calls.commit, 0);
});
test("missing recovery receipt is unconfirmed, never proof of a failed save", async () => {
  const { dependencies, command, calls } = await fixture();
  const response = await createNarrativeExtractionHttpHandler("RECOVERY", dependencies)(request(command), draftId);
  assert.equal(response.status, 202);
  const body = await response.json(); assert.equal(body.data.status, "UNCONFIRMED");
  assert.equal(body.data.recoveryRequired, true); assert.equal(body.data.automaticRetryAllowed, false); assert.equal(calls.commit, 0);
});
test("lost ACK returns unconfirmed 503 with safe diagnostics and no automatic retry", async () => {
  const { dependencies, command, commands, calls, failures } = await fixture();
  const commit = commands.commit;
  commands.commit = async () => { await commit(); throw new Error("internal secret ACK lost"); };
  const response = await createNarrativeExtractionHttpHandler("APPLY", dependencies)(request(command), draftId);
  const body = await response.json(); assert.equal(response.status, 503);
  assert.equal(body.details.reason, "COMMIT_UNCONFIRMED"); assert.equal(body.details.recoveryRequired, true);
  assert.equal(body.details.requestNotApplied, false);
  assert.equal(body.retryable, false); assert.equal(calls.commit, 1);
  assert.equal(failures.length, 1); assert.equal(failures[0]!.commandId, commandId);
  assert.ok(!JSON.stringify(body).includes("internal secret"));
  const recovered = await createNarrativeExtractionHttpHandler("RECOVERY", dependencies)(request(command), draftId);
  assert.equal((await recovered.json()).data.status, "CONFIRMED"); assert.equal(calls.commit, 1);
});
test("missing scoped resource returns 404 before receipt lookup or append", async () => {
  const { dependencies, command, calls } = await fixture(); dependencies.loadServices = async () => null;
  assert.equal((await createNarrativeExtractionHttpHandler("APPLY", dependencies)(request(command), draftId)).status, 404);
  assert.equal(calls.receipt, 0); assert.equal(calls.commit, 0);
});
test("changed intention under an existing command returns a deterministic conflict", async () => {
  const { dependencies, command, expectedReceipt, setReceipt, calls } = await fixture(); setReceipt(expectedReceipt);
  command.selection.lastSourceIndex = 3;
  const response = await createNarrativeExtractionHttpHandler("APPLY", dependencies)(request(command), draftId);
  const body = await response.json();
  assert.equal(response.status, 409); assert.equal(body.details.reason, "COMMAND_REUSED");
  assert.equal(body.details.requestNotApplied, false); assert.equal(calls.commit, 0);
});

test("apply rejection explicitly acknowledges no write, but recovery denial cannot attest an earlier commit", async () => {
  const { dependencies, command, calls } = await fixture();
  dependencies.authorize = async () => ({ status: "ROLE_FORBIDDEN" });
  const apply = await (await createNarrativeExtractionHttpHandler("APPLY", dependencies)(request(command), draftId)).json();
  const recovery = await (await createNarrativeExtractionHttpHandler("RECOVERY", dependencies)(request(command), draftId)).json();
  assert.equal(apply.details.requestNotApplied, true); assert.equal(recovery.details.requestNotApplied, false);
  assert.equal(calls.commit, 0);
});

test("expected review conflict is definitive without a commit attempt", async () => {
  const { dependencies, command, calls } = await fixture(); command.reviewFingerprint = "e".repeat(64);
  const response = await createNarrativeExtractionHttpHandler("APPLY", dependencies)(request(command), draftId);
  const body = await response.json();
  assert.equal(response.status, 409); assert.equal(body.details.reason, "REVIEW_STALE");
  assert.equal(body.details.requestNotApplied, true); assert.equal(calls.commit, 0);
});
test("aborted requests do not start authentication or persistence", async () => {
  const { dependencies, command, calls } = await fixture();
  const controller = new AbortController(); controller.abort();
  const req = new Request(request(command), { signal: controller.signal });
  assert.equal((await createNarrativeExtractionHttpHandler("APPLY", dependencies)(req, draftId)).status, 503);
  assert.equal(calls.auth, 0); assert.equal(calls.commit, 0);
});

test("stream parser cancels stalled body reads when the request is aborted", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); },
    cancel() { cancelled = true; } });
  const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half" };
  const req = new Request(`${origin}/commands`, init);
  const controller = new AbortController();
  const reading = parseNarrativeExtractionHttpBody(req, controller.signal);
  queueMicrotask(() => controller.abort());
  await assert.rejects(reading, { name: "AbortError" });
  assert.equal(cancelled, true);
});

test("malformed UTF-8 is rejected rather than replaced before parsing the command", async () => {
  const req = new Request(`${origin}/commands`, { method: "POST", body: new Uint8Array([255]).buffer });
  assert.deepEqual(await parseNarrativeExtractionHttpBody(req, new AbortController().signal), { ok: false, reason: "INVALID" });
});
