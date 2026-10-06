import assert from "node:assert/strict";
import test from "node:test";
import { createNarrativeDocumentFixture } from "./fixtures/composition-narrative.fixture";
import { deriveNarrativeNavigationOccurrences } from "../composition-narrative-occurrence.service";
import { queryNarrativeVoiceExtraction, type NarrativeExtractionReadRepository } from "../composition-narrative-extraction-query";
import { narrativeExtractionApplyRequestSchema, type NarrativeExtractionApplyRequest } from "../composition-narrative-extraction-contract";
import { applyNarrativeVoiceExtraction, recoverNarrativeVoiceExtraction, fingerprintNarrativeExtractionRequest,
  NarrativeExtractionCommitUnconfirmedError, type NarrativeExtractionCommandRepository, type NarrativeExtractionReceipt } from "../composition-narrative-extraction-apply.service";
import { applyCompositionEditorPatches } from "../editor-patch.service";

async function fixture() {
  const document = createNarrativeDocumentFixture();
  const occurrence = deriveNarrativeNavigationOccurrences(document).occurrences[0]!;
  const organizationId = "33333333-3333-4333-8333-333333333333";
  const componentId = "44444444-4444-4444-8444-444444444444";
  const draftId = "55555555-5555-4555-8555-555555555555";
  const userId = "66666666-6666-4666-8666-666666666666";
  const commandId = "77777777-7777-4777-8777-777777777777";
  const documentHash = "b".repeat(64);
  const selection = { documentHash, occurrenceId: occurrence.id, firstSourceIndex: 1, lastSourceIndex: 2 };
  const asset = { id: occurrence.assetId, organization_id: organizationId, material_component_id: componentId,
    asset_type: "VOICE_AUDIO", mime_type: "audio/mpeg", checksum: "c".repeat(64), qa_status: "READY_FOR_QA",
    duration_milliseconds: 10_000, metadata: { script_hash: occurrence.scriptHash, word_timestamps: document.narrativeScenes![0]!.wordTimestamps } };
  let readsCount = 0;
  let commitCount = 0;
  let receipt: NarrativeExtractionReceipt | null = null;
  const reads: NarrativeExtractionReadRepository = {
    async readComponentId(receivedDraft, receivedOrg) {
      assert.deepEqual([receivedDraft, receivedOrg], [draftId, organizationId]); readsCount++; return componentId;
    },
    async readDocument() { readsCount++; return { document, documentHash }; },
    async readLinkedAsset() { readsCount++; return asset; },
  };
  const review = await queryNarrativeVoiceExtraction({ draftId, organizationId, selection, repository: reads });
  assert.ok(review.ok);
  readsCount = 0;
  const request: NarrativeExtractionApplyRequest = { contract: "NARRATIVE_VOICE_EXTRACTION_APPLY_V1", commandId, selection,
    reviewFingerprint: review.summary.reviewFingerprint };
  const commands: NarrativeExtractionCommandRepository = {
    async readReceipt(scope) {
      assert.deepEqual(scope, { draftId, organizationId, userId, commandId }); return receipt;
    },
    async commit(scope) {
      commitCount++;
      assert.equal(scope.plan.newClipId, `voice-extract-${commandId}`);
      const next = applyCompositionEditorPatches(document, scope.plan.operations, "USER");
      assert.equal(next.clips.length, document.clips.length + 1);
      assert.deepEqual(next.clips[0], document.clips[0]);
      receipt = { commandId, requestFingerprint: scope.requestFingerprint, documentHash: "d".repeat(64), version: 2,
        newClipId: scope.plan.newClipId };
      return { status: "COMMITTED", receipt };
    },
  };
  return { params: { draftId, organizationId, userId, request, reads, commands }, asset, document,
    counters: () => ({ readsCount, commitCount }), setReceipt: (value: NarrativeExtractionReceipt) => { receipt = value; } };
}

test("rebuilds from scoped server reads and commits one deterministic native plan", async () => {
  const { params, counters } = await fixture();
  const result = await applyNarrativeVoiceExtraction(params);
  assert.ok(result.ok);
  assert.equal(result.outcome, "COMMITTED");
  assert.deepEqual(counters(), { readsCount: 3, commitCount: 1 });
});
test("acknowledged command replays its original receipt even after document changes", async () => {
  const { params, counters } = await fixture();
  const first = await applyNarrativeVoiceExtraction(params);
  params.reads.readDocument = async () => { throw new Error("Must not read a newer document"); };
  const second = await applyNarrativeVoiceExtraction(params);
  assert.ok(first.ok && second.ok);
  assert.equal(second.outcome, "REPLAYED");
  assert.deepEqual(second.receipt, first.receipt);
  assert.equal(counters().commitCount, 1);
});
test("reusing command identity with different selection fails without another write", async () => {
  const { params, counters } = await fixture();
  await applyNarrativeVoiceExtraction(params);
  params.request.selection.lastSourceIndex = 3;
  assert.deepEqual(await applyNarrativeVoiceExtraction(params), { ok: false, reason: "COMMAND_REUSED" });
  assert.equal(counters().commitCount, 1);
});
test("checksum, permitted QA state or duration change invalidates the earlier review", async () => {
  for (const change of [{ checksum: "e".repeat(64) }, { qa_status: "APPROVED" }, { duration_milliseconds: 11_000 }]) {
    const { params, asset, counters } = await fixture();
    Object.assign(asset, change);
    assert.deepEqual(await applyNarrativeVoiceExtraction(params), { ok: false, reason: "REVIEW_STALE" });
    assert.equal(counters().commitCount, 0);
  }
});
test("stale document or missing source link prevents a commit", async () => {
  const stale = await fixture();
  stale.params.reads.readDocument = async () => ({ document: stale.document, documentHash: "e".repeat(64) });
  assert.deepEqual(await applyNarrativeVoiceExtraction(stale.params), { ok: false, reason: "STALE_DOCUMENT" });
  assert.equal(stale.counters().commitCount, 0);
  const missing = await fixture();
  missing.params.reads.readLinkedAsset = async () => null;
  assert.deepEqual(await applyNarrativeVoiceExtraction(missing.params), { ok: false, reason: "ASSET_BINDING_UNAVAILABLE" });
  assert.equal(missing.counters().commitCount, 0);
});
test("atomic boundary can reject a race without a blind retry", async () => {
  for (const status of ["CONFLICT", "ASSET_CHANGED", "COMMAND_REUSED", "BUSY"] as const) {
    const { params } = await fixture();
    let attempts = 0;
    params.commands.commit = async () => { attempts++; return { status }; };
    assert.deepEqual(await applyNarrativeVoiceExtraction(params), { ok: false, reason: status });
    assert.equal(attempts, 1);
  }
});
test("concurrent identical command can replay from the atomic boundary", async () => {
  const { params } = await fixture();
  const commit = params.commands.commit;
  params.commands.commit = async (scope) => {
    const result = await commit(scope);
    assert.ok("receipt" in result);
    return { status: "REPLAYED", receipt: result.receipt };
  };
  const result = await applyNarrativeVoiceExtraction(params);
  assert.ok(result.ok);
  assert.equal(result.outcome, "REPLAYED");
});
test("lost ACK requires receipt lookup, not a second append", async () => {
  const { params, counters } = await fixture();
  const commit = params.commands.commit;
  params.commands.commit = async (scope) => { await commit(scope); throw new Error("ACK lost"); };
  await assert.rejects(applyNarrativeVoiceExtraction(params), (error) => error instanceof NarrativeExtractionCommitUnconfirmedError
    && error.commandId === params.request.commandId && error.cause instanceof Error);
  const recovered = await recoverNarrativeVoiceExtraction(params);
  assert.ok(recovered.ok);
  assert.equal(recovered.receipt.version, 2);
  assert.equal(counters().commitCount, 1);
});
test("missing recovery receipt does not claim that nothing was saved", async () => {
  const { params, counters } = await fixture();
  assert.deepEqual(await recoverNarrativeVoiceExtraction(params), { ok: false, reason: "COMMIT_UNCONFIRMED", commandId: params.request.commandId });
  assert.deepEqual(counters(), { readsCount: 0, commitCount: 0 });
});
test("malformed commit acknowledgement remains unconfirmed", async () => {
  const { params } = await fixture();
  params.commands.commit = async () => ({ status: "COMMITTED", receipt: {} });
  await assert.rejects(applyNarrativeVoiceExtraction(params), NarrativeExtractionCommitUnconfirmedError);
});
test("corrupt or mismatched prior receipt blocks any new write", async () => {
  const { params, counters, setReceipt } = await fixture();
  setReceipt({ commandId: params.request.commandId, requestFingerprint: fingerprintNarrativeExtractionRequest(params.request),
    documentHash: "d".repeat(64), version: 2, newClipId: "wrong-clip" });
  assert.deepEqual(await applyNarrativeVoiceExtraction(params), { ok: false, reason: "INVALID_RECEIPT" });
  assert.deepEqual(counters(), { readsCount: 0, commitCount: 0 });
});
test("receipt read outage propagates before any mutation", async () => {
  const { params, counters } = await fixture();
  params.commands.readReceipt = async () => { throw new Error("receipt store unavailable"); };
  await assert.rejects(applyNarrativeVoiceExtraction(params), /receipt store unavailable/);
  assert.equal(counters().commitCount, 0);
});
test("apply contract refuses client operations, assets, scope and missing reviewed binding", async () => {
  const { params } = await fixture();
  for (const extra of [{ operations: [] }, { asset: {} }, { organizationId: params.organizationId }, { reviewFingerprint: "" }]) {
    assert.equal(narrativeExtractionApplyRequestSchema.safeParse({ ...params.request, ...extra }).success, false);
  }
});
test("request digest is stable across object property order and sensitive to reviewed intent", async () => {
  const { params } = await fixture();
  const request = params.request;
  const fingerprint = fingerprintNarrativeExtractionRequest(request);
  const reordered = { reviewFingerprint: request.reviewFingerprint, selection: { lastSourceIndex: 2, firstSourceIndex: 1,
    occurrenceId: request.selection.occurrenceId, documentHash: request.selection.documentHash }, commandId: request.commandId, contract: request.contract };
  assert.equal(fingerprintNarrativeExtractionRequest(reordered), fingerprint);
  assert.notEqual(fingerprintNarrativeExtractionRequest({ ...request, reviewFingerprint: "e".repeat(64) }), fingerprint);
});
