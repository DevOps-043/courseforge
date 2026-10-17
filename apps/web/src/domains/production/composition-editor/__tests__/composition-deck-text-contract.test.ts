import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildDeckConformanceCorpusCase } from "../qa/composition-deck-conformance-corpus";
import { buildSnapshotConformanceContract } from "../composition-snapshot-conformance-contract";
import { compositionConformanceContractSchema, evaluateCompositionConformance } from "../composition-preview-render-conformance";
import { restrictSnapshotDeckTextReuse, assertSnapshotVisibilityReuse } from "../composition-snapshot-conformance-policy";
import { buildConformanceReferenceSource, verifyConformanceReferenceSource } from "../composition-conformance-reference.service";
import { prepareCompositionEventBatchContracts } from "../composition-conformance-event-batch-contract";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { hashCompositionDocument } from "../composition-document.service";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../composition-text-parity-policy";
import { assertConformanceReportMatchesContract } from "../qa/composition-conformance-contract-report-gate";

function fixture(deckText = true, eventCheckpoints = false) {
  const corpus = buildDeckConformanceCorpusCase("deck-cut", 25);
  const input = {document: corpus.document, documentHash: corpus.documentHash, assets: [],
    renderProfile: {format: "mp4" as const, fps: 25 as const, quality: "high" as const, resolution: "1080p" as const}};
  const contract = buildSnapshotConformanceContract({...input, contractVersion: 4, deckText, eventCheckpoints});
  if (contract.schemaVersion !== 4) throw new Error("Expected v4");
  return {...input, contract};
}

test("v4 freezes source-derived deck expectations; legacy contracts cannot opt in", () => {
  const input = fixture();
  assert.equal(input.contract.deckTextPlan!.clips.length, 2);
  assert.equal(input.contract.deckTextPlan!.documentHash, input.documentHash);
  assert.equal(fixture(false).contract.deckTextPlan, undefined);
  assert.throws(() => buildSnapshotConformanceContract({...input, contractVersion: 3, deckText: true}), /VERSION_INVALID/);
  const changed = structuredClone(input.contract); changed.deckTextPlan!.documentHash = "a".repeat(64);
  assert.equal(compositionConformanceContractSchema.safeParse(changed).success, false);
});

test("deck paint requires v4/source plan and snapshot reuse cannot cross mask policy presence", () => {
  const input = fixture();
  const required = buildSnapshotConformanceContract({...input, contractVersion: 4, deckText: true, deckTextPaintMasks: true});
  if (required.schemaVersion !== 4) throw new Error("Expected v4");
  assert.equal(required.deckTextPaintMaskPolicy, "DECK_TEXT_FILL_SUPPRESSION_RESTORED_V1");
  assert.throws(() => buildSnapshotConformanceContract({...input, contractVersion: 4, deckTextPaintMasks: true}), /PLAN_REQUIRED/);
  assert.throws(() => buildSnapshotConformanceContract({...input, contractVersion: 3, deckText: true, deckTextPaintMasks: true}), /PLAN_REQUIRED/);
  const missing = structuredClone(required); delete missing.deckTextPlan;
  assert.equal(compositionConformanceContractSchema.safeParse(missing).success, false);
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: required}, input.contract), /DECK_PAINT_POLICY_MISMATCH/);
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: input.contract}, required), /DECK_PAINT_POLICY_MISMATCH/);
});

test("snapshot reuse distinguishes presence/absence and checks the entire frozen plan", () => {
  const calls: unknown[][] = [];
  const query = {eq: (column: string, value: string) => {calls.push(["eq", column, value]); return query;},
    is: (column: string, value: null) => {calls.push(["is", column, value]); return query;}};
  const required = fixture().contract, legacy = fixture(false).contract;
  restrictSnapshotDeckTextReuse(query, required); restrictSnapshotDeckTextReuse(query, legacy);
  assert.deepEqual(calls, [["eq", "manifest->conformance_contract->deckTextPlan->>policy", "SOURCE_HTML_TEXT_NODE_PATHS_V1"],
    ["is", "manifest->conformance_contract->>deckTextPaintMaskPolicy", null],
    ["is", "manifest->conformance_contract->deckTextPlan->>policy", null],
    ["is", "manifest->conformance_contract->>deckTextPaintMaskPolicy", null]]);
  assertSnapshotVisibilityReuse({conformance_contract: required}, required);
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: legacy}, required), /DECK_TEXT_MISMATCH/);
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: required}, legacy), /DECK_TEXT_MISMATCH/);
  const forged = structuredClone(required); forged.deckTextPlan!.clips[0]!.entries = [];
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: forged}, required), /DECK_TEXT_MISMATCH/);
});

test("authorized preview source recomputes the deck plan even when altered metadata hashes are self-consistent", async () => {
  const input = fixture();
  const source = await buildConformanceReferenceSource(input);
  assert.deepEqual(verifyConformanceReferenceSource(source).contract, input.contract);
  const forged = structuredClone(input.contract); forged.deckTextPlan!.clips[0]!.entries[0]!.textSha256 = "b".repeat(64);
  await assert.rejects(buildConformanceReferenceSource({...input, contract: forged}), /SOURCE_MISMATCH/);
  const contractJson = JSON.stringify(forged);
  assert.throws(() => verifyConformanceReferenceSource({...source, contractJson,
    metadata: {...source.metadata, contractSha256: createHash("sha256").update(contractJson).digest("hex")}}), /SOURCE_MISMATCH/);
});

test("perfect image and native text metrics cannot certify frozen deck text without its measured evidence", () => {
  for (const enabled of [false, true]) {
    const input = fixture(enabled);
    const samples = input.contract.checkpoints.map(({frameIndex}) => ({frameIndex, width: 1920, height: 1080,
      meanAbsoluteError: 0, mismatchedPixelRatio: 0, psnrDb: 99, temporalDriftMs: 0, ssim: 1,
      textParity: {policy: input.contract.textParity.policy, status: "PASS" as const, checkedRegionCount: 0,
        expectedRegionCount: 0, maximumAcceptedDisplacementPixels: null, regions: []}}));
    const result = evaluateCompositionConformance({contract: input.contract, samples,
      previewDocumentHash: input.documentHash, renderDocumentHash: input.documentHash});
    assert.equal(result.status, enabled ? "INCOMPLETE" : "PASS");
    assert.equal(result.incompletenessReasons!.includes("DECK_TEXT_EVIDENCE_INCOMPLETE"), enabled);
  }
});

test("an empty frozen deck plan still requires its measured zero-region checkpoints", () => {
  const document = createInitialCompositionDocument({animatedDeck: null, assets: [], sourceInsertionMode: "MANUAL",
    plan: {title: "No deck", subtitle: "", accentColor: "#38BDF8", durationSeconds: 3}});
  const documentHash = hashCompositionDocument(document);
  const contract = buildSnapshotConformanceContract({document, documentHash, assets: [], contractVersion: 4, deckText: true,
    renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  if (contract.schemaVersion !== 4) throw new Error("Expected v4");
  const samples = contract.checkpoints.map(({frameIndex}) => ({frameIndex, width: contract.canvas.width, height: contract.canvas.height,
    meanAbsoluteError: 0, mismatchedPixelRatio: 0, psnrDb: 99, temporalDriftMs: 0, ssim: 1,
    textParity: {policy: COMPOSITION_TEXT_PARITY_POLICY.id, status: "PASS" as const, checkedRegionCount: 0,
      expectedRegionCount: 0, maximumAcceptedDisplacementPixels: null, regions: []}}));
  const missing = evaluateCompositionConformance({contract, samples, previewDocumentHash: documentHash, renderDocumentHash: documentHash});
  assert.equal(missing.status, "INCOMPLETE");
  assert.equal(missing.deckText?.status, "INCOMPLETE");
  const measured = evaluateCompositionConformance({contract, samples: samples.map((sample) => ({...sample,
    deckText: {policy: COMPOSITION_TEXT_PARITY_POLICY.id, status: "PASS" as const, checkedRegionCount: 0,
      expectedRegionCount: 0, maximumAcceptedDisplacementPixels: null, regions: []}})),
    previewDocumentHash: documentHash, renderDocumentHash: documentHash});
  assert.equal(measured.deckText?.status, "PASS");
  assert.equal(measured.status, "PASS");
});

test("final worker binds the authorized deck obligation to the measured report and refuses premature PASS", () => {
  const input = fixture();
  const samples = input.contract.checkpoints.map(({frameIndex}) => ({frameIndex,
    meanAbsoluteError: 0, mismatchedPixelRatio: 0, psnrDb: 99, temporalDriftMs: 0, ssim: 1,
    width: input.contract.canvas.width, height: input.contract.canvas.height,
    textParity: {policy: COMPOSITION_TEXT_PARITY_POLICY.id, status: "PASS" as const, checkedRegionCount: 0,
      expectedRegionCount: 0, maximumAcceptedDisplacementPixels: null, regions: []}}));
  const report = evaluateCompositionConformance({contract: input.contract, samples,
    previewDocumentHash: input.documentHash, renderDocumentHash: input.documentHash});
  assertConformanceReportMatchesContract(input.contract, report);
  assert.throws(() => assertConformanceReportMatchesContract(input.contract, {...report, status: "PASS"}), /DECK_ATTESTATION_PENDING/);
  assert.throws(() => assertConformanceReportMatchesContract(input.contract, {...report, deckText: undefined}), /DECK_TEXT_CONTRACT/);
  assert.throws(() => assertConformanceReportMatchesContract(input.contract, {...report, deckText: {
    ...report.deckText!, policy: "FORGED" as NonNullable<typeof report.deckText>["policy"]}}), /DECK_TEXT_CONTRACT/);
  assert.throws(() => assertConformanceReportMatchesContract(input.contract, {...report,
    incompletenessReasons: []}), /DECK_ATTESTATION_PENDING/);
});

test("every event partition inherits the deck obligation and rejects a fabricated parent plan", () => {
  const input = fixture(true, true);
  const prepared = prepareCompositionEventBatchContracts({document: input.document, parentContract: input.contract});
  for (let index = 0; index < prepared.batchCount; index++) {
    const child = prepared.select(index).contract;
    assert.equal(child.schemaVersion, 4);
    if (child.schemaVersion !== 4) throw new Error("Expected v4");
    assert.deepEqual(child.deckTextPlan, input.contract.deckTextPlan);
  }
  const forged = structuredClone(input.contract); forged.deckTextPlan!.clips = [];
  assert.throws(() => prepareCompositionEventBatchContracts({document: input.document, parentContract: forged}), /SOURCE_MISMATCH/);
});
