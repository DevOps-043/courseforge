import assert from "node:assert/strict";
import test from "node:test";
import { executeCompositionEventCheckpointBatches, type EventBatchMeasurementPacket,
  type EventBatchMeasurementAdapters, hashEventBatchMeasurementPacket } from "../qa/composition-conformance-event-batch-execution";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT } from "../composition-document.types";
import { hashCompositionDocument } from "../composition-document.service";
import { buildSnapshotConformanceContract } from "../composition-snapshot-conformance-contract";
import { getHyperframesRenderProfile } from "../../hyperframes/hyperframes-render-profiles";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../composition-text-parity-policy";
import { prepareCompositionEventBatchContracts, buildCompositionEventBatchAuthorization, assertSnapshotEventBatchAuthorization } from "../composition-conformance-event-batch-contract";
import { assertEventBatchCaptureLineage } from "../composition-conformance-event-batch-lineage";
import { measureCompositionEventBatchWithPersistedReference } from "../qa/composition-conformance-event-batch-measurement";
import { eventBatchMeasurementIdentitySchema, eventBatchExecutionSummarySchema } from "../qa/composition-conformance-event-batch-execution";
import { createPersistedCompositionEventBatchAdapters } from "../qa/composition-conformance-event-batch-adapters";
import { executePersistedCompositionEventBatches } from "../qa/composition-conformance-persisted-event-execution";
import { evaluateEventVisualCoverageGate } from "../qa/composition-conformance-event-visual-gate";
import { evaluateCompositionConformance, type CompositionConformanceReport } from "../composition-preview-render-conformance";
import { DECLARED_NATIVE_FONT_USAGE_POLICY } from "../composition-font-usage-contract";
import { aggregateEventVisualMetrics } from "../qa/composition-event-visual-metrics";
import { DECK_TEXT_PLAN_POLICY } from "../composition-deck-text-plan";
import { COMPOSITION_EVENT_PLAN_MAX_BATCHES, COMPOSITION_EVENT_PLAN_MAX_CHECKPOINTS } from "../composition-conformance-batch-contract";
import { EVENT_DIAGNOSTIC_MAX_BATCHES } from "../qa/composition-event-diagnostics";
import {controlledRenderExecutionContractSchema} from "../composition-render-execution-contract";
import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";

function fixture(colorTags = false, paintMasks = false) {
  const document = createInitialCompositionDocument({sourceInsertionMode: "MANUAL", animatedDeck: null, assets: [],
    plan: {title: "Batches", subtitle: "Resume", accentColor: "#38BDF8", durationSeconds: 10}});
  document.canvas.durationSeconds = 10;
  const {clip, track} = createCompositionNativeOverlay({document, id: "captions", kind: "CAPTION", playheadSeconds: 0});
  if (track) document.tracks.push(track);
  clip.durationSeconds = 10;
  if (clip.source.type !== "NATIVE_CAPTIONS") throw new Error("Expected captions");
  clip.source.cues = Array.from({length: 40}, (_, index) => ({id: `cue-${index}`, text: "controlled", startSeconds: index * 0.2, endSeconds: index * 0.2 + 0.16}));
  document.clips.push(clip); document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  const parentContract = buildSnapshotConformanceContract({document, documentHash: hashCompositionDocument(document), assets: [],
    renderProfile: getHyperframesRenderProfile("balanced"), contractVersion: 4, eventCheckpoints: true, colorTags, paintMasks});
  const input = {document, parentContract, organizationId: "70000000-0000-4000-8000-000000000001",
    revisionId: "70000000-0000-4000-8000-000000000002", projectHash: "a".repeat(64), videoSha256: "b".repeat(64)};
  const stored = new Map<number, {packetSha256: string; packet: EventBatchMeasurementPacket}>(), measured: number[] = [];
  const adapters: EventBatchMeasurementAdapters = {
    async readBatch(identity) {return structuredClone(stored.get(identity.batch.batchIndex) ?? null);},
    async persistBatch(packet) {stored.set(packet.identity.batch.batchIndex, {packetSha256: hashEventBatchMeasurementPacket(packet), packet: structuredClone(packet)});},
    async measureBatch({identity, contract}) {
      measured.push(identity.batch.batchIndex);
      if (contract.schemaVersion !== 4) throw new Error("Expected v4");
      return {schemaVersion: 1, scope: "EVENT_VISUAL_SAMPLE_PACKET_NOT_INDEPENDENT_ATTESTATION", identity,
        previewDocumentHash: contract.documentHash, renderDocumentHash: contract.documentHash,
        samples: contract.textParity.checkpoints.map((checkpoint) => ({frameIndex: checkpoint.frameIndex,
          meanAbsoluteError: 0, mismatchedPixelRatio: 0, psnrDb: 99, temporalDriftMs: 0, ssim: 1,
          width: contract.canvas.width, height: contract.canvas.height,
          textParity: {policy: COMPOSITION_TEXT_PARITY_POLICY.id, status: "PASS", expectedRegionCount: checkpoint.expectedTexts.length,
            checkedRegionCount: checkpoint.expectedTexts.length, maximumAcceptedDisplacementPixels: 0,
            regions: checkpoint.expectedTexts.map((text) => ({elementId: text.elementId, status: "PASS", reason: null,
              displacementX: 0, displacementY: 0, meanAbsoluteError: 0, mismatchedPixelRatio: 0}))}}))};
    },
  };
  return {input, adapters, stored, measured};
}

test("every authorized event child preserves the frozen mask obligation in its identity", () => {
  const required = fixture(false, true).input, legacy = fixture().input;
  const prepared = prepareCompositionEventBatchContracts(required);
  const authorization = buildCompositionEventBatchAuthorization(required);
  const previous = buildCompositionEventBatchAuthorization(legacy);
  assert.ok(prepared.batchCount > 1);
  for (let index = 0; index < prepared.batchCount; index++) {
    const selected = prepared.select(index); if (selected.contract.schemaVersion !== 4) throw new Error("Expected v4");
    assert.equal(selected.contract.textParity.paintMaskPolicy, "NATIVE_TEXT_PAINT_SUPPRESSION_RESTORED_V1");
    assert.equal(authorization.batchContractSha256[index], selected.batchContractSha256);
    assert.notEqual(authorization.batchContractSha256[index], previous.batchContractSha256[index]);
  }
});

test("every event partition binds execution expectations and cannot downgrade them through lineage", () => {
  const state = fixture();
  const previous = buildCompositionEventBatchAuthorization(state.input);
  const renderExecution = controlledRenderExecutionContractSchema.parse({policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1",
    backend: "CONTROLLED", sdkVersion: "0.7.106",
    expectedBrowser: {protocolVersion: "1.3", product: "test", revision: "test", userAgent: "test", jsVersion: "test"},
    files: Object.fromEntries(["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"]
      .map(role => [role, {sha256: "c".repeat(64), sizeBytes: 10}]))});
  state.input.parentContract = compositionConformanceContractSchema.parse({...state.input.parentContract, renderExecution});
  const prepared = prepareCompositionEventBatchContracts(state.input);
  const authorized = buildCompositionEventBatchAuthorization(state.input);
  assert.ok(prepared.batchCount > 1);
  for (let index = 0; index < prepared.batchCount; index++) {
    const selected = prepared.select(index);
    if (selected.contract.schemaVersion !== 4) throw new Error("Expected v4");
    assert.deepEqual(selected.contract.renderExecution, renderExecution);
    assert.notEqual(authorized.batchContractSha256[index], previous.batchContractSha256[index]);
    const lineage = {policy: "VERIFIED_ROOT_EVENT_PARTITION_V1",
      scope: "ONE_PREVIEW_PARTITION_NOT_GLOBAL_RENDER_ATTESTATION", parentContractSha256: prepared.parentContractSha256,
      batchContractSha256: selected.batchContractSha256, batch: selected.contract.checkpointBatch};
    assertEventBatchCaptureLineage(lineage, selected.contract, state.input);
    delete selected.contract.renderExecution;
    assert.throws(() => assertEventBatchCaptureLineage(lineage, selected.contract, state.input), /LINEAGE_MISMATCH|PARENT_MISMATCH/);
    const measured = evaluateCompositionConformance({contract: prepared.select(index).contract,
      previewDocumentHash: prepared.documentHash, renderDocumentHash: prepared.documentHash, samples: []});
    assert.ok(measured.incompletenessReasons?.includes("RENDER_EXECUTION_ATTESTATION_PENDING"));
  }
});

test("shared partition derivation preserves root obligations and isolates returned contracts", () => {
  const state = fixture(true), original = structuredClone(state.input.parentContract);
  const prepared = prepareCompositionEventBatchContracts(state.input);
  const first = prepared.select(0), second = prepared.select(1);
  assert.deepEqual(first.contract, original);
  assert.notEqual(first.batchContractSha256, second.batchContractSha256);
  assert.equal(first.batchContractSha256, prepared.parentContractSha256);
  if (second.contract.schemaVersion !== 4 || original.schemaVersion !== 4) throw new Error("Expected v4");
  assert.equal(second.contract.colorTagPolicy, original.colorTagPolicy);
  assert.deepEqual(second.contract.canvas, original.canvas);
  assert.deepEqual(second.contract.assets, original.assets);
  delete second.contract.colorTagPolicy;
  state.input.document.canvas.width += 1;
  const selectedAgain = prepared.select(1).contract;
  if (selectedAgain.schemaVersion !== 4) throw new Error("Expected v4");
  assert.equal(selectedAgain.colorTagPolicy, original.colorTagPolicy);
  assert.deepEqual(state.input.parentContract, original);
});

test("shared partition derivation rejects invalid indices and a child masquerading as the root", () => {
  const state = fixture(), prepared = prepareCompositionEventBatchContracts(state.input);
  for (const index of [-1, 0.5, NaN, Infinity, prepared.batchCount]) {
    assert.throws(() => prepared.select(index), /BATCH_INDEX_INVALID/);
  }
  assert.throws(() => prepareCompositionEventBatchContracts({...state.input, parentContract: prepared.select(1).contract}),
    /PARENT_INVALID/);
});

test("child capture lineage requires the verified root and cannot downgrade frozen obligations", () => {
  const state = fixture(true), prepared = prepareCompositionEventBatchContracts(state.input);
  const selected = prepared.select(1);
  if (selected.contract.schemaVersion !== 4) throw new Error("Expected v4");
  const lineage = {policy: "VERIFIED_ROOT_EVENT_PARTITION_V1",
    scope: "ONE_PREVIEW_PARTITION_NOT_GLOBAL_RENDER_ATTESTATION", parentContractSha256: prepared.parentContractSha256,
    batchContractSha256: selected.batchContractSha256, batch: selected.contract.checkpointBatch};
  assert.throws(() => assertEventBatchCaptureLineage(lineage, selected.contract), /AUTHORIZED_PARENT_REQUIRED/);
  assert.throws(() => assertEventBatchCaptureLineage(undefined, selected.contract, state.input), /LINEAGE_MISSING/);
  assertEventBatchCaptureLineage(lineage, selected.contract, state.input);
  assert.throws(() => assertEventBatchCaptureLineage({...lineage, parentContractSha256: "e".repeat(64)}, selected.contract, state.input),
    /PARENT_MISMATCH/);
  delete selected.contract.colorTagPolicy;
  assert.throws(() => assertEventBatchCaptureLineage(lineage, selected.contract, state.input), /LINEAGE_MISMATCH/);
  const root = prepared.select(0);
  if (root.contract.schemaVersion !== 4) throw new Error("Expected v4");
  const rootLineage = {...lineage, batchContractSha256: root.batchContractSha256, batch: root.contract.checkpointBatch};
  assertEventBatchCaptureLineage(rootLineage, root.contract);
  assert.throws(() => assertEventBatchCaptureLineage({...rootLineage, parentContractSha256: "e".repeat(64)}, root.contract),
    /PARENT_MISMATCH/);
});

test("revision authorization freezes every child hash and rejects missing, reordered or altered entries", () => {
  const state = fixture(true), prepared = prepareCompositionEventBatchContracts(state.input);
  const authorization = buildCompositionEventBatchAuthorization(state.input);
  assert.equal(authorization.batchContractSha256.length, prepared.batchCount);
  assert.equal(authorization.batchContractSha256[0], prepared.parentContractSha256);
  const manifest = {conformance_contract: state.input.parentContract, conformance_event_batch_authorization: authorization};
  assertSnapshotEventBatchAuthorization(manifest, state.input.document);
  assert.throws(() => assertSnapshotEventBatchAuthorization({conformance_contract: state.input.parentContract}, state.input.document),
    /AUTHORIZATION_MISMATCH/);
  const child = prepared.select(1);
  if (child.contract.schemaVersion !== 4) throw new Error("Expected v4");
  const lineage = {policy: "VERIFIED_ROOT_EVENT_PARTITION_V1", scope: "ONE_PREVIEW_PARTITION_NOT_GLOBAL_RENDER_ATTESTATION",
    parentContractSha256: prepared.parentContractSha256, batchContractSha256: child.batchContractSha256, batch: child.contract.checkpointBatch};
  const revision = {parentContract: state.input.parentContract, batchAuthorization: authorization};
  assertEventBatchCaptureLineage(lineage, child.contract, undefined, revision);
  for (const failure of ["alter", "remove", "duplicate", "root"] as const) {
    const changed = structuredClone(authorization);
    if (failure === "alter") changed.batchContractSha256[1] = "e".repeat(64);
    if (failure === "remove") changed.batchContractSha256.pop();
    if (failure === "duplicate") changed.batchContractSha256[1] = changed.batchContractSha256[0]!;
    if (failure === "root") changed.parentContractSha256 = "e".repeat(64);
    assert.throws(() => assertSnapshotEventBatchAuthorization({...manifest, conformance_event_batch_authorization: changed}, state.input.document));
    assert.throws(() => assertEventBatchCaptureLineage(lineage, child.contract, undefined, {...revision, batchAuthorization: changed}));
  }
});

test("all partitions are measured and reread, then exact persisted packets resume without repeating measurement", async () => {
  const state = fixture(), first = await executeCompositionEventCheckpointBatches(state.input, state.adapters);
  assert.equal(first.status, "PASS"); assert.ok(first.requiredBatchCount > 1);
  assert.equal(first.measuredCheckpointCount, first.requiredCheckpointCount);
  assert.equal(first.measuredBatchCount, first.requiredBatchCount); assert.equal(first.resumedBatchCount, 0);
  assert.equal(state.measured.length, first.requiredBatchCount);
  assert.equal(first.scope, "COMPLETE_NATIVE_EVENT_VISUAL_SAMPLE_COVERAGE_NOT_FULL_RENDER_ATTESTATION");
  const resumed = await executeCompositionEventCheckpointBatches(state.input, state.adapters);
  assert.equal(resumed.resumedBatchCount, first.requiredBatchCount); assert.equal(resumed.status, "PASS");
  assert.equal(state.measured.length, first.requiredBatchCount); assert.deepEqual(first.batches, resumed.batches);
});

test("visual coverage diagnostic resolves partition-only incompleteness without hiding missing metrics, color or fonts", async () => {
  const state = fixture(), execution = await executeCompositionEventCheckpointBatches(state.input, state.adapters);
  const packet = state.stored.get(0)!.packet;
  const root = evaluateCompositionConformance({contract: state.input.parentContract,
    previewDocumentHash: packet.previewDocumentHash, renderDocumentHash: packet.renderDocumentHash, samples: packet.samples});
  assert.deepEqual(root.incompletenessReasons, ["EVENT_PARTITION_COVERAGE"]);
  assert.equal(root.status, "INCOMPLETE");
  const covered = evaluateEventVisualCoverageGate({root, execution});
  assert.equal(covered.status, "PASS"); assert.deepEqual(covered.blockedReasons, []);
  const forgedDeckRoot: CompositionConformanceReport = {...root, deckText: {policy: DECK_TEXT_PLAN_POLICY,
    scope: "DECK_SOURCE_TEXT_REGIONS_NOT_RENDER_FONT_ATTESTATION", status: "PASS",
    requiredCheckpointCount: root.requiredCheckpointCount, checkedCheckpointCount: root.requiredCheckpointCount,
    expectedRegionCount: 0, checkedRegionCount: 0}};
  assert.ok(evaluateEventVisualCoverageGate({root: forgedDeckRoot, execution}).blockedReasons.includes("ROOT_MEASUREMENT_INCONSISTENT"));
  assert.equal(covered.scope, "VISUAL_SAMPLE_GATES_NOT_AUDIO_ENVIRONMENT_OR_RENDER_ATTESTATION");
  const legacyExecution = structuredClone(execution);
  delete legacyExecution.visualMetrics;
  for (const batch of legacyExecution.batches) delete batch.visualMetrics;
  assert.equal(eventBatchExecutionSummarySchema.safeParse(legacyExecution).success, true);
  const legacyGate = evaluateEventVisualCoverageGate({root, execution: legacyExecution});
  assert.equal(legacyGate.status, "INCOMPLETE");
  assert.ok(legacyGate.blockedReasons.includes("AGGREGATE_METRICS_MISSING"));
  for (const missing of ["thresholds", "ssim"] as const) {
    const changed = structuredClone(root); delete changed[missing];
    const gate = evaluateEventVisualCoverageGate({root: changed, execution});
    assert.equal(gate.status, "INCOMPLETE");
    assert.ok(gate.blockedReasons.includes("AGGREGATE_METRIC_POLICY_MISMATCH"));
  }
  assert.equal(evaluateEventVisualCoverageGate({root: {...root,
    thresholds: {...root.thresholds!, maxMeanAbsoluteError: root.thresholds!.maxMeanAbsoluteError + 1}}, execution}).status, "INCOMPLETE");
  for (const failure of ["text", "ssim", "sample"] as const) {
    const samples = structuredClone(packet.samples);
    if (failure === "text") delete samples[0]!.textParity;
    if (failure === "ssim") delete samples[0]!.ssim;
    if (failure === "sample") samples.pop();
    const measured = evaluateCompositionConformance({contract: state.input.parentContract,
      previewDocumentHash: packet.previewDocumentHash, renderDocumentHash: packet.renderDocumentHash, samples});
    assert.ok(measured.incompletenessReasons?.includes(failure === "text" ? "NATIVE_TEXT_EVIDENCE_INCOMPLETE"
      : failure === "ssim" ? "SSIM_CHECKPOINTS_MISSING" : "CHECKPOINT_SAMPLES_MISSING"));
    assert.notEqual(evaluateEventVisualCoverageGate({root: measured, execution}).status, "PASS");
  }
  assert.equal(evaluateEventVisualCoverageGate({root: {...root, incompletenessReasons: undefined}, execution}).status, "INCOMPLETE");
  assert.equal(evaluateEventVisualCoverageGate({root: undefined, execution}).status, "INCOMPLETE");
  assert.notEqual(evaluateEventVisualCoverageGate({root: {...root, checkpointBatchCoverage: {...root.checkpointBatchCoverage!,
    batch: {...root.checkpointBatchCoverage!.batch, planSha256: "e".repeat(64)}}}, execution}).status, "PASS");
  const withFont: CompositionConformanceReport = {...root, fontUsage: {policy: DECLARED_NATIVE_FONT_USAGE_POLICY, scope: "RENDERER_GLYPH_PROVENANCE" as const,
    status: "INCOMPLETE" as const, reason: "RENDERER_FONT_USAGE_EVIDENCE_UNAVAILABLE" as const,
    manifestSha256: "f".repeat(64), requiredBindingCount: 1}};
  assert.equal(evaluateEventVisualCoverageGate({root: withFont, execution}).status, "INCOMPLETE");
  const colorState = fixture(true), colorExecution = await executeCompositionEventCheckpointBatches(colorState.input, colorState.adapters);
  const colorPacket = colorState.stored.get(0)!.packet;
  const colorRoot = evaluateCompositionConformance({contract: colorState.input.parentContract,
    previewDocumentHash: colorPacket.previewDocumentHash, renderDocumentHash: colorPacket.renderDocumentHash, samples: colorPacket.samples});
  assert.ok(colorRoot.incompletenessReasons?.includes("COLOR_TAGS_INCOMPLETE"));
  assert.equal(evaluateEventVisualCoverageGate({root: colorRoot, execution: colorExecution}).status, "INCOMPLETE");
});

test("full event metrics sum coverage and preserve an isolated failing frame instead of averaging it away", async () => {
  const state = fixture(), measure = state.adapters.measureBatch;
  state.adapters.measureBatch = async (input) => {
    const packet = await measure(input) as EventBatchMeasurementPacket;
    if (input.identity.batch.batchIndex === 1) {
      packet.samples[0]!.ssim = 0.9;
      packet.samples[0]!.mismatchedPixelRatio = 0.01;
      packet.samples[0]!.temporalDriftMs = 100;
    }
    return packet;
  };
  const result = await executeCompositionEventCheckpointBatches(state.input, state.adapters);
  assert.equal(result.status, "FAIL");
  const metrics = result.visualMetrics!;
  assert.equal(metrics.requiredCheckpointCount, result.requiredCheckpointCount);
  assert.equal(metrics.checkedCheckpointCount, result.measuredCheckpointCount);
  assert.equal(metrics.ssim.checkedCheckpointCount, result.requiredCheckpointCount);
  assert.equal(metrics.ssim.minimumObserved, 0.9);
  const diagnostic = result.diagnostics!.batches[0]!;
  assert.equal(result.diagnostics!.affectedBatchCount, 1);
  assert.equal(diagnostic.batchIndex, 1);
  assert.equal(diagnostic.packetSha256, result.batches[1]!.packetSha256);
  assert.equal(diagnostic.firstFailure!.metric, "ssim");
  assert.equal(diagnostic.firstFailure!.frameIndex, state.stored.get(1)!.packet.samples[0]!.frameIndex);
  assert.equal(diagnostic.location!.documentHash, result.documentHash);
  assert.equal(diagnostic.location!.frameIndex, diagnostic.firstFailure!.frameIndex);
  assert.equal(diagnostic.location!.timeSeconds, Number((diagnostic.firstFailure!.frameIndex! / state.input.document.canvas.fps).toFixed(6)));
  const alteredLocation = structuredClone(result);
  alteredLocation.diagnostics!.batches[0]!.location!.documentHash = "e".repeat(64);
  assert.equal(eventBatchExecutionSummarySchema.safeParse(alteredLocation).success, false);
  assert.equal(diagnostic.failureCount, 3);
  assert.equal(metrics.observed.maxMismatchedPixelRatio, 0.01);
  assert.equal(metrics.observed.maxTemporalDriftFrames, state.input.parentContract.canvas.fps / 10);
  assert.equal(metrics.textParity.checkedRegionCount, metrics.textParity.expectedRegionCount);
  const resumed = await executeCompositionEventCheckpointBatches(state.input, state.adapters);
  assert.deepEqual(resumed.visualMetrics, metrics);
  assert.deepEqual(resumed.diagnostics, result.diagnostics);
  for (const failure of ["hash", "index", "count", "empty"] as const) {
    const changed = structuredClone(result);
    if (failure === "hash") changed.diagnostics!.batches[0]!.packetSha256 = "e".repeat(64);
    if (failure === "index") changed.diagnostics!.batches[0]!.batchIndex = 0;
    if (failure === "count") changed.diagnostics!.affectedBatchCount++;
    if (failure === "empty") {changed.diagnostics!.batches[0]!.failureCount = 0; delete changed.diagnostics!.batches[0]!.firstFailure;}
    assert.equal(eventBatchExecutionSummarySchema.safeParse(changed).success, false);
  }
});

test("deck regional summaries survive partition aggregation without granting global attestation", async () => {
  const state = fixture(), execution = await executeCompositionEventCheckpointBatches(state.input, state.adapters);
  const parts = execution.batches.slice(0, 2).map((batch) => structuredClone(batch.visualMetrics!));
  for (const part of parts) part.deckText = {policy: DECK_TEXT_PLAN_POLICY,
    scope: "DECK_SOURCE_TEXT_REGIONS_NOT_RENDER_FONT_ATTESTATION", status: "PASS",
    requiredCheckpointCount: part.requiredCheckpointCount, checkedCheckpointCount: part.checkedCheckpointCount,
    expectedRegionCount: 1, checkedRegionCount: 1};
  parts[1]!.deckText!.status = "FAIL";
  const combined = aggregateEventVisualMetrics(parts);
  assert.equal(combined.deckText?.status, "FAIL");
  assert.equal(combined.deckText?.expectedRegionCount, 2);
  assert.equal(combined.deckText?.requiredCheckpointCount, parts[0]!.requiredCheckpointCount + parts[1]!.requiredCheckpointCount);
  delete parts[1]!.deckText;
  assert.throws(() => aggregateEventVisualMetrics(parts), /POLICY_MISMATCH/);
  const forged = structuredClone(execution);
  forged.batches[0]!.visualMetrics!.deckText = parts[0]!.deckText;
  assert.equal(eventBatchExecutionSummarySchema.safeParse(forged).success, false);
});

test("event metric summaries reject forged totals, mixed coverage and policy mismatch without throwing", async () => {
  const state = fixture(), result = await executeCompositionEventCheckpointBatches(state.input, state.adapters);
  assert.ok(result.visualMetrics);
  for (const failure of ["aggregate", "missing-batch", "missing-total", "policy", "passing-bad-ssim", "region-bound",
    "thresholds", "bad-mae", "bad-pixels", "bad-time", "bad-psnr"] as const) {
    const changed = structuredClone(result);
    if (failure === "aggregate") changed.visualMetrics!.ssim.minimumObserved = 0.9;
    if (failure === "missing-batch") delete changed.batches[1]!.visualMetrics;
    if (failure === "missing-total") delete changed.visualMetrics;
    if (failure === "policy") changed.batches[1]!.visualMetrics!.ssim.minimumRequired = 0.5;
    if (failure === "passing-bad-ssim") changed.batches[1]!.visualMetrics!.ssim.minimumObserved = 0.9;
    const metrics = changed.batches[1]!.visualMetrics!;
    if (failure === "thresholds") metrics.thresholds.maxMeanAbsoluteError += 1;
    if (failure === "bad-mae") metrics.observed.maxMeanAbsoluteError = metrics.thresholds.maxMeanAbsoluteError + 0.1;
    if (failure === "bad-pixels") metrics.observed.maxMismatchedPixelRatio = metrics.thresholds.maxMismatchedPixelRatio + 0.001;
    if (failure === "bad-time") metrics.observed.maxTemporalDriftFrames = metrics.thresholds.maxTemporalDriftFrames + 0.1;
    if (failure === "bad-psnr") metrics.observed.minPsnrDb = metrics.thresholds.minPsnrDb - 0.1;
    if (failure === "region-bound") {
      changed.batches[1]!.visualMetrics!.textParity.status = "FAIL";
      changed.batches[1]!.visualMetrics!.textParity.expectedRegionCount = COMPOSITION_TEXT_PARITY_POLICY.maximumRegionsPerCapture + 1;
    }
    assert.equal(eventBatchExecutionSummarySchema.safeParse(changed).success, false);
  }
});

test("maximum event-plan metric report fits the bounded SQL summary and worker payload budgets", async () => {
  const state = fixture(), result = await executeCompositionEventCheckpointBatches(state.input, state.adapters);
  const first = result.batches[0]!;
  const batches = Array.from({length: COMPOSITION_EVENT_PLAN_MAX_BATCHES}, (_, batchIndex) => ({...structuredClone(first), batchIndex,
    packetSha256: batchIndex.toString(16).padStart(64, "0")}));
  const maximum = eventBatchExecutionSummarySchema.parse({...result, requiredBatchCount: batches.length, measuredBatchCount: batches.length,
    requiredCheckpointCount: COMPOSITION_EVENT_PLAN_MAX_CHECKPOINTS, measuredCheckpointCount: COMPOSITION_EVENT_PLAN_MAX_CHECKPOINTS,
    batches, visualMetrics: aggregateEventVisualMetrics(batches.map((batch) => batch.visualMetrics!))});
  // PostgreSQL jsonb text adds separators, unlike compact JSON.stringify. This
  // conservative separator allowance is not a claim of PostgreSQL execution.
  const failed = eventBatchExecutionSummarySchema.parse({...maximum, status: "FAIL",
    batches: maximum.batches.map((batch) => ({...batch, status: "FAIL"})), diagnostics: {
      scope: "FIRST_AFFECTED_PARTITIONS_NOT_COMPLETE_FAILURE_LIST", affectedBatchCount: batches.length,
      omittedBatchCount: batches.length - EVENT_DIAGNOSTIC_MAX_BATCHES,
      batches: batches.slice(0, EVENT_DIAGNOSTIC_MAX_BATCHES).map((batch) => ({batchIndex: batch.batchIndex,
        packetSha256: batch.packetSha256, failureCount: 1, firstFailure: {metric: "encoded_color_tags"}, incompleteReasons: []})),
    }});
  const encoded = JSON.stringify(failed).replace(/[:,]/g, "$& ");
  assert.ok(Buffer.byteLength(encoded, "utf8") < 768 * 1024);
  assert.ok(Buffer.byteLength(encoded, "utf8") + 64 * 1024 < 1024 * 1024);
});

test("persisted measurement adapter binds raw samples to the selected contract, private lineage and MP4 hash", async () => {
  for (const failure of [undefined, "video", "tenant", "lineage", "samples", "document", "contract"] as const) {
    const state = fixture(), prepared = prepareCompositionEventBatchContracts(state.input), selected = prepared.select(1);
    if (selected.contract.schemaVersion !== 4) throw new Error("Expected v4");
    const identity = eventBatchMeasurementIdentitySchema.parse({organizationId: state.input.organizationId,
      revisionId: state.input.revisionId, projectHash: state.input.projectHash, videoSha256: state.input.videoSha256,
      documentHash: prepared.documentHash, parentContractSha256: prepared.parentContractSha256,
      batchContractSha256: selected.batchContractSha256, batch: selected.contract.checkpointBatch});
    const packet = await state.adapters.measureBatch({identity, contract: selected.contract}) as EventBatchMeasurementPacket;
    const lineage = {policy: "VERIFIED_ROOT_EVENT_PARTITION_V1", scope: "ONE_PREVIEW_PARTITION_NOT_GLOBAL_RENDER_ATTESTATION",
      parentContractSha256: identity.parentContractSha256, batchContractSha256: identity.batchContractSha256, batch: identity.batch};
    const result = {reference: {organizationId: identity.organizationId, revisionId: identity.revisionId,
      projectHash: identity.projectHash, documentHash: identity.documentHash, checksum: "c".repeat(64), eventBatchLineage: lineage},
      report: {documentHash: identity.documentHash, video: {sha256: identity.videoSha256},
        visualMeasurements: {previewDocumentHash: packet.previewDocumentHash, renderDocumentHash: packet.renderDocumentHash, samples: packet.samples}}};
    if (failure === "video") result.report.video.sha256 = "e".repeat(64);
    if (failure === "tenant") result.reference.organizationId = "80000000-0000-4000-8000-000000000001";
    if (failure === "lineage") result.reference.eventBatchLineage.parentContractSha256 = "e".repeat(64);
    if (failure === "samples") (result.report as {visualMeasurements?: unknown}).visualMeasurements = undefined;
    if (failure === "document") result.report.visualMeasurements.renderDocumentHash = "e".repeat(64);
    if (failure === "contract") selected.contract.checkpoints[0]!.reasons.push("changed");
    let comparisons = 0;
    const compare: NonNullable<Parameters<typeof measureCompositionEventBatchWithPersistedReference>[1]> = async (params) => {
      comparisons++; assert.equal(params.eventBatchIndex, 1); assert.equal(params.includeVisualMeasurements, true);
      assert.equal(params.organizationId, identity.organizationId);
      return result as unknown as Awaited<ReturnType<typeof compare>>;
    };
    const execute = () => measureCompositionEventBatchWithPersistedReference({identity, contract: selected.contract,
      comparison: {supabase: {} as never, checksum: "c".repeat(64), videoPath: "integrity-bound-video",
        renderReceiptPath: "integrity-receipt", outputParentDirectory: "owned-directory"}}, compare);
    if (failure) {
      await assert.rejects(execute(), /CONFORMANCE_EVENT_MEASUREMENT_/);
      assert.equal(comparisons, failure === "contract" ? 0 : 1);
    } else assert.deepEqual((await execute()).samples, packet.samples);
  }
});

test("interruption preserves earlier partitions and restart measures only the missing ones", async () => {
  const state = fixture(), measure = state.adapters.measureBatch;
  state.adapters.measureBatch = async (params) => {
    if (params.identity.batch.batchIndex === 1) throw new Error("controlled interruption");
    return measure(params);
  };
  await assert.rejects(executeCompositionEventCheckpointBatches(state.input, state.adapters), /controlled interruption/);
  assert.equal(state.stored.size, 1);
  state.adapters.measureBatch = measure;
  const result = await executeCompositionEventCheckpointBatches(state.input, state.adapters);
  assert.equal(result.resumedBatchCount, 1); assert.equal(result.status, "PASS");
  assert.equal(state.measured.filter((index) => index === 0).length, 1);
});

test("composed adapters capture, measure, persist and resume every partition in exact scope", async () => {
  const state = fixture(), prepared = prepareCompositionEventBatchContracts(state.input), root = prepared.select(0).contract;
  if (root.schemaVersion !== 4) throw new Error("Expected v4");
  const rootIdentity = eventBatchMeasurementIdentitySchema.parse({organizationId: state.input.organizationId,
    revisionId: state.input.revisionId, projectHash: state.input.projectHash, videoSha256: state.input.videoSha256,
    documentHash: prepared.documentHash, parentContractSha256: prepared.parentContractSha256,
    batchContractSha256: prepared.parentContractSha256, batch: root.checkpointBatch});
  const captured: number[] = [];
  const dependencies = {
    prepareVisual: async (params) => {
      captured.push(params.eventBatchIndex!);
      return {organizationId: params.organizationId, revisionId: params.revisionId,
        projectHash: state.input.projectHash, documentHash: prepared.documentHash, checksum: "c".repeat(64)} as never;
    },
    measure: async (params) => state.adapters.measureBatch(params) as Promise<EventBatchMeasurementPacket>,
    readPacket: async (params) => state.adapters.readBatch(params.identity as never) as never,
    persistPacket: async (params) => {
      assert.equal(params.visualChecksum, "c".repeat(64));
      await state.adapters.persistBatch(params.packet as EventBatchMeasurementPacket); return {packetSha256: hashEventBatchMeasurementPacket(params.packet)};
    },
  } satisfies NonNullable<Parameters<typeof createPersistedCompositionEventBatchAdapters>[1]>;
  const params = {supabase: {} as never, supabaseUrl: "https://controlled.supabase.co", rootIdentity,
    outputParentDirectory: "owned-directory", videoPath: "bound-video", renderReceiptPath: "bound-receipt"};
  const adapters = createPersistedCompositionEventBatchAdapters(params, dependencies);
  const first = await executeCompositionEventCheckpointBatches(state.input, adapters);
  assert.equal(first.status, "PASS"); assert.equal(captured.length, prepared.batchCount);
  const resumed = await executeCompositionEventCheckpointBatches(state.input, createPersistedCompositionEventBatchAdapters(params, dependencies));
  assert.equal(resumed.resumedBatchCount, prepared.batchCount); assert.equal(captured.length, prepared.batchCount);
  const selected = prepared.select(1).contract;
  const identity = {...rootIdentity, batchContractSha256: prepared.select(1).batchContractSha256, batch: {...rootIdentity.batch, batchIndex: 1}};
  await assert.rejects(adapters.measureBatch({identity: {...identity, videoSha256: "e".repeat(64)}, contract: selected}), /SCOPE_MISMATCH/);
  const packet = [...state.stored.values()][0]!.packet;
  await assert.rejects(createPersistedCompositionEventBatchAdapters(params, dependencies).persistBatch(packet), /MEASUREMENT_REQUIRED/);
  assert.equal(captured.length, prepared.batchCount);
  const changedContract = structuredClone(selected);
  changedContract.checkpoints[0]!.reasons.push("changed");
  await assert.rejects(adapters.measureBatch({identity, contract: changedContract}), /CONTRACT_MISMATCH/);
  assert.equal(captured.length, prepared.batchCount);
  const controller = new AbortController(), prepareVisual = dependencies.prepareVisual;
  const cancelling = createPersistedCompositionEventBatchAdapters({...params, signal: controller.signal}, {...dependencies,
    prepareVisual: async (input) => {const visual = await prepareVisual(input); controller.abort("private reason"); return visual;}});
  const measuredBefore = state.measured.length;
  await assert.rejects(cancelling.measureBatch({identity, contract: selected}), /^Error: CONFORMANCE_EVENT_EXECUTION_ABORTED$/);
  assert.equal(state.measured.length, measuredBefore);
});

test("authorized event entrypoint binds snapshot source, executes all batches and cleans source on success or failure", async () => {
  for (const failure of [undefined, "source", "authorization", "execution"] as const) {
    const state = fixture(); let cleanup = 0, executions = 0;
    const manifest = {conformance_contract: state.input.parentContract,
      conformance_event_batch_authorization: buildCompositionEventBatchAuthorization(state.input)};
    if (failure === "authorization") manifest.conformance_event_batch_authorization.batchContractSha256[1] = "e".repeat(64);
    const supabase = {from() {return {select() {return this;}, eq() {return this;}, async maybeSingle() {
      return {error: null, data: {id: state.input.revisionId, organization_id: state.input.organizationId,
        project_hash: state.input.projectHash, manifest}};
    }};}};
    const dependencies = {
      materialize: async () => ({directory: "controlled-source", receipt: {projectHash: state.input.projectHash,
        documentHash: failure === "source" ? "e".repeat(64) : state.input.parentContract.documentHash},
        cleanup: async () => {cleanup++;}}) as never,
      readSource: async () => ({document: state.input.document, contract: state.input.parentContract}) as never,
      createAdapters: () => state.adapters,
      execute: async (params, adapters) => {executions++; if (failure === "execution") throw new Error("controlled execution");
        return executeCompositionEventCheckpointBatches(params, adapters);},
    } satisfies NonNullable<Parameters<typeof executePersistedCompositionEventBatches>[1]>;
    const execute = () => executePersistedCompositionEventBatches({supabase: supabase as never, supabaseUrl: "https://controlled.supabase.co",
      organizationId: state.input.organizationId, revisionId: state.input.revisionId, projectHash: state.input.projectHash,
      documentHash: state.input.parentContract.documentHash, videoSha256: state.input.videoSha256,
      outputParentDirectory: "owned-directory", videoPath: "bound-video", renderReceiptPath: "receipt"}, dependencies);
    if (failure) await assert.rejects(execute()); else assert.equal((await execute())?.status, "PASS");
    assert.equal(cleanup, 1); assert.equal(executions, failure === "source" || failure === "authorization" ? 0 : 1);
  }
});

test("missing or bad samples cannot become aggregate PASS even when the other partitions pass", async () => {
  for (const failure of ["missing", "pixels"] as const) {
    const state = fixture(), measure = state.adapters.measureBatch;
    state.adapters.measureBatch = async (params) => {
      const packet = await measure(params) as EventBatchMeasurementPacket;
      if (params.identity.batch.batchIndex === 1) {
        if (failure === "missing") packet.samples.pop(); else packet.samples[0]!.meanAbsoluteError = 10;
      }
      return packet;
    };
    const result = await executeCompositionEventCheckpointBatches(state.input, state.adapters);
    assert.equal(result.status, failure === "missing" ? "INCOMPLETE" : "FAIL");
    assert.equal(result.measuredBatchCount, result.requiredBatchCount);
    assert.equal((await executeCompositionEventCheckpointBatches(state.input, state.adapters)).status, result.status);
  }
});

test("foreign scope, wrong plan and altered persistence readback fail closed", async () => {
  for (const failure of ["scope", "plan", "readback"] as const) {
    const state = fixture(), measure = state.adapters.measureBatch, persist = state.adapters.persistBatch;
    if (failure === "readback") state.adapters.persistBatch = async (packet) => {
      packet.samples[0]!.meanAbsoluteError = 20; await persist(packet);
    };
    else state.adapters.measureBatch = async (params) => {
      const packet = await measure(params) as EventBatchMeasurementPacket;
      if (failure === "scope") packet.identity.organizationId = "80000000-0000-4000-8000-000000000001";
      else packet.identity.batch.planSha256 = "e".repeat(64);
      return packet;
    };
    await assert.rejects(executeCompositionEventCheckpointBatches(state.input, state.adapters), /IDENTITY_MISMATCH|READBACK_MISMATCH/);
  }
});

test("adapters cannot mutate frozen evaluation contracts or execution scope to bypass missing color evidence", async () => {
  const state = fixture(true), measure = state.adapters.measureBatch;
  const originalOrganizationId = state.input.organizationId;
  state.adapters.measureBatch = async (params) => {
    if (params.contract.schemaVersion === 4) delete params.contract.colorTagPolicy;
    state.input.organizationId = "80000000-0000-4000-8000-000000000001";
    return measure(params);
  };
  const result = await executeCompositionEventCheckpointBatches(state.input, state.adapters);
  assert.equal(result.status, "INCOMPLETE"); assert.equal(result.organizationId, originalOrganizationId);
  assert.ok([...state.stored.values()].every((stored) => stored.packet.identity.organizationId === originalOrganizationId));
});

test("invalid or changed parent fails before any external adapter call", async () => {
  for (const failure of ["document", "plan", "scope"] as const) {
    const state = fixture(); let reads = 0;
    state.adapters.readBatch = async () => {reads++; return null;};
    if (failure === "document") state.input.document.canvas.width += 1;
    else if (failure === "scope") state.input.organizationId = "invalid";
    else {
      if (state.input.parentContract.schemaVersion !== 4 || !state.input.parentContract.checkpointBatch) throw new Error("Expected batch");
      state.input.parentContract.checkpointBatch.planSha256 = "e".repeat(64);
    }
    await assert.rejects(executeCompositionEventCheckpointBatches(state.input, state.adapters));
    assert.equal(reads, 0);
  }
});

test("resumption verifies the recorded packet checksum before trusting stored samples", async () => {
  const state = fixture();
  await executeCompositionEventCheckpointBatches(state.input, state.adapters);
  const stored = state.stored.get(0)!;
  stored.packet.samples[0]!.meanAbsoluteError = 20;
  const measuredBefore = state.measured.length;
  await assert.rejects(executeCompositionEventCheckpointBatches(state.input, state.adapters), /PACKET_CHECKSUM_MISMATCH/);
  assert.equal(state.measured.length, measuredBefore);
});

test("cancellation after measurement prevents persistence and does not expose the cancellation reason", async () => {
  const state = fixture(), controller = new AbortController(), measure = state.adapters.measureBatch;
  state.adapters.measureBatch = async (params) => {
    const packet = await measure(params); controller.abort("private cancellation reason"); return packet;
  };
  await assert.rejects(executeCompositionEventCheckpointBatches({...state.input, signal: controller.signal}, state.adapters),
    /^Error: CONFORMANCE_EVENT_EXECUTION_ABORTED$/);
  assert.equal(state.stored.size, 0); assert.equal(state.measured.length, 1);
});
