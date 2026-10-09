import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {mkdtemp, writeFile, mkdir, rm, readdir} from "node:fs/promises";
import {startControlledFontCapture, controlledFontUsageEvidenceSchema, validateControlledFontUsageEvidence} from "../qa/composition-controlled-font-capture";
import {createInitialCompositionDocument} from "../composition-document.factory";
import {createCompositionNativeOverlay} from "../composition-native-overlay.factory";
import {NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT} from "../composition-document.types";
import {hashCompositionDocument} from "../composition-document.service";
import {buildSnapshotConformanceContract} from "../composition-snapshot-conformance-contract";
import {controlledRenderExecutionContractSchema} from "../composition-render-execution-contract";
import {conformanceFontPath} from "../composition-conformance-font-bindings";
import {COMPOSITION_TEXT_PARITY_POLICY} from "../composition-text-parity-policy";
import {TEXT_PARITY_REPEATABILITY} from "../qa/composition-text-parity-evidence";
import type {CompositionQaCdpClient} from "../qa/composition-qa-browser";
import {createFontUsageEvidenceFixture} from "./fixtures/composition-font-usage.fixture";
import {bindControlledRendererFontWitness, assertControlledFontWitnessMatchesContract} from "../qa/composition-controlled-font-witness";
import {buildControlledComparisonArtifacts} from "../qa/composition-controlled-comparison-artifacts";
import {bindControlledRendererNativeEvidence, attachOriginalNativeSingleComparison} from "../qa/composition-controlled-native-binding";
import {rendererFontUsagePendingSchema} from "../composition-font-usage-contract";
import {exportedVideoReceiptSchema} from "../qa/composition-exported-video-conformance";
import {bindControlledSeekRepeatability} from "../qa/composition-controlled-seek-binding";
import {startOriginalSessionFontCapture} from "../qa/composition-original-session-font-capture";
import {startOriginalSessionNativeCapture} from "../qa/composition-original-session-native-capture";
import type {captureTextParityCheckpoint} from "../qa/composition-text-checkpoint-capture";
import {evaluateCompositionConformance} from "../composition-preview-render-conformance";
import {assertConformanceReportMatchesContract} from "../qa/composition-conformance-contract-report-gate";

const font = {fontAssetId: "70000000-0000-4000-8000-000000000001", family: "Editorial", mimeType: "font/woff2" as const,
  checksumSha256: "a".repeat(64), fileSizeBytes: 8};
const origin = "http://127.0.0.1:1234";
const browser = {protocolVersion: "1.3", product: "test", revision: "test", userAgent: "test", jsVersion: "test"};

async function startNativeFixture(state: ReturnType<typeof fixture>, drift = false) {
  const removers = new Map<(params: Record<string, unknown>) => void, () => void>();
  let reads = 0;
  return startOriginalSessionNativeCapture({document: state.document, contract: state.contract, fonts: [font],
    signal: new AbortController().signal, serverUrl: origin, verifyFiles: async () => {}, cdp: {
      send: (method, params) => state.client.send(method, params),
      on(method, handler) {removers.set(handler, state.client.onEvent!(method, handler));},
      off(_method, handler) {removers.get(handler)?.(); removers.delete(handler);},
    }}, {captureCheckpoint: async (_client, _document, seconds) => {
      const point = structuredClone(state.text.checkpoints.find(point => point.timeSeconds === seconds)!);
      if (drift && ++reads > state.text.checkpoints.length && point.regions.length) point.regions[0].width++;
      return point as Awaited<ReturnType<typeof captureTextParityCheckpoint>>;
    }});
}

test("native orchestrator captures forward, prepares reverse and preserves unattested font scope", async () => {
  const state = fixture(), capture = await startNativeFixture(state), prepared: number[] = [];
  state.emit();
  for (const point of state.text.checkpoints) await capture.captureFrame(point.frameIndex,
    Math.round(point.timeSeconds * state.contract.canvas.fps) / state.contract.canvas.fps);
  assert.throws(() => capture.finalize(), /INCOMPLETE/);
  await capture.repeatAtLastCheckpoint(state.text.checkpoints.at(-1)!.frameIndex, async (index, seconds) => {
    prepared.push(index); return {quantizedTime: Math.round(seconds * state.contract.canvas.fps) / state.contract.canvas.fps};
  });
  assert.deepEqual(prepared, state.text.checkpoints.map(point => point.frameIndex).reverse());
  const evidence = capture.finalize();
  assert.equal(evidence.fontEvidence?.scope, "LOCAL_CDP_CUSTOM_NATIVE_GLYPHS_NOT_RENDERER_ATTESTATION");
  assert.deepEqual(evidence.textEvidence.checkpoints, state.text.checkpoints);
  assert.equal(state.subscribed(), false);
  evidence.textEvidence.checkpoints.length = 0;
  assert.equal(capture.finalize().textEvidence.checkpoints.length, state.text.checkpoints.length);
});

test("native orchestrator rejects geometry drift in reverse and cannot finalize after failure", async () => {
  const state = fixture(), capture = await startNativeFixture(state, true);
  state.emit();
  for (const point of state.text.checkpoints) await capture.captureFrame(point.frameIndex,
    Math.round(point.timeSeconds * state.contract.canvas.fps) / state.contract.canvas.fps);
  await assert.rejects(capture.repeatAtLastCheckpoint(state.text.checkpoints.at(-1)!.frameIndex,
    async (_index, seconds) => ({quantizedTime: Math.round(seconds * state.contract.canvas.fps) / state.contract.canvas.fps})), /REPEAT_FAILED/);
  assert.throws(() => capture.finalize(), /REPEAT_FAILED/);
  assert.equal(state.subscribed(), false);
});

test("native orchestrator rejects missing checkpoints and forward timing drift", async () => {
  for (const mode of ["missing", "time"]) {
    const state = fixture(), capture = await startNativeFixture(state);
    state.emit();
    const first = state.text.checkpoints[0];
    await assert.rejects(capture.captureFrame(mode === "missing" ? first.frameIndex + 1 : first.frameIndex,
      mode === "time" ? 99 : first.timeSeconds), /CAPTURE_FAILED/);
    assert.throws(() => capture.finalize(), /CAPTURE_FAILED/);
    assert.equal(state.subscribed(), false);
  }
});

test("fixed native observer uses the production geometry reader on its original borrowed CDP", async () => {
  const state = fixture(), removers = new Map<(params: Record<string, unknown>) => void, () => void>();
  state.contract.renderExecution!.seekRepeatabilityPolicy = "EXACT_RGBA_FORWARD_REVERSE_V1";
  const png = await sharp({create: {width: state.document.canvas.width, height: state.document.canvas.height,
    channels: 4, background: {r: 40, g: 20, b: 10, alpha: 1}}}).png().toBuffer();
  const reverseFrames: number[] = [];
  let geometryReads = 0;
  const textClip = state.document.clips.find(clip => clip.source.type === "NATIVE_TEXT")!;
  if (textClip.source.type !== "NATIVE_TEXT") throw new Error("fixture requires native text");
  const actualText = textClip.source.text;
  const cdp: Parameters<typeof startOriginalSessionNativeCapture>[0]["cdp"] = {
      async send(method, params) {
        const expression = String(params?.expression ?? "");
        if (method === "Runtime.evaluate" && expression.includes("function readTextParityDom")) {
          geometryReads++;
          const argumentsPrefix = expression.slice(expression.lastIndexOf(")(") + 2);
          const ids = JSON.parse(argumentsPrefix.match(/^\[[^\]]*\]/)![0]) as string[];
          return {result: {value: ids.map(elementId => ({elementId, text: actualText, left: 0, top: 0, width: 100, height: 20}))}};
        }
        return state.client.send(method, params);
      },
      on(method, handler) {removers.set(handler, state.client.onEvent!(method, handler));},
      off(_method, handler) {removers.get(handler)?.(); removers.delete(handler);},
    };
  const {createOriginalSessionNativeObserver} = await import(join(process.cwd(), "apps/web/tools/controlled-hyperframes/original-session-native-observer.mjs"));
  const capture = createOriginalSessionNativeObserver({plan: {document: state.document, contract: state.contract, fonts: [font]},
    assertUnchanged: async () => {}}, new AbortController().signal);
  const session = {serverUrl: origin};
  await capture.observer.onSession({session, cdp});
  state.emit();
  for (const point of state.text.checkpoints) {
    await capture.observer.onBeforeFrame({session, frameIndex: point.frameIndex,
      quantizedTime: Math.round(point.timeSeconds * state.contract.canvas.fps) / state.contract.canvas.fps});
    await capture.observer.onAfterFrame({session, frameIndex: point.frameIndex,
      quantizedTime: Math.round(point.timeSeconds * state.contract.canvas.fps) / state.contract.canvas.fps, buffer: png,
      prepareFrame: async (_index: number, seconds: number) => ({quantizedTime: Math.round(seconds * state.contract.canvas.fps) / state.contract.canvas.fps}),
      captureFrame: async (index: number, seconds: number) => {reverseFrames.push(index);
        return {quantizedTime: Math.round(seconds * state.contract.canvas.fps) / state.contract.canvas.fps, buffer: png};}});
  }
  assert.equal(geometryReads, 2 * state.text.checkpoints.length);
  assert.deepEqual(capture.finalize().textEvidence.checkpoints, state.text.checkpoints);
  assert.equal(state.subscribed(), false);
  assert.deepEqual(reverseFrames, state.contract.checkpoints.map(point => point.frameIndex).reverse());
  assert.deepEqual(bindControlledSeekRepeatability(state.contract, capture.finalizeSeek().seekRepeatability), capture.finalizeSeek().seekRepeatability);
  capture.close();
});

test("v3 collector independently validates original native witness and rechecks its bytes", async () => {
  const tools = join(process.cwd(), "apps/web/tools/controlled-hyperframes");
  const {collectMaterializedProducerCandidate} = await import(join(tools, "materialized-producer-collector.mjs"));
  const {materializedProducerRequestDigest, materializedExecutionDigest, MATERIALIZED_MEASUREMENT_REQUEST_POLICY} = await import(join(tools, "materialized-producer-request.mjs"));
  const {auditMaterializedProducerCapture} = await import(join(tools, "materialized-producer-capture-audit.mjs"));
  const state = fixture(), capture = await startNativeFixture(state);
  state.emit();
  for (const point of state.text.checkpoints) await capture.captureFrame(point.frameIndex,
    Math.round(point.timeSeconds * state.contract.canvas.fps) / state.contract.canvas.fps);
  await capture.repeatAtLastCheckpoint(state.text.checkpoints.at(-1)!.frameIndex,
    async (_index, seconds) => ({quantizedTime: Math.round(seconds * state.contract.canvas.fps) / state.contract.canvas.fps}));
  const root = await mkdtemp(join(tmpdir(), "cf-native-receipt-"));
  try {
    const request = {policy: MATERIALIZED_MEASUREMENT_REQUEST_POLICY,
      executionId: "00000000-0000-4000-8000-000000000001", organizationId: "00000000-0000-4000-8000-000000000002",
      revisionId: "00000000-0000-4000-8000-000000000003", documentHash: state.contract.documentHash, projectHash: "b".repeat(64),
      directory: join(root, "input"), outputParentDirectory: root, browserPath: join(root, "browser.exe"),
      encoderPath: join(root, "encoder.exe"), probePath: join(root, "probe.exe"), fps: state.contract.canvas.fps,
      renderExecutionSha256: materializedExecutionDigest(state.contract.renderExecution),
      measurementPlanSha256: "c".repeat(64), measurementPlanSizeBytes: 10};
    const directory = join(root, request.executionId), videoPath = join(directory, "video.mp4");
    await mkdir(directory);
    const video = Buffer.from("video fixture, not encoded media"); await writeFile(videoPath, video);
    const videoPin = {sha256: createHash("sha256").update(video).digest("hex"), sizeBytes: video.length};
    const requestSha256 = materializedProducerRequestDigest(request);
    await writeFile(join(directory, "candidate.json"), JSON.stringify({version: 1, scope: "CANDIDATE_VIDEO_NOT_CONFORMANCE", requestSha256,
      executionId: request.executionId, organizationId: request.organizationId, revisionId: request.revisionId,
      documentHash: request.documentHash, projectHash: request.projectHash,
      candidate: {policy: "MATERIALIZED_FULL_PRODUCER_SDR_V1", scope: "CANDIDATE_VIDEO_NOT_CONFORMANCE", videoPath,
        capture: auditMaterializedProducerCapture({forceScreenshot: true, captureMode: "screenshot", workerCount: 1,
          browserGpuMode: "software", hasHdrContent: false})}}));
    const expected = {contract: state.contract, execution: state.contract.renderExecution,
      frameCount: Math.ceil(state.contract.canvas.durationSeconds * state.contract.canvas.fps)};
    await writeFile(join(directory, "original-session.json"), JSON.stringify({version: 1, scope: "CANDIDATE_ORIGINAL_SESSION_NOT_SUPERVISOR_ARTIFACT",
      requestSha256, executionId: request.executionId, documentHash: request.documentHash, projectHash: request.projectHash, video: videoPin,
      observations: {policy: "ORIGINAL_SESSION_BROWSER_FRAME_DIGEST_V1", scope: "ORIGINAL_CDP_SELF_REPORTED_VERSION_AND_FRAME_DIGEST_NOT_CONFORMANCE",
        browserBefore: browser, browserAfter: browser, frameCount: expected.frameCount, frameDigestSha256: "d".repeat(64)}}));
    const signal = new AbortController().signal;
    await assert.rejects(collectMaterializedProducerCandidate(request, signal, expected), /CANDIDATE_INVALID/);
    const raw = {version: 1, scope: "CANDIDATE_ORIGINAL_NATIVE_NOT_SUPERVISOR_ARTIFACT", requestSha256,
      executionId: request.executionId, documentHash: request.documentHash, projectHash: request.projectHash,
      measurementPlanSha256: request.measurementPlanSha256, video: videoPin, nativeEvidence: capture.finalize(),
      renderExecutionObservation: {policy: state.contract.renderExecution!.policy, documentHash: request.documentHash,
        videoSha256: videoPin.sha256, files: state.contract.renderExecution!.files, browserBefore: browser, browserAfter: browser}};
    const nativePath = join(directory, "original-native.json");
    await writeFile(nativePath, JSON.stringify(raw));
    const candidate = await collectMaterializedProducerCandidate(request, signal, expected);
    assert.deepEqual(candidate.originalNative.nativeEvidence, raw.nativeEvidence);
    const tools = join(process.cwd(), "apps/web/tools/controlled-hyperframes");
    const {createMaterializedProducerBridgeConfiguration} = await import(join(tools, "materialized-producer-bridge-configuration.mjs"));
    const observation = {policy: state.contract.renderExecution!.policy, documentHash: request.documentHash,
      videoSha256: videoPin.sha256, files: state.contract.renderExecution!.files, browserBefore: browser, browserAfter: browser};
    let executionConflict = false;
    const bridge = createMaterializedProducerBridgeConfiguration({
      powerShellPath: join(root, "powershell.exe"), bridgeScriptPath: join(tools, "windows/owned-job-bridge.ps1"),
      outputParentDirectory: root, operatorConfiguration: {path: join(root, "operator.json"), sha256: "f".repeat(64)},
      dependencyInventory: {roots: {tools, runtime: root}, manifest: {
        roles: Object.fromEntries([["node", "node.exe"], ["browser", "browser.exe"], ["encoder", "encoder.exe"], ["decoder", "probe.exe"]]
          .map(([role, path]) => [role, {rootId: "runtime", path}])),
        files: [...(await readdir(tools)).map(path => ({rootId: "tools", path})),
          ...["windows/owned-job-bridge.ps1", "windows/OwnedRenderJob.cs", "windows/OwnedRenderAccess.cs", "windows/OwnedRenderAppContainer.cs"].map(path => ({rootId: "tools", path})),
          ...["node.exe", "browser.exe", "encoder.exe", "probe.exe", "powershell.exe", "operator.json"]
            .map(path => ({rootId: "runtime", path, ...(path === "operator.json" ? {sha256: "f".repeat(64)} : {})}))],
      }},
      measure: async (observed: {originalNative: typeof raw}) => {
        assert.deepEqual(observed.originalNative.nativeEvidence, raw.nativeEvidence);
        return {kind: "SINGLE_CONTRACT", input: {contract: state.contract,
          observation: executionConflict ? {...observation, files: {...observation.files, node: {...observation.files.node, sizeBytes: 99}}} : observation,
          documentHash: request.documentHash, videoSha256: videoPin.sha256}};
      },
    });
    // This collection path starts no binaries: media and browser evidence remain explicit fixtures.
    const bridged = await bridge.collectResult({...request, contract: state.contract}, {
      directory: request.directory, entryPath: join(request.directory, "index.html"), receipt: request,
      measurementPlanReference: {sha256: request.measurementPlanSha256, sizeBytes: request.measurementPlanSizeBytes},
    }, signal);
    assert.deepEqual(buildControlledComparisonArtifacts(bridged.artifacts.input).receipt.nativeEvidence, raw.nativeEvidence);
    assert.deepEqual(bridged.artifacts.input.observation, raw.renderExecutionObservation);
    executionConflict = true;
    await assert.rejects(bridge.collectResult({...request, contract: state.contract}, {
      directory: request.directory, entryPath: join(request.directory, "index.html"), receipt: request,
      measurementPlanReference: {sha256: request.measurementPlanSha256, sizeBytes: request.measurementPlanSizeBytes},
    }, signal), /ORIGINAL_EXECUTION_CONFLICT/);
    candidate.originalNative.nativeEvidence.textEvidence.checkpoints.length = 0;
    await candidate.assertUnchanged();
    for (const patch of [{measurementPlanSha256: "e".repeat(64)}, {video: {...videoPin, sha256: "e".repeat(64)}},
      {nativeEvidence: {...raw.nativeEvidence, fontEvidence: undefined}}, {scope: "PASS"}, {renderExecutionObservation: undefined},
      {renderExecutionObservation: {...raw.renderExecutionObservation, videoSha256: "e".repeat(64)}}]) {
      await writeFile(nativePath, JSON.stringify({...raw, ...patch}));
      await assert.rejects(collectMaterializedProducerCandidate(request, signal, expected), /CANDIDATE_INVALID/);
    }
    await assert.rejects(candidate.assertUnchanged(), /CONFORMANCE_FILE_INTEGRITY_MISMATCH/);
  } finally {await rm(root, {recursive: true, force: true});}
});

async function startBorrowedFontFixture(state: ReturnType<typeof fixture>) {
  const removers = new Map<(params: Record<string, unknown>) => void, () => void>();
  return startOriginalSessionFontCapture({document: state.document, contract: state.contract, fonts: [font],
    signal: new AbortController().signal, serverUrl: origin, verifyFiles: async () => {}, cdp: {
      send: (method, params) => state.client.send(method, params),
      on(method, handler) {removers.set(handler, state.client.onEvent!(method, handler));},
      off(_method, handler) {removers.get(handler)?.(); removers.delete(handler);},
    }});
}

test("original-session font factory delegates glyph capture/repeat/finalization without changing attestation scope", async () => {
  const state = fixture(), capture = await startBorrowedFontFixture(state);
  state.emit();
  for (const point of state.text.checkpoints) await capture.capture(point);
  for (const point of [...state.text.checkpoints].reverse()) await capture.verifyRepeat(point);
  const evidence = await capture.finish(state.text);
  assert.equal(evidence.scope, "LOCAL_CDP_CUSTOM_NATIVE_GLYPHS_NOT_RENDERER_ATTESTATION");
  assert.equal(evidence.checkpoints.length, state.text.checkpoints.length);
  assert.equal(state.subscribed(), false);
  capture.close();
});

test("original-session font factory rejects fallback and incomplete repeatability evidence, removing listeners", async () => {
  const fallback = fixture(), first = await startBorrowedFontFixture(fallback);
  fallback.emit(); fallback.fallback();
  await assert.rejects(first.capture(fallback.text.checkpoints[0]), /FONT_CAPTURE_FAILED/);
  assert.equal(fallback.subscribed(), false);
  const incomplete = fixture(), second = await startBorrowedFontFixture(incomplete);
  incomplete.emit();
  for (const point of incomplete.text.checkpoints) await second.capture(point);
  for (const point of [...incomplete.text.checkpoints].reverse()) await second.verifyRepeat(point);
  await assert.rejects(second.finish({...incomplete.text, repeatability: undefined}), /FONT_FINALIZATION_FAILED/);
  assert.equal(incomplete.subscribed(), false);
});

test("original-session font factory requires actual reverse verification calls, not a repeatability label", async () => {
  const state = fixture(), capture = await startBorrowedFontFixture(state);
  state.emit();
  for (const point of state.text.checkpoints) await capture.capture(point);
  await assert.rejects(capture.finish(state.text), /REPEAT_COVERAGE_INCOMPLETE/);
  assert.equal(state.subscribed(), false);
  const reversed = fixture(), second = await startBorrowedFontFixture(reversed);
  reversed.emit();
  for (const point of reversed.text.checkpoints) await second.capture(point);
  if (reversed.text.checkpoints.length > 1) {
    await assert.rejects(second.verifyRepeat(reversed.text.checkpoints[0]), /REPEAT_ORDER_INVALID/);
    assert.equal(reversed.subscribed(), false);
  } else second.close();
});
test("native geometry without custom fonts reaches comparison artifacts without fabricating a font witness", () => {
  const state = fixture(), contract = {...state.contract, fontUsageContract: undefined};
  const videoSha256 = "d".repeat(64);
  const nativeEvidence = {scope: "SDK_SESSION_NATIVE_TEXT_AND_CUSTOM_GLYPHS_NOT_PREVIEW_PARITY", textEvidence: state.text};
  const bound = bindControlledRendererNativeEvidence(contract, nativeEvidence, videoSha256)!;
  assert.equal(bound.fontWitness, undefined);
  const observation = {policy: contract.renderExecution!.policy, documentHash: contract.documentHash,
    videoSha256, files: contract.renderExecution!.files, browserBefore: browser, browserAfter: browser};
  const input = {contract, observation, documentHash: contract.documentHash, videoSha256};
  const artifacts = buildControlledComparisonArtifacts({...input, nativeEvidence});
  assert.deepEqual(artifacts.receipt.nativeEvidence?.textEvidence, state.text);
  assert.equal(artifacts.receipt.nativeEvidence?.fontEvidence, undefined);
  const attached = attachOriginalNativeSingleComparison({expectedContract: contract,
    artifacts: {kind: "SINGLE_CONTRACT", input},
    originalNative: {documentHash: contract.documentHash, video: {sha256: videoSha256}, nativeEvidence}});
  assert.deepEqual(buildControlledComparisonArtifacts(attached.input).receipt, artifacts.receipt);
  assert.equal(Object.hasOwn(input, "nativeEvidence"), false);
  for (const tampered of [
    {...nativeEvidence, textEvidence: {...state.text, checkpoints: state.text.checkpoints.slice(1)}},
    {...nativeEvidence, textEvidence: {...state.text, checkpoints: state.text.checkpoints.map(point => ({...point, timeSeconds: 99}))}},
    {...nativeEvidence, scope: "PREVIEW_PAINT"},
  ]) assert.throws(() => buildControlledComparisonArtifacts({...input, nativeEvidence: tampered}));
});

test("original native attachment rejects another video, another frozen contract and conflicting geometry", () => {
  const state = fixture(), contract = {...state.contract, fontUsageContract: undefined};
  const videoSha256 = "d".repeat(64);
  const nativeEvidence = {scope: "SDK_SESSION_NATIVE_TEXT_AND_CUSTOM_GLYPHS_NOT_PREVIEW_PARITY", textEvidence: state.text};
  const originalNative = {documentHash: contract.documentHash, video: {sha256: videoSha256}, nativeEvidence};
  const input = {contract, documentHash: contract.documentHash, videoSha256};
  for (const changed of [{...input, videoSha256: "e".repeat(64)},
    {...input, documentHash: "e".repeat(64)}, {...input, contract: {...contract, thresholds: {...contract.thresholds, maxTemporalDriftFrames: 2}}}])
    assert.throws(() => attachOriginalNativeSingleComparison({expectedContract: contract, originalNative,
      artifacts: {kind: "SINGLE_CONTRACT", input: changed}}), /BINDING_INVALID/);
  const other = structuredClone(nativeEvidence);
  other.textEvidence.checkpoints[0].regions[0].width++;
  assert.throws(() => attachOriginalNativeSingleComparison({expectedContract: contract, originalNative,
    artifacts: {kind: "SINGLE_CONTRACT", input: {...input, nativeEvidence: other}}}), /CONFLICT/);
  assert.throws(() => bindControlledRendererNativeEvidence(state.contract, nativeEvidence, videoSha256), /FONT_REQUIRED/);
});

test("native font receipt binds the comparator and durable summary without replacing pending attestation", async () => {
  const state = fixture(); const capture = await state.start(); state.emit();
  for (const point of state.text.checkpoints) await capture.capture(point);
  const fontEvidence = await capture.finish(state.text);
  const nativeEvidence = {scope: "SDK_SESSION_NATIVE_TEXT_AND_CUSTOM_GLYPHS_NOT_PREVIEW_PARITY",
    fontEvidence, textEvidence: state.text};
  const videoSha256 = "d".repeat(64);
  const bound = bindControlledRendererFontWitness(state.contract, nativeEvidence, videoSha256)!;
  assert.equal(bound.summary.status, "OBSERVED_UNATTESTED");
  const pending = rendererFontUsagePendingSchema.parse({policy: state.contract.fontUsageContract!.policy,
    scope: "RENDERER_GLYPH_PROVENANCE", status: "INCOMPLETE", reason: "RENDERER_FONT_USAGE_EVIDENCE_UNAVAILABLE",
    manifestSha256: fontEvidence.manifestSha256, requiredBindingCount: fontEvidence.bindings.length,
    observedWitness: bound.summary});
  assert.equal(pending.status, "INCOMPLETE");
  const observation = {policy: state.contract.renderExecution!.policy, documentHash: state.contract.documentHash,
    videoSha256, files: state.contract.renderExecution!.files, browserBefore: browser, browserAfter: browser};
  const input = {contract: state.contract, observation, documentHash: state.contract.documentHash, videoSha256};
  assert.throws(() => buildControlledComparisonArtifacts(input), /FONT_REQUIRED/);
  const artifacts = buildControlledComparisonArtifacts({...input, nativeEvidence});
  assert.deepEqual(artifacts.receipt.nativeEvidence, bound.nativeEvidence);
  const visual = evaluateCompositionConformance({contract: state.contract, previewDocumentHash: input.documentHash,
    renderDocumentHash: input.documentHash, samples: []});
  visual.renderExecution = artifacts.execution;
  visual.fontUsage = pending;
  assert.doesNotThrow(() => assertConformanceReportMatchesContract(state.contract, visual, {videoSha256}));
  assert.throws(() => assertConformanceReportMatchesContract(state.contract,
    {...visual, fontUsage: {...pending, observedWitness: {...bound.summary, contractSha256: "e".repeat(64)}}}, {videoSha256}), /BINDING_INVALID/);
  assert.throws(() => assertConformanceReportMatchesContract(state.contract,
    {...visual, incompletenessReasons: visual.incompletenessReasons?.filter(reason => reason !== "RENDERER_FONT_USAGE_UNAVAILABLE")}, {videoSha256}), /ATTESTATION_PENDING/);
  assert.equal(exportedVideoReceiptSchema.safeParse({documentHash: input.documentHash, videoSha256}).success, true);
  for (const field of ["documentHash", "contractSha256", "videoSha256", "manifestSha256"] as const)
    assert.throws(() => assertControlledFontWitnessMatchesContract(state.contract,
      {...bound.summary, [field]: "e".repeat(64)}, videoSha256), /BINDING_INVALID/);
  for (const field of ["checkpointCount", "bindingCount", "elementCount"] as const)
    assert.throws(() => assertControlledFontWitnessMatchesContract(state.contract,
      {...bound.summary, [field]: bound.summary[field] + 1}, videoSha256));
  assert.equal(bindControlledRendererFontWitness(state.contract, undefined, videoSha256), undefined);
  const tampered = structuredClone(nativeEvidence);
  tampered.fontEvidence.checkpoints[0].elements[0].fonts[0].isCustomFont = false;
  assert.throws(() => buildControlledComparisonArtifacts({...input, nativeEvidence: tampered}));
  assert.throws(() => bindControlledRendererFontWitness(state.contract,
    {scope: nativeEvidence.scope, fontEvidence: createFontUsageEvidenceFixture([{frameIndex: 0, timeSeconds: 0}]).fontUsage,
      textEvidence: state.text}, videoSha256));
});
function fixture() {
  const document = createInitialCompositionDocument({animatedDeck: null, assets: [], sourceInsertionMode: "MANUAL",
    plan: {accentColor: "#38BDF8", durationSeconds: 8, title: "Fonts", subtitle: "Controlled"}});
  const {clip, track} = createCompositionNativeOverlay({document, id: "native", kind: "TEXT", playheadSeconds: 0});
  if (clip.source.type !== "NATIVE_TEXT") throw new Error("Expected text");
  clip.source.style.fontAssetId = font.fontAssetId; clip.source.style.fontFamily = font.family;
  if (track) document.tracks.push(track); document.clips.push(clip); document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  const execution = controlledRenderExecutionContractSchema.parse({policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1",
    backend: "CONTROLLED", sdkVersion: "0.7.106", expectedBrowser: browser,
    files: Object.fromEntries(["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"]
      .map(role => [role, {sha256: "b".repeat(64), sizeBytes: 10}]))});
  const contract = buildSnapshotConformanceContract({document, documentHash: hashCompositionDocument(document), assets: [],
    contractVersion: 4, fontUsage: true, fontManifest: [font], renderExecution: execution,
    renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  if (contract.schemaVersion !== 4) throw new Error("Expected v4");
  const text = {schemaVersion: 1, policy: COMPOSITION_TEXT_PARITY_POLICY.id, repeatability: TEXT_PARITY_REPEATABILITY,
    checkpoints: contract.textParity.checkpoints.map(point => ({...point, policy: COMPOSITION_TEXT_PARITY_POLICY.id,
      status: "CAPTURED", unavailable: [], regions: point.expectedTexts.map(expected => ({elementId: expected.elementId,
        textSha256: expected.textSha256, ...(expected.visibility ? {visibility: expected.visibility} : {}),
        left: 0, top: 0, width: 100, height: 20}))}))};
  let handler: ((event: Record<string, unknown>) => void) | undefined;
  let fallback = false, changedBrowser = false, changedFiles = false, pinChecks = 0;
  const client: CompositionQaCdpClient = {close() {}, onEvent(_method, callback) {
    handler = callback; return () => {handler = undefined;};
  }, async send(method, params) {
    if (method === "Browser.getVersion") return {...browser, ...(changedBrowser ? {revision: "changed"} : {})};
    if (method === "Runtime.evaluate") return params?.returnByValue ? {result: {value: true}} : {result: {objectId: "native"}};
    if (method === "DOM.requestNode") return {nodeId: 42};
    if (method === "CSS.getPlatformFontsForNode") return {fonts: [{familyName: "Internal Editorial", postScriptName: "Editorial-Regular",
      isCustomFont: !fallback, glyphCount: 8}]};
    return {};
  }};
  return {document, contract, text, client, pinChecks: () => pinChecks, subscribed: () => !!handler,
    emit() {handler?.({font: {fontFamily: font.family, platformFontFamily: "Internal Editorial", src: `${origin}/${conformanceFontPath(font)}`}});},
    fallback() {fallback = true;}, changeBrowser() {changedBrowser = true;}, changeFiles() {changedFiles = true;},
    async start() {return startControlledFontCapture({document, contract, client, origin, fonts: [font], verifyFiles: async () => {
      pinChecks++; if (changedFiles) throw new Error("private file path");
    }});}};
}

test("font cancellation closes only the owned observer and rejects future capture/finish", async () => {
  const state = fixture(), abort = new AbortController();
  let commands = 0, sharedCloses = 0;
  const client = {...state.client, close() {sharedCloses++;}, async send(...args: Parameters<CompositionQaCdpClient["send"]>) {
    commands++; return state.client.send(...args);
  }};
  const capture = await startControlledFontCapture({document: state.document, contract: state.contract, client,
    origin, fonts: [font], verifyFiles: async () => {}, signal: abort.signal});
  state.emit(); abort.abort("private reason");
  const previous = commands;
  await assert.rejects(capture.capture(state.text.checkpoints[0]), /^Error: CONFORMANCE_JOB_EXECUTION_CANCELLED$/);
  await assert.rejects(capture.finish(state.text), /^Error: CONFORMANCE_JOB_EXECUTION_CANCELLED$/);
  assert.equal(commands, previous); assert.equal(sharedCloses, 0); assert.equal(state.subscribed(), false);
  capture.close();
});
test("abort during a glyph query releases its remote handle but cannot accept the late observation", async () => {
  const state = fixture(), abort = new AbortController();
  const calls: string[] = [];
  const client = {...state.client, async send(method: string, params?: Record<string, unknown>) {
    calls.push(method); const result = await state.client.send(method, params);
    if (method === "CSS.getPlatformFontsForNode") abort.abort("private reason");
    return result;
  }};
  const capture = await startControlledFontCapture({document: state.document, contract: state.contract, client,
    origin, fonts: [font], verifyFiles: async () => {}, signal: abort.signal});
  state.emit();
  await assert.rejects(capture.capture(state.text.checkpoints[0]), /^Error: CONFORMANCE_JOB_EXECUTION_CANCELLED$/);
  assert.equal(calls.at(-1), "Runtime.releaseObject");
  assert.equal(state.subscribed(), false);
});
test("pre-abort and cancellation during file verification prevent subsequent font commands", async () => {
  const state = fixture(), abort = new AbortController(); abort.abort();
  let pins = 0;
  await assert.rejects(startControlledFontCapture({document: state.document, contract: state.contract, client: state.client,
    origin, fonts: [font], verifyFiles: async () => {pins++;}, signal: abort.signal}), /EXECUTION_CANCELLED/);
  assert.equal(pins, 0);
  const late = new AbortController();
  await assert.rejects(startControlledFontCapture({document: state.document, contract: state.contract, client: state.client,
    origin, fonts: [font], verifyFiles: async () => {late.abort();}, signal: late.signal}), /EXECUTION_CANCELLED/);
  assert.equal(state.subscribed(), false);
});
test("controlled font collector observes glyphs, pins browser/files and closes without claiming renderer attestation", async () => {
  const state = fixture(); const capture = await state.start(); state.emit();
  await assert.rejects(capture.finish(state.text), /COVERAGE_INCOMPLETE/);
  for (const point of state.text.checkpoints) await capture.capture(point);
  const evidence = await capture.finish(state.text);
  assert.equal(evidence.scope, "LOCAL_CDP_CUSTOM_NATIVE_GLYPHS_NOT_RENDERER_ATTESTATION");
  assert.equal(evidence.checkpoints.length, state.contract.checkpoints.length);
  assert.equal(evidence.manifestSha256, state.contract.fontUsageContract!.manifestSha256);
  assert.ok(state.pinChecks() > state.contract.checkpoints.length);
  assert.equal(state.subscribed(), false);
  await assert.rejects(capture.capture(state.text.checkpoints[0]), /SESSION_INVALID/);
});

test("preview witnesses cannot be relabeled or accepted as controlled evidence", () => {
  const preview = createFontUsageEvidenceFixture([{frameIndex: 0, timeSeconds: 0}]).fontUsage;
  assert.equal(controlledFontUsageEvidenceSchema.safeParse(preview).success, false);
});

test("independent font witness validation rejects foreign contracts, omission and altered glyph provenance", async () => {
  const state = fixture(); const capture = await state.start(); state.emit();
  for (const point of state.text.checkpoints) await capture.capture(point);
  const evidence = await capture.finish(state.text);
  assert.deepEqual(validateControlledFontUsageEvidence(evidence, state.contract, state.text), evidence);
  for (const kind of ["document", "contract", "manifest", "browser", "coverage", "binding", "fallback"] as const) {
    const changed = structuredClone(evidence);
    if (kind === "document") changed.documentHash = "c".repeat(64);
    if (kind === "contract") changed.contractSha256 = "c".repeat(64);
    if (kind === "manifest") changed.manifest[0].checksumSha256 = "c".repeat(64);
    if (kind === "browser") changed.browserAfter.revision = "changed";
    if (kind === "coverage") changed.checkpoints.pop();
    if (kind === "binding") changed.bindings = [];
    if (kind === "fallback") changed.checkpoints[0].elements[0].fonts[0].isCustomFont = false;
    assert.throws(() => validateControlledFontUsageEvidence(changed, state.contract, state.text), kind);
  }
});

test("missing events, fallback glyphs, wrong checkpoints and changed files terminate the collector", async () => {
  for (const kind of ["event", "fallback", "checkpoint", "files"] as const) {
    const state = fixture(); const capture = await state.start();
    if (kind !== "event") state.emit();
    if (kind === "fallback") state.fallback();
    if (kind === "files") state.changeFiles();
    const point = structuredClone(state.text.checkpoints[0]);
    if (kind === "checkpoint") point.timeSeconds += 1;
    await assert.rejects(capture.capture(point), error => error instanceof Error && error.message === "CONTROLLED_RENDER_FONT_CAPTURE_FAILED");
    assert.equal(state.subscribed(), false);
  }
});

test("finalization rejects browser changes and a substituted text witness, preserving cleanup", async () => {
  for (const kind of ["browser", "text"] as const) {
    const state = fixture(); const capture = await state.start(); state.emit();
    for (const point of state.text.checkpoints) await capture.capture(point);
    const text = structuredClone(state.text);
    if (kind === "browser") state.changeBrowser();
    if (kind === "text") text.checkpoints[0].regions[0].width++;
    await assert.rejects(capture.finish(text), /FINALIZATION_FAILED/);
    assert.equal(state.subscribed(), false);
  }
});

test("a changed document or frozen font binding fails before CDP subscription", async () => {
  const state = fixture(); const document = structuredClone(state.document); document.canvas.width++;
  await assert.rejects(startControlledFontCapture({document, contract: state.contract, client: state.client, origin,
    fonts: [font], verifyFiles: async () => {}}), /CONTRACT_REQUIRED/);
  const contract = structuredClone(state.contract); contract.fontUsageContract!.manifestSha256 = "c".repeat(64);
  await assert.rejects(startControlledFontCapture({document: state.document, contract, client: state.client, origin,
    fonts: [font], verifyFiles: async () => {}}), /FROZEN_BINDING_MISMATCH/);
  assert.equal(state.subscribed(), false);
});

test("CDP startup errors are sanitized and release subscriptions", async () => {
  for (const failure of ["Browser.getVersion", "CSS.enable"]) {
    const state = fixture(), send = state.client.send;
    state.client.send = async (method, params) => {
      if (method === failure) throw new Error("private/path/token");
      return send(method, params);
    };
    await assert.rejects(state.start(), error => error instanceof Error
      && ["CONTROLLED_RENDER_FONT_BROWSER_UNAVAILABLE", "CONTROLLED_RENDER_FONT_SETUP_FAILED"].includes(error.message));
    assert.equal(state.subscribed(), false);
  }
});

test("font provenance is checked again on reverse seeks, not inferred from matching text geometry", async () => {
  const state = fixture(); const capture = await state.start(); state.emit();
  for (const point of state.text.checkpoints) await capture.capture(point);
  await capture.verifyRepeat(state.text.checkpoints[0]);
  state.fallback();
  await assert.rejects(capture.verifyRepeat(state.text.checkpoints[0]), /REPEAT_FAILED/);
  assert.equal(state.subscribed(), false);
});
