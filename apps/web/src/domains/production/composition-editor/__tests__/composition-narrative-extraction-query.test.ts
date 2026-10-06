import assert from "node:assert/strict";
import test from "node:test";
import { createNarrativeDocumentFixture } from "./fixtures/composition-narrative.fixture";
import { deriveNarrativeNavigationOccurrences } from "../composition-narrative-occurrence.service";
import { narrativeExtractionQuerySchema, queryNarrativeVoiceExtraction, type NarrativeExtractionReadRepository } from "../composition-narrative-extraction-query";

function fixture() {
  const document = createNarrativeDocumentFixture();
  const occurrence = deriveNarrativeNavigationOccurrences(document).occurrences[0]!;
  const organizationId = "33333333-3333-4333-8333-333333333333";
  const componentId = "44444444-4444-4444-8444-444444444444";
  const draftId = "55555555-5555-4555-8555-555555555555";
  const documentHash = "b".repeat(64);
  const calls: string[] = [];
  const registryAsset = { id: occurrence.assetId, organization_id: organizationId, material_component_id: componentId,
    asset_type: "VOICE_AUDIO", mime_type: "audio/mpeg", checksum: "c".repeat(64), qa_status: "READY_FOR_QA",
    duration_milliseconds: 10_000, metadata: { script_hash: occurrence.scriptHash, word_timestamps: document.narrativeScenes![0]!.wordTimestamps } };
  const repository: NarrativeExtractionReadRepository = {
    async readComponentId(receivedDraft, receivedOrg) {
      assert.deepEqual([receivedDraft, receivedOrg], [draftId, organizationId]);
      calls.push("context"); return componentId;
    },
    async readDocument(receivedDraft, receivedOrg) {
      assert.deepEqual([receivedDraft, receivedOrg], [draftId, organizationId]);
      calls.push("document"); return { document, documentHash };
    },
    async readLinkedAsset(receivedDraft, receivedOrg, receivedComponent, receivedAsset) {
      assert.deepEqual([receivedDraft, receivedOrg, receivedComponent, receivedAsset], [draftId, organizationId, componentId, occurrence.assetId]);
      calls.push("asset"); return registryAsset;
    },
  };
  return { params: { draftId, organizationId, repository, selection: { documentHash, occurrenceId: occurrence.id,
    firstSourceIndex: 1, lastSourceIndex: 2 } }, document, registryAsset, calls };
}

test("queries scoped context and source from repository, returns only an eligibility summary", async () => {
  const { params, document, calls } = fixture();
  const before = structuredClone(document);
  const result = await queryNarrativeVoiceExtraction(params);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["context", "document", "asset"]);
  if (!result.ok) return;
  assert.match(result.summary.reviewFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.summary, { contract: "NARRATIVE_VOICE_EXTRACTION_ELIGIBILITY_V2", documentHash: params.selection.documentHash,
    reviewFingerprint: result.summary.reviewFingerprint,
    scope: "VOICE_ONLY", binding: "REGISTRY_METADATA_MATCH_ONLY", sourceStartSeconds: 1, sourceEndSeconds: 2.5,
    destinationStartSeconds: 30, destinationEndSeconds: 31.5, requiresRevalidationBeforeApply: true });
  assert.deepEqual(document, before);
});
test("missing authorized draft stops before reading documents or assets", async () => {
  const { params, calls } = fixture();
  params.repository.readComponentId = async () => null;
  assert.deepEqual(await queryNarrativeVoiceExtraction(params), { ok: false, reason: "DRAFT_NOT_FOUND" });
  assert.deepEqual(calls, []);
});
test("stale document and invalid occurrence stop before reading registry metadata", async () => {
  for (const reason of ["STALE_DOCUMENT", "INVALID_RANGE"] as const) {
    const { params, calls } = fixture();
    if (reason === "STALE_DOCUMENT") params.selection.documentHash = "d".repeat(64);
    else params.selection.occurrenceId = "removed";
    assert.deepEqual(await queryNarrativeVoiceExtraction(params), { ok: false, reason });
    assert.deepEqual(calls, ["context", "document"]);
  }
});
test("missing linked asset and mismatched registry tenant fail closed", async () => {
  const missing = fixture();
  missing.params.repository.readLinkedAsset = async () => null;
  assert.deepEqual(await queryNarrativeVoiceExtraction(missing.params), { ok: false, reason: "ASSET_BINDING_UNAVAILABLE" });
  const foreign = fixture();
  foreign.registryAsset.organization_id = foreign.params.draftId;
  assert.deepEqual(await queryNarrativeVoiceExtraction(foreign.params), { ok: false, reason: "ASSET_SCOPE_MISMATCH" });
});
test("client cannot submit assets, operations, scope or unbounded selections", () => {
  const { params } = fixture();
  for (const extra of [{ registryAsset: {} }, { operations: [] }, { organizationId: params.organizationId },
    { occurrenceId: "a".repeat(4097) }, { adjustedStartSeconds: Infinity }, { firstSourceIndex: -1 }]) {
    assert.equal(narrativeExtractionQuerySchema.safeParse({ ...params.selection, ...extra }).success, false);
  }
});
test("unexpected repository failure propagates, never reports extraction eligible", async () => {
  const { params } = fixture();
  params.repository.readLinkedAsset = async () => { throw new Error("registry unavailable"); };
  await assert.rejects(queryNarrativeVoiceExtraction(params), /registry unavailable/);
});
