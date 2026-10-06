import assert from "node:assert/strict";
import test from "node:test";
import { NarrativeExtractionSession } from "../composition-narrative-extraction-session";
import { requestNarrativeExtractionCommand } from "../composition-narrative-extraction-command.client";
import { readNarrativeExtractionResponse } from "../composition-narrative-extraction-response";
import type { NarrativeExtractionCommandResult, NarrativeExtractionSummary } from "../composition-narrative-extraction-contract";

const draftId = "55555555-5555-4555-8555-555555555555";
const commandId = "66666666-6666-4666-8666-666666666666";
const selection = { documentHash: "b".repeat(64), occurrenceId: "voice", firstSourceIndex: 0, lastSourceIndex: 2 };
const summary: NarrativeExtractionSummary = { contract: "NARRATIVE_VOICE_EXTRACTION_ELIGIBILITY_V2", documentHash: selection.documentHash,
  reviewFingerprint: "d".repeat(64), scope: "VOICE_ONLY", binding: "REGISTRY_METADATA_MATCH_ONLY", sourceStartSeconds: 1,
  sourceEndSeconds: 3, destinationStartSeconds: 20, destinationEndSeconds: 22, requiresRevalidationBeforeApply: true };
const command = { contract: "NARRATIVE_VOICE_EXTRACTION_APPLY_V1" as const, commandId, selection, reviewFingerprint: summary.reviewFingerprint };
const receipt = (status: "COMMITTED" | "REPLAYED" | "CONFIRMED" = "COMMITTED") => ({
  contract: "NARRATIVE_EXTRACTION_COMMAND_RESULT_V1" as const, status, commandId, documentHash: "e".repeat(64), version: 2,
  newClipId: `voice-extract-${commandId}`, scope: "DATABASE_COMMIT_ONLY" as const, reloadDocumentRequired: true as const,
  automaticRetryAllowed: false as const, recoveryRequired: false as const });
const ready = () => { const session = new NarrativeExtractionSession(); assert.equal(session.review(draftId, selection, summary), true); return session; };

test("only exact reviewed selection starts one apply, with detached immutable intent", () => {
  const session = ready();
  assert.equal(session.beginApply(draftId, { ...selection, lastSourceIndex: 3 }, commandId), null);
  const submitted = session.beginApply(draftId, selection, commandId)!;
  submitted.selection.firstSourceIndex = 90;
  assert.equal(session.beginApply(draftId, selection, commandId), null);
  const state = session.state;
  assert.equal(state.phase, "APPLYING");
  if (state.phase === "APPLYING") assert.equal(state.command.selection.firstSourceIndex, 0);
});
test("selection invalidation does not lose an in-flight or uncertain command", () => {
  const session = ready(); session.beginApply(draftId, selection, commandId);
  session.invalidateReview(); assert.equal(session.state.phase, "APPLYING");
  assert.equal(session.settle({ kind: "UNCONFIRMED", commandId, message: "unknown" }), true);
  session.invalidateReview(); assert.equal(session.review(draftId, selection, summary), false);
  assert.deepEqual(session.beginRecovery(), { draftId, command });
  assert.equal(session.beginRecovery(), null);
  assert.equal(session.settle({ kind: "CONFIRMED", receipt: receipt("CONFIRMED") }), true);
  assert.equal(session.state.phase, "RELOAD_REQUIRED");
  assert.equal(session.acknowledgeReload(commandId), false);
  assert.equal(session.acknowledgeReload(draftId), true);
});
test("invalidated review cannot be reused and another command cannot settle the session", () => {
  const session = ready(); session.invalidateReview();
  assert.equal(session.beginApply(draftId, selection, commandId), null);
  session.review(draftId, selection, summary); session.beginApply(draftId, selection, commandId);
  assert.equal(session.settle({ kind: "UNCONFIRMED", commandId: draftId, message: "other" }), false);
  assert.equal(session.settle({ kind: "CONFIRMED", receipt: receipt("CONFIRMED") }), false);
  assert.equal(session.settle({ kind: "CONFIRMED", receipt: receipt() }), true);
  assert.equal(session.review(draftId, selection, summary), false);
});
test("client posts identical intention to apply and receipt, without automatic requests", async () => {
  for (const mode of ["APPLY", "RECOVERY"] as const) {
    let calls = 0;
    const fetcher: typeof fetch = async (url, options) => {
      calls++; assert.equal(url, `/api/production/hyperframes/drafts/${draftId}/narrative-extraction/${mode === "APPLY" ? "apply" : "receipt"}`);
      assert.equal(options?.credentials, "same-origin"); assert.deepEqual(JSON.parse(String(options?.body)), command);
      return Response.json({ success: true, requestId: "request", correlationId: "request", data: receipt(mode === "APPLY" ? "COMMITTED" : "CONFIRMED") });
    };
    const result = await requestNarrativeExtractionCommand({ mode, draftId, command, signal: new AbortController().signal, fetcher });
    assert.equal(result.kind, "CONFIRMED"); assert.equal(calls, 1);
  }
});
test("lost acknowledgement and server errors remain unknown without leaking error bodies or retrying", async () => {
  for (const status of [401, 403, 409, 429, 500, 503]) {
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return new Response("secret", { status }); };
    const result = await requestNarrativeExtractionCommand({ mode: "APPLY", draftId, command, signal: new AbortController().signal, fetcher });
    assert.equal(result.kind, "UNCONFIRMED"); assert.equal(calls, 1); assert.ok(!JSON.stringify(result).includes("secret"));
  }
});
test("malformed, wrong command, wrong outcome, oversized and absent receipts cannot confirm", async () => {
  const payloads: unknown[] = [{ ...receipt(), commandId: draftId }, { ...receipt(), newClipId: "wrong" }, receipt("CONFIRMED"),
    { ...receipt(), operations: [] }, { contract: "NARRATIVE_EXTRACTION_COMMAND_RESULT_V1", commandId, status: "UNCONFIRMED",
      automaticRetryAllowed: false, recoveryRequired: true } satisfies NarrativeExtractionCommandResult];
  for (const payload of payloads) {
    const result = await requestNarrativeExtractionCommand({ mode: "APPLY", draftId, command, signal: new AbortController().signal,
      fetcher: async () => Response.json({ success: true, data: payload }) });
    assert.equal(result.kind, "UNCONFIRMED");
  }
  for (const body of ["invalid json", "x".repeat(17 * 1024)]) {
    assert.equal((await requestNarrativeExtractionCommand({ mode: "APPLY", draftId, command, signal: new AbortController().signal,
      fetcher: async () => new Response(body) })).kind, "UNCONFIRMED");
  }
});
test("abort after dispatch retains uncertainty even if fetch ignores cancellation", async () => {
  const controller = new AbortController();
  const result = await requestNarrativeExtractionCommand({ mode: "APPLY", draftId, command, signal: controller.signal,
    fetcher: async () => { controller.abort(); return Response.json({ success: true, data: receipt() }); } });
  assert.equal(result.kind, "UNCONFIRMED");
});
test("pre-dispatch abort and invalid UUID never send a command", async () => {
  let calls = 0; const fetcher: typeof fetch = async () => { calls++; throw Error("unexpected"); };
  const controller = new AbortController(); controller.abort();
  await assert.rejects(requestNarrativeExtractionCommand({ mode: "APPLY", draftId, command, signal: controller.signal, fetcher }));
  await assert.rejects(requestNarrativeExtractionCommand({ mode: "APPLY", draftId: "invalid", command, signal: new AbortController().signal, fetcher }));
  assert.equal(calls, 0);
});
test("bounded response cancels a stalled stream on abort and rejects malformed UTF-8", async () => {
  const controller = new AbortController(); let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  const pending = readNarrativeExtractionResponse(response, controller.signal); controller.abort();
  await assert.rejects(pending); assert.equal(cancelled, true);
  await assert.rejects(readNarrativeExtractionResponse(new Response(new Uint8Array([0xff])), new AbortController().signal));
});
