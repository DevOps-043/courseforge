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
import { eventBatchMeasurementIdentitySchema } from "../qa/composition-conformance-event-batch-execution";

function fixture(colorTags = false) {
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
    renderProfile: getHyperframesRenderProfile("balanced"), contractVersion: 4, eventCheckpoints: true, colorTags});
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
