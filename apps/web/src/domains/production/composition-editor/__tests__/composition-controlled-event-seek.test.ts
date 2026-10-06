import assert from "node:assert/strict";
import test from "node:test";
import {createHash, generateKeyPairSync} from "node:crypto";
import sharp from "sharp";
import {buildNativeConformanceCorpusCase} from "../qa/composition-native-conformance-corpus";
import {buildCompositionEventCheckpointPlan} from "../composition-conformance-event-checkpoints";
import {buildSnapshotConformanceContract} from "../composition-snapshot-conformance-contract";
import {hashCompositionDocument} from "../composition-document.service";
import {measureControlledEventSeekRepeatability} from "../qa/composition-controlled-seek-repeatability";
import {buildControlledComparisonArtifacts} from "../qa/composition-controlled-comparison-artifacts";
import {controlledRenderExecutionContractSchema} from "../composition-render-execution-contract";
import {buildControlledEventComparisonArtifacts} from "../qa/composition-controlled-event-comparison-artifacts";
import {buildSupervisedEventComparisonArtifacts} from "../qa/composition-supervised-comparison-artifacts";
import {signRenderSupervisorReceipt} from "../qa/composition-render-supervisor-signature";
import {RENDER_SUPERVISOR_RECEIPT_POLICY} from "../composition-render-supervisor-receipt";

function fixture() {
  const {document} = buildNativeConformanceCorpusCase("captions-multi-batch", 25);
  document.canvas.width = 2; document.canvas.height = 2;
  const plan = buildCompositionEventCheckpointPlan(document);
  const renderExecution = controlledRenderExecutionContractSchema.parse({policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1",
    backend: "CONTROLLED", sdkVersion: "0.7.106", seekRepeatabilityPolicy: "EXACT_RGBA_FORWARD_REVERSE_V1",
    expectedBrowser: {protocolVersion: "1.3", product: "Chrome/test", revision: "test", userAgent: "test", jsVersion: "test"},
    files: Object.fromEntries(["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"]
      .map(role => [role, {sha256: "a".repeat(64), sizeBytes: 10}]))});
  const contracts = plan.batches.map((_points, eventBatchIndex) => buildSnapshotConformanceContract({document,
    documentHash: hashCompositionDocument(document), assets: [], contractVersion: 4, eventCheckpoints: true, eventBatchIndex,
    renderExecution,
    renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}}));
  return {document, plan, contracts, renderExecution};
}
const image = (red = 40) => sharp({create: {width: 2, height: 2, channels: 4,
  background: {r: red, g: 20, b: 10, alpha: 1}}}).png().toBuffer();
async function comparisonFixture() {
  const {document, contracts, renderExecution} = fixture(), png = await image();
  const reports = await measureControlledEventSeekRepeatability({document, contracts, capture: async () => png});
  return {document, parentContract: contracts[0], videoSha256: "b".repeat(64),
    observation: {policy: renderExecution.policy, documentHash: hashCompositionDocument(document), videoSha256: "b".repeat(64),
      files: renderExecution.files, browserBefore: renderExecution.expectedBrowser, browserAfter: renderExecution.expectedBrowser},
    batches: contracts.map((contract, index) => ({contract, seekRepeatability: reports[index]}))};
}

async function supervisedEventFixture() {
  const input = await comparisonFixture(), artifacts = buildControlledEventComparisonArtifacts(input);
  const identifier = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
  const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const {privateKey, publicKey} = generateKeyPairSync("ed25519");
  const expectedBinding = {organizationId: identifier(1), requestId: identifier(2), revisionId: identifier(3),
    productionJobId: identifier(4), executionId: identifier(5), attempt: 1, artifactKind: "EVENT_BATCH_SET" as const,
    challengeSha256: "a".repeat(64), documentHash: artifacts.coverage.documentHash, projectHash: "c".repeat(64),
    contractSha256: artifacts.coverage.parentContractSha256, observationSha256: digest(input.observation),
    comparisonReceiptSha256: digest({coverage: artifacts.coverage, receipts: artifacts.artifacts.map(artifact => artifact.receipt)}),
    videoSha256: input.videoSha256, sizeBytes: 40};
  const payload = {policy: RENDER_SUPERVISOR_RECEIPT_POLICY,
    scope: "SIGNED_ISSUER_AND_OUTPUT_BINDING_NOT_ISOLATION_OR_CONFORMANCE" as const,
    supervisorId: "supervisor_a", keyId: "key_a", binding: expectedBinding,
    issuedAtMilliseconds: 1000, expiresAtMilliseconds: 2000};
  return {...input, expectedBinding, nowMilliseconds: 1500,
    supervisorReceipt: signRenderSupervisorReceipt(payload, privateKey), trustedKeys: [{publicKey,
      supervisorId: payload.supervisorId, keyId: payload.keyId, organizationIds: [expectedBinding.organizationId],
      notBeforeMilliseconds: 0, notAfterMilliseconds: 10_000, revoked: false}]};
}

test("supervisor signature authenticates the entire ordered event set without promoting local conformance", async () => {
  const input = await supervisedEventFixture();
  const result = buildSupervisedEventComparisonArtifacts(input);
  assert.equal(result.provenance.status, "ISSUER_VERIFIED");
  assert.equal(result.artifacts.length, input.batches.length);
  assert.ok(result.artifacts.length > 1);
  assert.ok(result.artifacts.every(artifact => artifact.execution.reason === "RENDER_EXECUTION_ATTESTATION_PENDING"));
  assert.equal(result.coverage.scope, "COMPLETE_LOCAL_SDK_EVENT_RECEIPTS_NOT_PREVIEW_PARITY_OR_JOB_ATTESTATION");
});

test("signed event intake rejects later receipt mutation, coverage loss and a single-contract identity", async () => {
  const input = await supervisedEventFixture();
  const batches = structuredClone(input.batches);
  batches[1].seekRepeatability.samples[0].rgbaSha256 = "e".repeat(64);
  // A structurally valid but changed later sample must invalidate the signed set's identity.
  assert.throws(() => buildSupervisedEventComparisonArtifacts({...input, batches}), /COMPARISON_RECEIPT_MISMATCH/);
  assert.throws(() => buildSupervisedEventComparisonArtifacts({...input, batches: input.batches.slice(1)}), /COVERAGE_INVALID/);
  assert.throws(() => buildSupervisedEventComparisonArtifacts({...input,
    expectedBinding: {...input.expectedBinding, artifactKind: "SINGLE_CONTRACT"}}), /COMPARISON_BINDING_MISMATCH/);
});
test("complete artifact assembly derives ordered contract/receipt identities and clones caller evidence", async () => {
  const input = await comparisonFixture();
  const result = buildControlledEventComparisonArtifacts(input);
  assert.equal(result.coverage.checkpointCount, input.batches.reduce((count, batch) => count + batch.seekRepeatability.checkpointCount, 0));
  assert.equal(result.coverage.batchCount, input.batches.length);
  assert.equal(result.coverage.videoSha256, input.videoSha256);
  assert.equal(new Set(result.coverage.batchReceiptSha256).size, input.batches.length);
  assert.equal(result.coverage.scope, "COMPLETE_LOCAL_SDK_EVENT_RECEIPTS_NOT_PREVIEW_PARITY_OR_JOB_ATTESTATION");
  const hash = result.coverage.batchReceiptSha256[0];
  input.batches[0].seekRepeatability.samples[0].rgbaSha256 = "e".repeat(64);
  assert.equal(result.artifacts[0].receipt.seekRepeatability!.samples[0].rgbaSha256 === "e".repeat(64), false);
  assert.equal(result.coverage.batchReceiptSha256[0], hash);
});
test("the whole comparison rejects missing, duplicated, reordered or differently frozen child obligations", async () => {
  const input = await comparisonFixture();
  for (const batches of [input.batches.slice(1), input.batches.toReversed(),
    [...input.batches.slice(0, -1), input.batches[0]]])
    assert.throws(() => buildControlledEventComparisonArtifacts({...input, batches}));
  const changed = structuredClone(input);
  changed.batches[1].contract.thresholds.maxTemporalDriftFrames += 1;
  assert.throws(() => buildControlledEventComparisonArtifacts(changed), /CONTRACT_INVALID/);
  const omitted = structuredClone(input);
  delete (omitted.batches[1] as {seekRepeatability?: unknown}).seekRepeatability;
  assert.throws(() => buildControlledEventComparisonArtifacts(omitted), /SEEK_REQUIRED/);
});
test("foreign report identities or final video bindings cannot become a complete event receipt", async () => {
  const input = await comparisonFixture();
  const changed = structuredClone(input); changed.batches[1].seekRepeatability.contractSha256 = "e".repeat(64);
  assert.throws(() => buildControlledEventComparisonArtifacts(changed), /SEEK_BINDING_INVALID/);
  assert.throws(() => buildControlledEventComparisonArtifacts({...input, videoSha256: "e".repeat(64)}), /EXECUTION_MISMATCH/);
});
test("all event batches use one global forward then reverse sweep with independently bound reports", async () => {
  const {document, plan, contracts, renderExecution} = fixture(), png = await image();
  assert.ok(contracts.length > 1);
  const calls: number[] = [];
  const reports = await measureControlledEventSeekRepeatability({document, contracts, capture: async (batchIndex, frame) => {
    assert.ok(contracts[batchIndex].checkpoints.some(point => point.frameIndex === frame));
    calls.push(frame); return png;
  }});
  const points = plan.batches.flat().map(point => point.frameIndex);
  assert.deepEqual(calls, [...points, ...points.toReversed()]);
  assert.equal(reports.reduce((count, report) => count + report.checkpointCount, 0), plan.checkpointCount);
  for (const [index, report] of reports.entries()) {
    assert.equal(report.documentHash, contracts[index].documentHash);
    assert.equal(report.samples.length, contracts[index].checkpoints.length);
    const artifacts = buildControlledComparisonArtifacts({contract: contracts[index], seekRepeatability: report,
      documentHash: report.documentHash, videoSha256: "b".repeat(64), observation: {policy: renderExecution.policy,
        documentHash: report.documentHash, videoSha256: "b".repeat(64), files: renderExecution.files,
        browserBefore: renderExecution.expectedBrowser, browserAfter: renderExecution.expectedBrowser}});
    assert.deepEqual(artifacts.receipt.seekRepeatability, report);
  }
});
test("omitted, reordered, duplicated and foreign batch plans never start capturing", async () => {
  const {document, contracts} = fixture();
  const foreign = structuredClone(contracts); foreign[0].documentHash = "a".repeat(64);
  for (const invalid of [contracts.slice(1), contracts.toReversed(), [...contracts.slice(0, -1), contracts[0]], foreign]) {
    let calls = 0;
    await assert.rejects(measureControlledEventSeekRepeatability({document, contracts: invalid,
      capture: async () => {calls++; return image();}}));
    assert.equal(calls, 0);
  }
});
test("a mismatch in a later batch and late cancellation invalidate the entire sweep", async () => {
  const {document, contracts, plan} = fixture(), png = await image(), different = await image(41);
  let calls = 0;
  await assert.rejects(measureControlledEventSeekRepeatability({document, contracts, capture: async () =>
    ++calls === plan.checkpointCount + 1 ? different : png}), /REVERSE_MISMATCH/);
  const abort = new AbortController();
  await assert.rejects(measureControlledEventSeekRepeatability({document, contracts, signal: abort.signal,
    capture: async () => {abort.abort(); return png;}}), /SEEK_CANCELLED/);
});
