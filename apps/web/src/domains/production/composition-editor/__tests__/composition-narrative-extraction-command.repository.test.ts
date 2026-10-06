import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createNarrativeDocumentFixture } from "./fixtures/composition-narrative.fixture";
import { deriveNarrativeNavigationOccurrences } from "../composition-narrative-occurrence.service";
import { buildNarrativeVoiceExtractionPlan } from "../composition-narrative-extraction.service";
import { createNarrativeExtractionCommandRepository, createSupabaseNarrativeExtractionRpcTransport,
  type NarrativeExtractionRpcTransport } from "../composition-narrative-extraction-command.repository";
import type { NarrativeExtractionReadRepository } from "../composition-narrative-extraction-query";
import { hashCompositionDocument } from "../composition-document-hash";

function fixture() {
  const document = createNarrativeDocumentFixture();
  const occurrence = deriveNarrativeNavigationOccurrences(document).occurrences[0]!;
  const documentHash = hashCompositionDocument(document);
  const organizationId = "33333333-3333-4333-8333-333333333333";
  const componentId = "44444444-4444-4444-8444-444444444444";
  const scope = { organizationId, draftId: "55555555-5555-4555-8555-555555555555",
    userId: "66666666-6666-4666-8666-666666666666", commandId: "77777777-7777-4777-8777-777777777777" };
  const planned = buildNarrativeVoiceExtractionPlan({ document, documentHash, organizationId, componentId,
    selection: { documentHash, occurrenceId: occurrence.id, firstSourceIndex: 1, lastSourceIndex: 2 },
    linkedAssetIds: [occurrence.assetId], newClipId: `voice-extract-${scope.commandId}`, newHfId: `hf-voice-extract-${scope.commandId}`,
    registryAsset: { id: occurrence.assetId, organization_id: organizationId, material_component_id: componentId,
      asset_type: "VOICE_AUDIO", mime_type: "audio/mpeg", checksum: "c".repeat(64), qa_status: "READY_FOR_QA",
      duration_milliseconds: 10_000, metadata: { script_hash: occurrence.scriptHash, word_timestamps: document.narrativeScenes![0]!.wordTimestamps } } });
  assert.ok(planned.ok);
  const reads: NarrativeExtractionReadRepository = {
    async readDocument(draftId, orgId) { assert.equal(draftId, scope.draftId); assert.equal(orgId, organizationId); return { document, documentHash }; },
    async readComponentId() { throw new Error("Not needed at the RPC boundary"); },
    async readLinkedAsset() { throw new Error("Atomic RPC owns the final asset checks"); },
  };
  const requestFingerprint = "e".repeat(64);
  const receipt = { commandId: scope.commandId, requestFingerprint, documentHash: "d".repeat(64), version: 2, newClipId: planned.plan.newClipId };
  return { document, reads, scope, commit: { ...scope, requestFingerprint, plan: planned.plan }, receipt };
}

test("receipt lookup passes the full authenticated scope and does not mutate", async () => {
  const { reads, scope, receipt } = fixture();
  const transport: NarrativeExtractionRpcTransport = { async invoke(name, parameters) {
    assert.equal(name, "read_narrative_extraction_receipt");
    assert.deepEqual(parameters, { p_draft_id: scope.draftId, p_organization_id: scope.organizationId,
      p_actor_id: scope.userId, p_command_id: scope.commandId });
    return { data: receipt, error: null };
  } };
  assert.deepEqual(await createNarrativeExtractionCommandRepository(reads, transport).readReceipt(scope), receipt);
});
test("commit sends one RPC with native reducer document, digest and source guard", async () => {
  const { document, reads, commit, receipt } = fixture();
  const before = structuredClone(document);
  let calls = 0;
  const transport: NarrativeExtractionRpcTransport = { async invoke(name, parameters) {
    calls++; assert.equal(name, "commit_narrative_voice_extraction");
    assert.equal(parameters.p_actor_id, commit.userId);
    assert.equal(parameters.p_request_fingerprint, commit.requestFingerprint);
    assert.deepEqual(parameters.p_plan, commit.plan);
    const next = parameters.p_document as typeof document;
    assert.equal(next.clips.length, document.clips.length + 1);
    assert.deepEqual(next.clips[0], document.clips[0]);
    assert.equal(next.canvas.durationSeconds, 31.5);
    assert.equal(parameters.p_document_hash, hashCompositionDocument(next));
    return { data: { status: "COMMITTED", receipt }, error: null };
  } };
  assert.deepEqual(await createNarrativeExtractionCommandRepository(reads, transport).commit(commit), { status: "COMMITTED", receipt });
  assert.equal(calls, 1); assert.deepEqual(document, before);
});
test("stale current revision checks for a concurrent receipt but never invokes the write RPC", async () => {
  const { document, reads, commit } = fixture();
  reads.readDocument = async () => ({ document, documentHash: "f".repeat(64) });
  const transport: NarrativeExtractionRpcTransport = { async invoke(name) {
    assert.equal(name, "read_narrative_extraction_receipt"); return { data: null, error: null };
  } };
  assert.deepEqual(await createNarrativeExtractionCommandRepository(reads, transport).commit(commit), { status: "CONFLICT" });
});
test("receipt completed between initial lookup and reload is replayed, not mistaken for a stale edit", async () => {
  const { document, reads, commit, receipt } = fixture();
  reads.readDocument = async () => ({ document, documentHash: "f".repeat(64) });
  const repository = createNarrativeExtractionCommandRepository(reads, { async invoke(name) {
    assert.equal(name, "read_narrative_extraction_receipt"); return { data: receipt, error: null };
  } });
  assert.deepEqual(await repository.commit(commit), { status: "REPLAYED", receipt });
});
test("known atomic outcomes remain explicit, unknown or malformed outcomes fail closed", async () => {
  const { reads, commit, receipt } = fixture();
  for (const status of ["BUSY", "CONFLICT", "ASSET_CHANGED", "COMMAND_REUSED"] as const) {
    const repository = createNarrativeExtractionCommandRepository(reads, { async invoke() { return { data: { status }, error: null }; } });
    assert.deepEqual(await repository.commit(commit), { status });
  }
  for (const data of [null, { status: "UNCHANGED" }, { status: "COMMITTED", receipt: {} }]) {
    await assert.rejects(createNarrativeExtractionCommandRepository(reads, { async invoke() { return { data, error: null }; } }).commit(commit));
  }
  const replay = createNarrativeExtractionCommandRepository(reads, { async invoke() { return { data: { status: "REPLAYED", receipt }, error: null }; } });
  assert.deepEqual(await replay.commit(commit), { status: "REPLAYED", receipt });
});
test("missing receipt remains null, missing migration and DB failures never use a generic append fallback", async () => {
  const { reads, scope, commit } = fixture();
  assert.equal(await createNarrativeExtractionCommandRepository(reads, { async invoke() { return { data: null, error: null }; } }).readReceipt(scope), null);
  const failure = { code: "PGRST202", message: "RPC missing" };
  const repository = createNarrativeExtractionCommandRepository(reads, { async invoke() { return { data: null, error: failure }; } });
  await assert.rejects(repository.readReceipt(scope), (error) => error === failure);
  await assert.rejects(repository.commit(commit), (error) => error === failure);
});
test("Supabase transport disables retries and forwards cancellation for read and commit", async () => {
  const signal = new AbortController().signal;
  const calls: unknown[] = [];
  const client = { rpc(name: string, parameters: unknown) {
    calls.push([name, parameters]);
    return { retry(enabled: boolean) {
      assert.equal(enabled, false);
      return { abortSignal(received: AbortSignal) { assert.equal(received, signal); return Promise.resolve({ data: null, error: null }); } };
    } };
  } } as unknown as SupabaseClient;
  const transport = createSupabaseNarrativeExtractionRpcTransport(client, signal);
  await transport.invoke("read_narrative_extraction_receipt", {});
  await transport.invoke("commit_narrative_voice_extraction", {});
  assert.equal(calls.length, 2);
});
test("shared document hashing retains property-order independence without ignoring array order", () => {
  const document = createNarrativeDocumentFixture();
  const reordered = Object.fromEntries(Object.entries(document).reverse()) as typeof document;
  assert.equal(hashCompositionDocument(document), hashCompositionDocument(reordered));
  const changed = structuredClone(document);
  changed.narrativeScenes![0]!.wordTimestamps!.reverse();
  assert.notEqual(hashCompositionDocument(document), hashCompositionDocument(changed));
});
