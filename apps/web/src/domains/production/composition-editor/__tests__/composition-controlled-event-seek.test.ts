import assert from "node:assert/strict";
import test from "node:test";
import {createHash, generateKeyPairSync} from "node:crypto";
import {join} from "node:path";
import {mkdtemp, writeFile, unlink, rmdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import sharp from "sharp";
import {buildNativeConformanceCorpusCase} from "../qa/composition-native-conformance-corpus";
import {buildCompositionEventCheckpointPlan} from "../composition-conformance-event-checkpoints";
import {buildSnapshotConformanceContract} from "../composition-snapshot-conformance-contract";
import {hashCompositionDocument} from "../composition-document.service";
import {measureControlledEventSeekRepeatability} from "../qa/composition-controlled-seek-repeatability";
import {buildControlledComparisonArtifacts} from "../qa/composition-controlled-comparison-artifacts";
import {controlledRenderExecutionContractSchema, evaluateControlledRenderExecution} from "../composition-render-execution-contract";
import {evaluateCompositionConformance} from "../composition-preview-render-conformance";
import {measureControlledConformanceReferences} from "../qa/composition-controlled-reference-measurement";
import {pinConformanceFile} from "../qa/composition-conformance-file-integrity";
import {bindControlledReferenceSelection, createControlledReferenceSelectionResolver} from "../qa/composition-controlled-reference-selection";
import {buildControlledEventComparisonArtifacts} from "../qa/composition-controlled-event-comparison-artifacts";
import {buildSupervisedEventComparisonArtifacts} from "../qa/composition-supervised-comparison-artifacts";
import {signRenderSupervisorReceipt} from "../qa/composition-render-supervisor-signature";
import {RENDER_SUPERVISOR_RECEIPT_POLICY} from "../composition-render-supervisor-receipt";
import {startOriginalSessionEventNativeCapture} from "../qa/composition-original-session-event-native-capture";
import {bindControlledEventNativeEvidence, attachOriginalNativeEventComparison} from "../qa/composition-controlled-event-native-binding";
import {COMPOSITION_TEXT_PARITY_POLICY} from "../composition-text-parity-policy";
import {createOriginalSessionSeekCapture} from "../qa/composition-original-session-seek-capture";
import {bindControlledSeekRepeatability, attachControlledOriginalSeekReport} from "../qa/composition-controlled-seek-binding";

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

async function eventNativeFixture(drift = false) {
  const state = fixture(), frames = state.plan.batches.flat(), reads: number[] = [], reverse: number[] = [];
  const plans = state.contracts.flatMap(contract => contract.schemaVersion === 4 ? contract.textParity.checkpoints : []);
  const capture = await startOriginalSessionEventNativeCapture({document: state.document, contract: state.contracts[0], fonts: [],
    cdp: {send: async () => ({}), on() {}, off() {}}, serverUrl: "http://127.0.0.1:1234",
    signal: new AbortController().signal, verifyFiles: async () => {},
  }, {captureCheckpoint: async (_client, _document, seconds) => {
    const plan = plans.find(point => point.timeSeconds === seconds)!;
    reads.push(plan.frameIndex);
    return {...plan, policy: COMPOSITION_TEXT_PARITY_POLICY.id, status: "CAPTURED", unavailable: [],
      regions: plan.expectedTexts.map(expected => ({elementId: expected.elementId, textSha256: expected.textSha256,
        ...(expected.visibility ? {visibility: expected.visibility} : {}), left: 0, top: 0,
        width: drift && reads.length > frames.length ? 2 : 1, height: 1}))};
  }});
  const forward = async () => {
    for (const point of frames) await capture.captureFrame(point.frameIndex,
      Math.round(point.timeSeconds * state.document.canvas.fps) / state.document.canvas.fps);
  };
  const repeat = () => capture.repeatAtLastCheckpoint(frames.at(-1)!.frameIndex, async (index, seconds) => {
    reverse.push(index); return {quantizedTime: Math.round(seconds * state.document.canvas.fps) / state.document.canvas.fps};
  });
  return {...state, capture, frames, reads, reverse, forward, repeat};
}

test("original incremental screenshots produce bound RGBA reports for every event partition", async () => {
  const state = fixture(), png = await image(), repeatedPng = await sharp(png).png({compressionLevel: 9}).toBuffer();
  const capture = createOriginalSessionSeekCapture({document: state.document, contract: state.contracts[0],
    signal: new AbortController().signal, verifyFiles: async () => {}});
  assert.throws(() => capture.finalize(), /INCOMPLETE/);
  const reversed: number[] = [];
  for (const point of state.plan.batches.flat()) await capture.captureFrame(point.frameIndex, point.timeSeconds, png,
    async (index, seconds) => {reversed.push(index); return {quantizedTime: seconds, buffer: repeatedPng};});
  assert.deepEqual(reversed, state.plan.batches.flat().map(point => point.frameIndex).reverse());
  const measured = capture.finalize();
  assert.equal(measured.eventSeekRepeatability?.length, state.contracts.length);
  measured.eventSeekRepeatability!.forEach((report, index) => {
    assert.deepEqual(bindControlledSeekRepeatability(state.contracts[index], report), report);
    assert.equal(report.byteCounts.forward, png.length * report.checkpointCount);
    assert.equal(report.byteCounts.reverse, repeatedPng.length * report.checkpointCount);
  });
  const first = measured.seekRepeatability;
  assert.deepEqual(attachControlledOriginalSeekReport(state.contracts[0], first, undefined), first);
  const conflicting = structuredClone(first); conflicting.samples[0].rgbaSha256 = "e".repeat(64);
  assert.throws(() => attachControlledOriginalSeekReport(state.contracts[0], first, conflicting), /CONFLICT/);
  assert.throws(() => attachControlledOriginalSeekReport(state.contracts[0], undefined, first), /REQUIRED/);
  measured.eventSeekRepeatability!.length = 0;
  assert.equal(capture.finalize().eventSeekRepeatability?.length, state.contracts.length);
});

test("original RGBA capture rejects drift, bad image and reverse timing without publishing partial success", async () => {
  const state = fixture(), png = await image(), changed = await image(200);
  for (const mode of ["pixel", "image", "time"]) {
    const capture = createOriginalSessionSeekCapture({document: state.document, contract: state.contracts[0],
      signal: new AbortController().signal, verifyFiles: async () => {}});
    const run = async () => {
      for (const point of state.plan.batches.flat()) await capture.captureFrame(point.frameIndex, point.timeSeconds, png,
        async (_index, seconds) => ({quantizedTime: mode === "time" ? seconds + 1 : seconds,
          buffer: mode === "pixel" ? changed : mode === "image" ? Buffer.from("invalid PNG") : png}));
    };
    await assert.rejects(run(), /ORIGINAL_SEEK_CAPTURE_FAILED/);
    assert.throws(() => capture.finalize(), /ORIGINAL_SEEK_CAPTURE_FAILED/);
  }
});

test("original RGBA capture rejects omitted checkpoints, file drift and cancellation", async () => {
  const state = fixture(), png = await image();
  for (const mode of ["missing", "files", "abort"]) {
    const controller = new AbortController();
    const capture = createOriginalSessionSeekCapture({document: state.document, contract: state.contracts[0],
      signal: controller.signal, verifyFiles: async () => {if (mode === "files") throw new Error("private path");}});
    if (mode === "abort") controller.abort();
    const point = state.plan.batches.flat()[mode === "missing" ? 1 : 0];
    await assert.rejects(capture.captureFrame(point.frameIndex, point.timeSeconds, png,
      async (_index, seconds) => ({quantizedTime: seconds, buffer: png})), /ORIGINAL_SEEK_CAPTURE_FAILED/);
    assert.throws(() => capture.finalize());
  }
});

test("original event native capture performs one global forward/reverse sweep with distinct frozen child evidence", async () => {
  const state = await eventNativeFixture();
  assert.throws(() => state.capture.finalizeEvents(), /INCOMPLETE/);
  await state.forward(); await state.repeat();
  const indexes = state.frames.map(point => point.frameIndex);
  assert.deepEqual(state.reads, [...indexes, ...indexes.slice().reverse()]);
  assert.deepEqual(state.reverse, indexes.slice().reverse());
  const evidence = state.capture.finalizeEvents();
  assert.equal(evidence.batches.length, state.contracts.length);
  assert.ok(evidence.batches.length > 1);
  const bound = bindControlledEventNativeEvidence({document: state.document, parentContract: state.contracts[0],
    videoSha256: "b".repeat(64), evidence});
  assert.deepEqual(bound.batches[0].nativeEvidence, state.capture.finalize());
  const comparison = await comparisonFixture();
  const artifacts = attachOriginalNativeEventComparison({expectedDocument: state.document, expectedContract: state.contracts[0],
    artifacts: {kind: "EVENT_BATCH_SET", input: comparison}, originalNative: {
      documentHash: hashCompositionDocument(state.document), video: {sha256: comparison.videoSha256}, eventNativeEvidence: evidence,
      eventSeekRepeatability: comparison.batches.map(batch => batch.seekRepeatability)}});
  const built = buildControlledEventComparisonArtifacts(artifacts.input);
  assert.deepEqual(built.artifacts.map(artifact => artifact.receipt.nativeEvidence), bound.batches.map(batch => batch.nativeEvidence));
  const tools = join(process.cwd(), "apps/web/tools/controlled-hyperframes");
  const {validateOriginalNativeReceipt} = await import(join(tools, "original-native-receipt.mjs"));
  const {MATERIALIZED_MEASUREMENT_REQUEST_POLICY, materializedExecutionDigest, materializedProducerRequestDigest} =
    await import(join(tools, "materialized-producer-request.mjs"));
  const request = {policy: MATERIALIZED_MEASUREMENT_REQUEST_POLICY,
    executionId: "00000000-0000-4000-8000-000000000001", organizationId: "00000000-0000-4000-8000-000000000002",
    revisionId: "00000000-0000-4000-8000-000000000003", documentHash: hashCompositionDocument(state.document), projectHash: "c".repeat(64),
    directory: join(process.cwd(), "fixture-input"), outputParentDirectory: join(process.cwd(), "fixture-output"),
    browserPath: join(process.cwd(), "browser.exe"), encoderPath: join(process.cwd(), "encoder.exe"), probePath: join(process.cwd(), "probe.exe"),
    fps: state.document.canvas.fps, renderExecutionSha256: materializedExecutionDigest(state.renderExecution),
    measurementPlanSha256: "d".repeat(64), measurementPlanSizeBytes: 10};
  const videoPin = {sha256: comparison.videoSha256, sizeBytes: 42};
  const receipt = {version: 1, scope: "CANDIDATE_ORIGINAL_NATIVE_NOT_SUPERVISOR_ARTIFACT",
    requestSha256: materializedProducerRequestDigest(request), measurementPlanSha256: request.measurementPlanSha256,
    documentHash: request.documentHash, projectHash: request.projectHash, executionId: request.executionId,
    video: videoPin, nativeEvidence: state.capture.finalize(), eventNativeEvidence: evidence, renderExecutionObservation: comparison.observation,
    seekRepeatability: comparison.batches[0].seekRepeatability, eventSeekRepeatability: comparison.batches.map(batch => batch.seekRepeatability)};
  const context = {request, videoPin, document: state.document, contract: state.contracts[0]};
  assert.deepEqual(validateOriginalNativeReceipt(receipt, context).eventNativeEvidence, bound);
  assert.throws(() => validateOriginalNativeReceipt({...receipt, eventNativeEvidence: undefined}, context));
  assert.throws(() => validateOriginalNativeReceipt({...receipt, seekRepeatability: undefined}, context));
  assert.throws(() => validateOriginalNativeReceipt({...receipt, eventSeekRepeatability: receipt.eventSeekRepeatability.slice(1)}, context));
  assert.throws(() => validateOriginalNativeReceipt({...receipt, eventSeekRepeatability: receipt.eventSeekRepeatability.slice().reverse()}, context));
  assert.throws(() => validateOriginalNativeReceipt(receipt, {...context, document: undefined}));
  evidence.batches.length = 0;
  assert.equal(state.capture.finalizeEvents().batches.length, state.contracts.length);
  state.capture.close();
});

test("original event native binding rejects omissions, reordered partitions and relabeled parent text", async () => {
  const state = await eventNativeFixture(); await state.forward(); await state.repeat();
  const evidence = state.capture.finalizeEvents();
  const bind = (changed: unknown) => bindControlledEventNativeEvidence({document: state.document,
    parentContract: state.contracts[0], videoSha256: "b".repeat(64), evidence: changed});
  assert.throws(() => bind({...evidence, batches: evidence.batches.slice(1)}), /COVERAGE_INVALID/);
  assert.throws(() => bind({...evidence, batches: evidence.batches.slice().reverse()}), /CONTRACT_INVALID/);
  assert.throws(() => bind({...evidence, planSha256: "e".repeat(64)}), /COVERAGE_INVALID/);
  const relabeled = structuredClone(evidence);
  relabeled.batches[1].nativeEvidence = structuredClone(relabeled.batches[0].nativeEvidence);
  assert.throws(() => bind(relabeled), /CHECKPOINT_MISMATCH/);
  state.capture.close();
});

test("event native reverse drift invalidates every partition and prevents partial finalization", async () => {
  const state = await eventNativeFixture(true); await state.forward();
  await assert.rejects(state.repeat(), /EVENT_NATIVE_REPEAT_FAILED/);
  assert.throws(() => state.capture.finalize(), /EVENT_NATIVE_REPEAT_FAILED/);
  assert.throws(() => state.capture.finalizeEvents(), /EVENT_NATIVE_REPEAT_FAILED/);
  state.capture.close();
});
async function comparisonFixture() {
  const {document, contracts, renderExecution} = fixture(), png = await image();
  const reports = await measureControlledEventSeekRepeatability({document, contracts, capture: async () => png});
  return {document, parentContract: contracts[0], videoSha256: "b".repeat(64),
    observation: {policy: renderExecution.policy, documentHash: hashCompositionDocument(document), videoSha256: "b".repeat(64),
      files: renderExecution.files, browserBefore: renderExecution.expectedBrowser, browserAfter: renderExecution.expectedBrowser},
    batches: contracts.map((contract, index) => ({contract, seekRepeatability: reports[index]}))};
}

test("reference reservation and measurement consume every derived event partition in order", async () => {
  const input = await comparisonFixture();
  const directory = await mkdtemp(join(tmpdir(), "controlled-event-reference-test-"));
  const videoPath = join(directory, "candidate.mp4"), referencePath = join(directory, "reference.json");
  await writeFile(videoPath, "non-media event measurement fixture"); await writeFile(referencePath, "reference fixture");
  try {
    const videoPin = await pinConformanceFile(videoPath, 1024);
    input.videoSha256 = videoPin.sha256; input.observation.videoSha256 = videoPin.sha256;
    const parent = input.parentContract;
    if (parent.schemaVersion !== 4) throw new Error("Expected V4");
    const organizationId = "70000000-0000-4000-8000-000000000001", projectHash = "c".repeat(64);
    const descriptor = {organizationId, revisionId: organizationId, executionId: organizationId,
      documentHash: parent.documentHash, projectHash, contract: parent} as Parameters<typeof bindControlledReferenceSelection>[0];
    const digest = (value: string) => createHash("sha256").update(value).digest("hex");
    const references = input.batches.map((_batch, batchIndex) => ({batchIndex, visualChecksum: digest(`visual-${batchIndex}`),
      ...(parent.audio.required ? {audioChecksum: digest(`audio-${batchIndex}`)} : {})}));
    const selection = bindControlledReferenceSelection(descriptor, references);
    const resolveReferences = createControlledReferenceSelectionResolver([selection]);
    const readIndexes: number[] = [], compared: number[] = [];
    let cleanups = 0;
    const context = {organizationId, revisionId: organizationId, projectHash, documentHash: parent.documentHash};
    const dependencies = {
      readVisual: async (params: {eventBatchIndex?: number; checksum: string}) => {
        const index = params.eventBatchIndex!; readIndexes.push(index);
        assert.equal(params.checksum, references[index]!.visualChecksum);
        return {directory, contract: input.batches[index]!.contract, contractPath: referencePath,
          previewDirectory: directory, previewMetadataPath: referencePath, checksum: params.checksum,
          receipt: context, cleanup: async () => {cleanups++;}};
      },
      readAudio: async (params: {visualChecksum: string; checksum: string}) => {
        const index = references.findIndex(reference => reference.visualChecksum === params.visualChecksum);
        assert.equal(params.checksum, references[index]!.audioChecksum);
        return {directory, contract: input.batches[index]!.contract, checksum: params.checksum,
          audioReferencePath: referencePath, audioReferenceMetadataPath: referencePath,
          receipt: {...context, schemaVersion: 2, visualChecksum: params.visualChecksum}, cleanup: async () => {cleanups++;}};
      },
      compare: async () => {
        const index = compared.length; compared.push(index);
        const contract = input.batches[index]!.contract;
        if (contract.schemaVersion !== 4 || !contract.renderExecution) throw new Error("Expected V4");
        const visual = evaluateCompositionConformance({contract, previewDocumentHash: parent.documentHash,
          renderDocumentHash: parent.documentHash, samples: []});
        visual.renderExecution = evaluateControlledRenderExecution({expected: contract.renderExecution!,
          documentHash: parent.documentHash, videoSha256: videoPin.sha256, observation: input.observation});
        visual.seekRepeatability = input.batches[index]!.seekRepeatability;
        return {documentHash: parent.documentHash, video: {sha256: videoPin.sha256, sizeBytes: videoPin.sizeBytes},
          status: "INCOMPLETE", visual, audioTiming: {status: parent.audio.required ? "INCOMPLETE" : "NOT_REQUESTED"}};
      },
    } as unknown as NonNullable<Parameters<typeof measureControlledConformanceReferences>[1]>;
    const measured = await measureControlledConformanceReferences({descriptor,
      artifacts: {kind: "EVENT_BATCH_SET", input}, references: await resolveReferences(descriptor), supabase: {} as never,
      videoPath, videoPin, outputParentDirectory: directory, signal: new AbortController().signal,
      processPorts: {execute: async () => {}, consumePcm: async () => {}} as never}, dependencies);
    assert.ok(input.batches.length > 1);
    assert.deepEqual(readIndexes, references.map(reference => reference.batchIndex));
    assert.deepEqual(compared, readIndexes);
    assert.equal(measured.reports.length, input.batches.length); assert.equal(measured.status, "INCOMPLETE");
    assert.equal(cleanups, input.batches.length * (parent.audio.required ? 2 : 1));
    assert.throws(() => bindControlledReferenceSelection(descriptor, references.slice(1)), /COVERAGE_INVALID/);
  } finally {await unlink(videoPath); await unlink(referencePath); await rmdir(directory);}
});

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
