import assert from "node:assert/strict";
import test from "node:test";
import { createNarrativeDocumentFixture } from "./fixtures/composition-narrative.fixture";
import { deriveNarrativeNavigationOccurrences } from "../composition-narrative-occurrence.service";
import { compositionNativeTextSourceSchema } from "../composition-text-layer.types";
import { queryNarrativeFragment, type NarrativeFragmentReadRepository } from "../composition-narrative-fragment-query.server";
import { applyNarrativeFragment, recoverNarrativeFragment, fingerprintNarrativeFragmentRequest,
  type NarrativeFragmentCommandRepository } from "../composition-narrative-fragment-apply.server";
import type { NarrativeFragmentApplyRequest } from "../composition-narrative-fragment-command-contract";
import { NarrativeExtractionCommitUnconfirmedError } from "../composition-narrative-extraction-apply.service";

const draftId = "55555555-5555-4555-8555-555555555555";
const organizationId = "33333333-3333-4333-8333-333333333333";
const componentId = "44444444-4444-4444-8444-444444444444";
const userId = "22222222-2222-4222-8222-222222222222";
const commandId = "66666666-6666-4666-8666-666666666666";
async function setup() {
  const document = createNarrativeDocumentFixture(); document.format = "courseforge-composition-v3";
  document.tracks.push({ id: "text", kind: "OVERLAY", semanticRole: "TEXT", label: "Texto", order: 1, locked: false });
  document.clips.push({ ...document.clips[0]!, id: "title", hfId: "hf-title", sceneId: undefined, kind: "TEXT", trackId: "text",
    sourceOffsetSeconds: undefined, sourceDurationSeconds: undefined,
    source: compositionNativeTextSourceSchema.parse({ type: "NATIVE_TEXT", text: "Texto manual", style: {} }) });
  const occurrence = deriveNarrativeNavigationOccurrences(document).occurrences[0]!;
  const asset = { id: occurrence.assetId, organization_id: organizationId, material_component_id: componentId,
    asset_type: "VOICE_AUDIO", mime_type: "audio/mpeg", checksum: "c".repeat(64), qa_status: "APPROVED", duration_milliseconds: 10_000,
    metadata: { script_hash: occurrence.scriptHash, word_timestamps: document.narrativeScenes![0]!.wordTimestamps } };
  let readsCount = 0;
  const reads: NarrativeFragmentReadRepository = {
    readComponentId: async () => { readsCount++; return componentId; },
    readDocument: async () => ({ document, documentHash: "b".repeat(64) }), readAssets: async () => [asset], readFonts: async () => [],
  };
  const query = { contract: "NARRATIVE_FRAGMENT_QUERY_V1" as const, selectedTrackIds: ["voice", "text"],
    selection: { documentHash: "b".repeat(64), occurrenceId: occurrence.id, firstSourceIndex: 1, lastSourceIndex: 2 } };
  const review = await queryNarrativeFragment({ draftId, organizationId, commandId, request: query, repository: reads, signal: new AbortController().signal });
  assert.ok(review.ok);
  const request: NarrativeFragmentApplyRequest = { contract: "NARRATIVE_FRAGMENT_APPLY_V1", commandId, query, reviewFingerprint: review.summary.reviewFingerprint };
  const receipt = { contract: "NARRATIVE_FRAGMENT_RECEIPT_V1" as const, commandId, requestFingerprint: fingerprintNarrativeFragmentRequest(request),
    documentHash: "e".repeat(64), version: 2, anchorClipId: `voice-extract-${commandId}`, newClipIds: [`voice-extract-${commandId}`, `fragment-${commandId}-0`] };
  const commits: Parameters<NarrativeFragmentCommandRepository["commit"]>[0][] = [];
  const commands: NarrativeFragmentCommandRepository = {
    readReceipt: async scope => { assert.deepEqual(scope, { draftId, organizationId, userId, commandId }); return null; },
    commit: async command => { commits.push(command); return { status: "COMMITTED", receipt }; },
  };
  return { asset, document, receipt, commits, readsCount: () => readsCount, parameters: { draftId, organizationId, userId,
    request, reads, commands, signal: new AbortController().signal } };
}
test("rebuilds all clips and submits one reviewed multitrack commit with full authenticated scope", async () => {
  const current = await setup(); const result = await applyNarrativeFragment(current.parameters);
  assert.ok(result.ok); assert.equal(result.outcome, "COMMITTED"); assert.equal(current.commits.length, 1);
  const command = current.commits[0]!;
  assert.equal(command.organizationId, organizationId); assert.equal(command.userId, userId);
  assert.equal(command.plan.copies.length, 2); assert.equal(command.plan.scope, "AUDIOVISUAL");
  assert.equal(command.plan.operations.filter(operation => operation.type === "clip.add").length, 2);
});
test("prior receipt replays before current-source reads even after later edits; changed intention conflicts", async () => {
  const current = await setup(); current.parameters.commands.readReceipt = async () => current.receipt;
  current.parameters.reads.readDocument = async () => { throw Error("must not reload old document"); };
  const count = current.readsCount(); const result = await applyNarrativeFragment(current.parameters);
  assert.ok(result.ok); assert.equal(result.outcome, "REPLAYED"); assert.equal(current.readsCount(), count); assert.equal(current.commits.length, 0);
  current.parameters.request.query.selectedTrackIds = ["voice", "another"];
  assert.deepEqual(await applyNarrativeFragment(current.parameters), { ok: false, reason: "COMMAND_REUSED" });
});
test("changed asset, document or review rejects before committing", async () => {
  const changed = await setup(); changed.asset.checksum = "f".repeat(64);
  assert.deepEqual(await applyNarrativeFragment(changed.parameters), { ok: false, reason: "REVIEW_STALE" });
  assert.equal(changed.commits.length, 0);
  const stale = await setup(); stale.parameters.request.query.selection.documentHash = "f".repeat(64);
  assert.deepEqual(await applyNarrativeFragment(stale.parameters), { ok: false, reason: "STALE_DOCUMENT" });
  assert.equal(stale.commits.length, 0);
});
test("atomic conflicts remain explicit and are not retried; concurrent replay is allowed", async () => {
  for (const status of ["BUSY", "CONFLICT", "FONT_CHANGED", "ASSET_CHANGED", "COMMAND_REUSED"] as const) {
    const current = await setup(); let commits = 0;
    current.parameters.commands.commit = async () => { commits++; return { status }; };
    assert.deepEqual(await applyNarrativeFragment(current.parameters), { ok: false, reason: status }); assert.equal(commits, 1);
  }
  const concurrent = await setup(); concurrent.parameters.commands.commit = async () => ({ status: "REPLAYED", receipt: concurrent.receipt });
  const result = await applyNarrativeFragment(concurrent.parameters); assert.ok(result.ok); assert.equal(result.outcome, "REPLAYED");
});
test("lost ACK, malformed receipt and cancellation after dispatch remain unconfirmed", async () => {
  for (const kind of ["lost", "malformed", "wrong-set", "cancel"] as const) {
    const current = await setup(); const controller = new AbortController(); current.parameters.signal = controller.signal;
    let count = 0;
    current.parameters.commands.commit = async () => {
      count++; if (kind === "lost") throw Error("lost ACK");
      if (kind === "cancel") controller.abort();
      return { status: "COMMITTED", receipt: kind === "malformed" ? { ...current.receipt, newClipIds: [current.receipt.anchorClipId] }
        : kind === "wrong-set" ? { ...current.receipt, newClipIds: [current.receipt.anchorClipId, `fragment-${commandId}-9`] } : current.receipt };
    };
    await assert.rejects(applyNarrativeFragment(current.parameters), NarrativeExtractionCommitUnconfirmedError); assert.equal(count, 1);
  }
});
test("corrupt prior receipts and receipt read failures never start source loading or commit", async () => {
  const current = await setup(); const count = current.readsCount();
  current.parameters.commands.readReceipt = async () => ({ ...current.receipt, anchorClipId: "foreign-anchor" });
  assert.deepEqual(await applyNarrativeFragment(current.parameters), { ok: false, reason: "INVALID_RECEIPT" });
  current.parameters.commands.readReceipt = async () => { throw Error("receipt unavailable"); };
  await assert.rejects(applyNarrativeFragment(current.parameters), /receipt unavailable/);
  assert.equal(current.readsCount(), count); assert.equal(current.commits.length, 0);
});
test("recovery only reads receipt; absent is uncertain, malformed blocks, valid confirms", async () => {
  const current = await setup(); const count = current.readsCount();
  assert.deepEqual(await recoverNarrativeFragment(current.parameters), { ok: false, reason: "COMMIT_UNCONFIRMED", commandId });
  current.parameters.commands.readReceipt = async () => ({ ...current.receipt, newClipIds: [current.receipt.anchorClipId, current.receipt.anchorClipId] });
  assert.deepEqual(await recoverNarrativeFragment(current.parameters), { ok: false, reason: "INVALID_RECEIPT" });
  current.parameters.commands.readReceipt = async () => current.receipt;
  assert.ok((await recoverNarrativeFragment(current.parameters)).ok);
  assert.equal(current.commits.length, 0); assert.equal(current.readsCount(), count);
});
test("request fingerprint is canonical across track/property order and includes all intent fields", async () => {
  const current = await setup(); const request = current.parameters.request;
  const fingerprint = fingerprintNarrativeFragmentRequest(request);
  assert.equal(fingerprintNarrativeFragmentRequest({ ...request, query: { ...request.query, selectedTrackIds: ["text", "voice"] } }), fingerprint);
  assert.notEqual(fingerprintNarrativeFragmentRequest({ ...request, reviewFingerprint: "f".repeat(64) }), fingerprint);
  const invalid = { ...request, operations: [] };
  await assert.rejects(applyNarrativeFragment({ ...current.parameters, request: invalid })); assert.equal(current.commits.length, 0);
});
