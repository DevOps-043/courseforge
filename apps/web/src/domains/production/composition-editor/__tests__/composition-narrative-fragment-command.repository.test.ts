import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createNarrativeFragmentCommandRepository, createSupabaseNarrativeFragmentRpcTransport,
  type NarrativeFragmentRpcTransport } from "../composition-narrative-fragment-command.repository";
import { createNarrativeDocumentFixture } from "./fixtures/composition-narrative.fixture";
import { deriveNarrativeNavigationOccurrences } from "../composition-narrative-occurrence.service";
import { buildNarrativeFragmentPlan } from "../composition-narrative-fragment.service";
import { hashCompositionDocument } from "../composition-document-hash";
import { applyCompositionEditorPatches } from "../editor-patch.service";

const draftId = "55555555-5555-4555-8555-555555555555";
const organizationId = "33333333-3333-4333-8333-333333333333";
const componentId = "44444444-4444-4444-8444-444444444444";
const userId = "77777777-7777-4777-8777-777777777777";
const commandId = "66666666-6666-4666-8666-666666666666";
function setup() {
  const document = createNarrativeDocumentFixture();
  const visualAssetId = "22222222-2222-4222-8222-222222222222";
  document.tracks.push({ id: "visual", kind: "VISUAL", label: "Visual", locked: false, order: 1, semanticRole: "BROLL" });
  document.clips.push({ ...document.clips[0]!, id: "visual-1", hfId: "hf-visual-1", kind: "VIDEO", trackId: "visual", sceneId: undefined,
    source: { type: "PRODUCTION_ASSET", productionAssetId: visualAssetId, hasAudio: false } });
  const occurrence = deriveNarrativeNavigationOccurrences(document).occurrences[0]!;
  const documentHash = hashCompositionDocument(document);
  const shared = { organization_id: organizationId, material_component_id: componentId, checksum: "c".repeat(64), qa_status: "APPROVED", duration_milliseconds: 10_000 };
  const registryAssets = new Map<string, unknown>([
    [occurrence.assetId, { ...shared, id: occurrence.assetId, asset_type: "VOICE_AUDIO", mime_type: "audio/mpeg",
      metadata: { script_hash: occurrence.scriptHash, word_timestamps: document.narrativeScenes![0]!.wordTimestamps } }],
    [visualAssetId, { ...shared, id: visualAssetId, asset_type: "SOURCE_MEDIA", mime_type: "video/mp4" }],
  ]);
  const planned = buildNarrativeFragmentPlan({ document, documentHash, organizationId, componentId, commandId,
    selection: { documentHash, occurrenceId: occurrence.id, firstSourceIndex: 1, lastSourceIndex: 2 },
    selectedTrackIds: ["voice", "visual"], linkedAssetIds: [...registryAssets.keys()], registryAssets }); assert.ok(planned.ok);
  const command = { draftId, organizationId, userId, commandId, requestFingerprint: "d".repeat(64), plan: planned.plan };
  const receipt = { contract: "NARRATIVE_FRAGMENT_RECEIPT_V1", commandId, requestFingerprint: command.requestFingerprint,
    documentHash: "e".repeat(64), version: 2, anchorClipId: planned.plan.anchor.newClipId, newClipIds: planned.plan.copies.map(copy => copy.newClipId) };
  const calls: { name: string; parameters: Record<string, unknown> }[] = [];
  const transport: NarrativeFragmentRpcTransport = { invoke: async (name, parameters) => {
    calls.push({ name, parameters }); return { error: null, data: name === "read_narrative_fragment_receipt" ? null : { status: "COMMITTED", receipt } };
  } };
  const reads = { readDocument: async () => ({ document, documentHash }) };
  return { document, command, receipt, calls, transport, reads, repository: createNarrativeFragmentCommandRepository(reads, transport) };
}
test("commit invokes one audiovisual RPC with reducer document, canonical hash and complete plan guards", async () => {
  const current = setup(); const result = await current.repository.commit(current.command); assert.equal(result.status, "COMMITTED");
  assert.equal(current.calls.length, 1); const call = current.calls[0]!; assert.equal(call.name, "commit_narrative_fragment");
  const expected = applyCompositionEditorPatches(current.document, current.command.plan.operations, "USER");
  assert.deepEqual(call.parameters.p_document, expected); assert.equal(call.parameters.p_document_hash, hashCompositionDocument(expected));
  assert.deepEqual(call.parameters.p_plan, current.command.plan); assert.equal(call.parameters.p_actor_id, userId);
  assert.equal(call.parameters.p_organization_id, organizationId); assert.equal(call.parameters.p_draft_id, draftId);
});
test("receipt lookup uses full scope and remains read-only", async () => {
  const current = setup(); assert.equal(await current.repository.readReceipt(current.command), null);
  assert.deepEqual(current.calls, [{ name: "read_narrative_fragment_receipt", parameters: {
    p_draft_id: draftId, p_organization_id: organizationId, p_actor_id: userId, p_command_id: commandId } }]);
});
test("stale revision never writes; concurrent original receipt replays or conflicts by intent", async () => {
  for (const outcome of ["missing", "same", "different"] as const) {
    const current = setup(); current.reads.readDocument = async () => ({ document: current.document, documentHash: "f".repeat(64) });
    current.transport.invoke = async (name, parameters) => { current.calls.push({ name, parameters });
      return { error: null, data: outcome === "missing" ? null : { ...current.receipt,
        requestFingerprint: outcome === "same" ? current.receipt.requestFingerprint : "a".repeat(64) } }; };
    const result = await current.repository.commit(current.command);
    assert.equal(result.status, outcome === "missing" ? "CONFLICT" : outcome === "same" ? "REPLAYED" : "COMMAND_REUSED");
    assert.deepEqual(current.calls.map(call => call.name), ["read_narrative_fragment_receipt"]);
  }
});
test("unavailable RPCs, unknown status, malformed receipt and invalid operations never use fallback", async () => {
  for (const reply of [{ error: Error("missing RPC"), data: null }, { error: null, data: { status: "UNKNOWN" } },
    { error: null, data: { status: "COMMITTED", receipt: {} } }]) {
    const current = setup(); let count = 0; current.transport.invoke = async name => {
      count++; assert.equal(name, "commit_narrative_fragment"); return reply;
    };
    await assert.rejects(current.repository.commit(current.command)); assert.equal(count, 1);
  }
  const invalid = setup(); invalid.command.plan.operations = [{ type: "clip.remove", clipId: "missing" }];
  await assert.rejects(invalid.repository.commit(invalid.command)); assert.equal(invalid.calls.length, 0);
});
test("Supabase transport disables retries and forwards cancellation to both RPCs", async () => {
  const signal = new AbortController().signal; const calls: unknown[] = [];
  const supabase = { rpc(name: string, parameters: unknown) { calls.push([name, parameters]); return {
    retry(enabled: boolean) { calls.push(enabled); return { abortSignal(received: AbortSignal) {
      calls.push(received); return Promise.resolve({ data: null, error: null }); } }; },
  }; } } as unknown as SupabaseClient;
  const transport = createSupabaseNarrativeFragmentRpcTransport(supabase, signal);
  for (const name of ["read_narrative_fragment_receipt", "commit_narrative_fragment"] as const) {
    await transport.invoke(name, { p_command_id: commandId });
  }
  assert.deepEqual(calls, [["read_narrative_fragment_receipt", { p_command_id: commandId }], false, signal,
    ["commit_narrative_fragment", { p_command_id: commandId }], false, signal]);
});
