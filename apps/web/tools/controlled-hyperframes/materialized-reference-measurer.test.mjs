import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {basename, dirname, join, resolve, relative} from "node:path";
import {fileURLToPath} from "node:url";
import {mkdtemp, mkdir, readdir, readFile, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {createMaterializedProducerReferenceBridgeConfiguration} from "./materialized-reference-measurer.mjs";
import {decodeMaterializedProducerRequest, materializedProducerOutputPaths, materializedProducerRequestDigest} from "./materialized-producer-request.mjs";
import {auditMaterializedProducerCapture} from "./materialized-producer-capture-audit.mjs";

const require = createRequire(new URL("../../package.json", import.meta.url));
const root = "./dist/composition-worker/domains/production/composition-editor";
const {createInitialCompositionDocument} = require(`${root}/composition-document.factory.js`);
const {hashCompositionDocument} = require(`${root}/composition-document.service.js`);
const {buildCompositionConformanceContract, compositionConformanceContractSchema} = require(`${root}/composition-preview-render-conformance.js`);
const {buildTextParityCheckpointPlans} = require(`${root}/composition-text-checkpoint-plan.js`);
const {controlledRenderExecutionContractSchema} = require(`${root}/composition-render-execution-contract.js`);
const {bindControlledReferenceSelection} = require(`${root}/qa/composition-controlled-reference-selection.js`);
const {textParityEvidenceHash, TEXT_PARITY_REPEATABILITY} = require(`${root}/qa/composition-text-parity-evidence.js`);
const {COMPOSITION_TEXT_PARITY_POLICY} = require(`${root}/composition-text-parity-policy.js`);
const windowsPorts = require(`${root}/qa/composition-windows-comparison-process-ports.js`);
const sharp = require("sharp"), JSZip = require("jszip");
const identifier = "70000000-0000-4000-8000-000000000001";
const digest = value => createHash("sha256").update(value).digest("hex");

// Native processes and database transport are simulated; collector, scoped ZIP reader, bindings,
// PNG/SSIM measurement, gates, crypto, report writer and final candidate rechecks remain real.
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "cf-complete-measurer-"));
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.match(basename(directory), /^cf-complete-measurer-/);
  t.after(() => rm(directory, {recursive: true, force: true}));
  const outputs = join(directory, "outputs"), workspacePath = join(directory, "workspace");
  await mkdir(outputs); await mkdir(workspacePath);
  const binaries = Object.fromEntries(["node", "browser", "encoder", "decoder", "powershell", "probe"]
    .map(role => [role, join(directory, `${role}.exe`)]));
  for (const [role, path] of Object.entries(binaries)) await writeFile(path, `non-executable binary fixture ${role}`);
  const identity = async role => {const bytes = await readFile(binaries[role]); return {sha256: digest(bytes), sizeBytes: bytes.length};};
  const browser = {protocolVersion: "1.3", product: "Chrome/test", revision: "test", userAgent: "test", jsVersion: "test"};
  const execution = controlledRenderExecutionContractSchema.parse({policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1",
    backend: "CONTROLLED", sdkVersion: "0.7.106", expectedBrowser: browser,
    files: Object.fromEntries(await Promise.all(["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"]
      .map(async role => [role, await identity(Object.hasOwn(binaries, role) ? role : "node")]))),
    comparisonTools: {policy: "EXPLICIT_PIXEL_DECODER_AND_PROBE_V1", pixelDecoder: await identity("decoder"), probe: await identity("probe")}});
  const document = createInitialCompositionDocument({animatedDeck: null, assets: [{productionAssetId: identifier,
    checksum: "f".repeat(64), fileSizeBytes: 100, durationSeconds: 1, mimeType: "video/mp4", hasAudio: false,
    publicUrl: null, storageBucket: "production-assets", storagePath: "media/source.mp4", timelineRole: "BROLL"}],
    plan: {accentColor: "#38BDF8", durationSeconds: 1, subtitle: "Fixture", title: "Fixture"}});
  document.canvas.width = 2; document.canvas.height = 2;
  const documentHash = hashCompositionDocument(document);
  const base = buildCompositionConformanceContract({document, documentHash, assets: [], contractVersion: 3,
    renderProfile: {format: "mp4", fps: document.canvas.fps, quality: "high", resolution: "1080p"}});
  const contract = compositionConformanceContractSchema.parse({...base, schemaVersion: 4, renderExecution: execution,
    textParity: {policy: COMPOSITION_TEXT_PARITY_POLICY.id, scope: "NATIVE_TEXT_AND_CAPTIONS",
      checkpoints: buildTextParityCheckpointPlans(document, base.checkpoints, false)}});
  const descriptor = {organizationId: identifier, revisionId: identifier, executionId: identifier,
    documentHash, projectHash: "c".repeat(64), contract};
  assert.ok(contract.textParity.checkpoints.every(point => !point.expectedTexts.length));
  const textEvidence = {schemaVersion: 1, policy: COMPOSITION_TEXT_PARITY_POLICY.id, repeatability: TEXT_PARITY_REPEATABILITY,
    checkpoints: contract.textParity.checkpoints.map(point => ({...point, policy: COMPOSITION_TEXT_PARITY_POLICY.id,
      status: "CAPTURED", regions: [], unavailable: []}))};
  const png = await sharp({create: {width: 2, height: 2, channels: 4, background: "#020617"}}).png().toBuffer();
  const rendered = options.visualFailure
    ? await sharp({create: {width: 2, height: 2, channels: 4, background: "#ffffff"}}).png().toBuffer() : png;
  const frames = contract.checkpoints.map(point => ({frameIndex: point.frameIndex, timeSeconds: point.timeSeconds,
    sha256: digest(png), sizeBytes: png.length}));
  const receipt = {schemaVersion: 1, organizationId: identifier, revisionId: identifier, projectHash: descriptor.projectHash,
    documentHash, status: "VISUAL_CAPTURED_AUDIO_PENDING", assetCount: 0, mediaBytes: 0,
    networkPolicy: "EXACT_LOCAL_ALLOWLIST_V1", frames, textParitySha256: textParityEvidenceHash(textEvidence)};
  const zip = new JSZip();
  zip.file("conformance-contract.json", JSON.stringify(contract)); zip.file("capture-receipt.json", JSON.stringify(receipt));
  zip.file("preview-metadata.json", JSON.stringify({documentHash, textParity: textEvidence,
    frames: frames.map(({frameIndex, timeSeconds}) => ({frameIndex, timeSeconds}))}));
  for (const frame of frames) zip.file(`frame-${frame.frameIndex}.png`, png);
  const bundle = await zip.generateAsync({type: "nodebuffer", compression: "DEFLATE"}), checksum = digest(bundle);
  const storagePath = `${identifier}/${identifier}/${checksum}.zip`;
  let decoded = 0, processConfigurations = 0, reads = 0;
  const supabase = {rpc: async (name, args) => {
    reads++; assert.equal(name, "read_hyperframes_visual_conformance_evidence");
    assert.deepEqual(args, {p_organization_id: identifier, p_revision_id: identifier, p_bundle_sha256: checksum});
    return {error: null, data: {organizationId: identifier, revisionId: identifier, checksum,
      projectHash: descriptor.projectHash, documentHash, storagePath, sizeBytes: bundle.length,
      frames, status: receipt.status, contract}};
  }, storage: {from: bucket => {
    assert.equal(bucket, "composition-conformance-evidence");
    return {download: async path => {assert.equal(path, storagePath); return {error: null, data: new Blob([Uint8Array.from(bundle)])};}};
  }}};
  t.mock.method(windowsPorts, "createWindowsComparisonProcessPorts", context => {
    processConfigurations++; assert.deepEqual(context.descriptor, descriptor);
    return {pixelDecoderPath: binaries.decoder, probePath: binaries.probe,
      consumePcm: () => assert.fail("silent contract must not decode audio"),
      execute: async (binary, args, controls) => {
        controls.signal.throwIfAborted();
        if (binary === binaries.probe) {
          if (args.includes("frame=best_effort_timestamp_time")) return {stdout: Array.from({length: Math.ceil(contract.canvas.durationSeconds * contract.canvas.fps)},
            (_, index) => (index / contract.canvas.fps).toFixed(8)).join("\n"), stderr: ""};
          return {stdout: JSON.stringify({format: {duration: String(contract.canvas.durationSeconds)},
            streams: [{codec_type: "video", codec_name: "h264", width: 2, height: 2, avg_frame_rate: `${contract.canvas.fps}/1`}]}), stderr: ""};
        }
        assert.equal(binary, binaries.decoder); decoded++;
        if (options.cancelAtDecode) options.cancelAtDecode.abort();
        controls.signal.throwIfAborted(); await writeFile(args.at(-1), rendered);
        return {stdout: "", stderr: ""};
      }};
  });
  const tools = dirname(fileURLToPath(import.meta.url)), compiled = resolve(tools, "../../dist/composition-worker/domains/production/composition-editor/qa");
  const operatorPath = join(directory, "operator.json"); await writeFile(operatorPath, "{}");
  const roots = {tools, compiled, fixtures: directory};
  const files = [
    ...(await readdir(tools)).filter(path => path.endsWith(".mjs")).map(path => ({rootId: "tools", path})),
    ...["windows/owned-job-bridge.ps1", "windows/OwnedRenderJob.cs", "windows/OwnedRenderAccess.cs", "windows/OwnedRenderAppContainer.cs"].map(path => ({rootId: "tools", path})),
    ...["composition-controlled-reference-measurement.js", "composition-controlled-reference-selection.js",
      "composition-windows-comparison-process-ports.js"].map(path => ({rootId: "compiled", path})),
    ...Object.values(binaries).map(path => ({rootId: "fixtures", path: relative(directory, path)})),
    {rootId: "fixtures", path: "operator.json", sha256: digest("{}")},
  ]; // Constructor declarations only; this fixture does not claim full inventory/OS admission.
  const input = {supabase, measurementFence: {}, outputParentDirectory: outputs, powerShellPath: binaries.powershell,
    bridgeScriptPath: join(tools, "windows/owned-job-bridge.ps1"), operatorConfiguration: {path: operatorPath, sha256: digest("{}")},
    referenceSelections: [bindControlledReferenceSelection(descriptor, [{batchIndex: 0, visualChecksum: checksum}])],
    dependencyInventory: {roots, manifest: {files, roles: Object.fromEntries(["node", "browser", "encoder", "decoder"]
      .map(role => [role, {rootId: "fixtures", path: `${role}.exe`}]))}}};
  const workspace = {directory: workspacePath, entryPath: join(workspacePath, "index.html"), receipt: descriptor,
    measurementPlanReference: {sha256: "d".repeat(64), sizeBytes: 100}, measurementPlan: {...descriptor, document,
      contractSha256: digest(JSON.stringify(contract))}};
  const bridge = createMaterializedProducerReferenceBridgeConfiguration(input);
  const request = decodeMaterializedProducerRequest(bridge.prepareLaunch(descriptor, workspace).arguments[2]);
  const paths = materializedProducerOutputPaths(request); await mkdir(paths.directory);
  const video = Buffer.from("non-media original candidate fixture"); await writeFile(paths.videoPath, video);
  const videoPin = {sha256: digest(video), sizeBytes: video.length};
  await writeFile(paths.receiptPath, JSON.stringify({version: 1, scope: "CANDIDATE_VIDEO_NOT_CONFORMANCE",
    requestSha256: materializedProducerRequestDigest(request), executionId: identifier, organizationId: identifier,
    revisionId: identifier, documentHash, projectHash: descriptor.projectHash, candidate: {
      policy: "MATERIALIZED_FULL_PRODUCER_SDR_V1", scope: "CANDIDATE_VIDEO_NOT_CONFORMANCE", videoPath: paths.videoPath,
      capture: auditMaterializedProducerCapture({forceScreenshot: true, captureMode: "screenshot", workerCount: 1, browserGpuMode: "software", hasHdrContent: false})}}));
  await writeFile(join(paths.directory, "original-session.json"), JSON.stringify({version: 1,
    scope: "CANDIDATE_ORIGINAL_SESSION_NOT_SUPERVISOR_ARTIFACT", requestSha256: materializedProducerRequestDigest(request),
    executionId: identifier, documentHash, projectHash: descriptor.projectHash, video: videoPin, observations: {
      policy: "ORIGINAL_SESSION_BROWSER_FRAME_DIGEST_V1", scope: "ORIGINAL_CDP_SELF_REPORTED_VERSION_AND_FRAME_DIGEST_NOT_CONFORMANCE",
      browserBefore: browser, browserAfter: browser, frameCount: Math.ceil(contract.canvas.durationSeconds * contract.canvas.fps), frameDigestSha256: "e".repeat(64)}}));
  const nativePath = join(paths.directory, "original-native.json");
  await writeFile(nativePath, JSON.stringify({version: 1, scope: "CANDIDATE_ORIGINAL_NATIVE_NOT_SUPERVISOR_ARTIFACT",
    requestSha256: materializedProducerRequestDigest(request), measurementPlanSha256: request.measurementPlanSha256,
    executionId: identifier, documentHash, projectHash: descriptor.projectHash, video: videoPin,
    nativeEvidence: {scope: "SDK_SESSION_NATIVE_TEXT_AND_CUSTOM_GLYPHS_NOT_PREVIEW_PARITY", textEvidence},
    renderExecutionObservation: {policy: execution.policy, documentHash, videoSha256: videoPin.sha256,
      files: execution.files, comparisonTools: execution.comparisonTools, browserBefore: browser, browserAfter: browser}}));
  return {bridge, descriptor, workspace, paths, nativePath, checkpointCount: contract.checkpoints.length,
    reportPath: join(paths.directory, "controlled-measurements.json"), counts: () => ({decoded, processConfigurations, reads})};
}

test("complete collector/reference/comparator path writes actual incomplete measurements and returns original artifacts", async t => {
  const f = await fixture(t);
  const result = await f.bridge.collectResult(f.descriptor, f.workspace, new AbortController().signal);
  assert.equal(result.videoPath, f.paths.videoPath); assert.equal(result.artifacts.kind, "SINGLE_CONTRACT");
  const measured = JSON.parse(await readFile(f.reportPath, "utf8"));
  assert.equal(measured.status, "INCOMPLETE"); assert.equal(measured.reports.length, 1);
  assert.equal(measured.reports[0].report.visual.ssim.checkedCheckpointCount, f.checkpointCount);
  assert.equal(measured.reports[0].report.visual.ssim.minimumObserved, 1);
  assert.equal(measured.scope, "LOCAL_CONTROLLED_MEASUREMENTS_NOT_SIGNED_OR_DURABLE_CONFORMANCE");
  assert.equal(result.referenceSelection.executionId, f.descriptor.executionId);
  assert.equal(measured.referenceSelectionSha256, createHash("sha256").update(JSON.stringify(result.referenceSelection)).digest("hex"));
  assert.deepEqual(f.counts(), {decoded: f.checkpointCount, processConfigurations: 1, reads: 1});
});

test("actual SSIM failure writes diagnostics but prevents supervisor artifacts", async t => {
  const f = await fixture(t, {visualFailure: true});
  await assert.rejects(f.bridge.collectResult(f.descriptor, f.workspace, new AbortController().signal), /MEASUREMENT_FAILED/);
  const measured = JSON.parse(await readFile(f.reportPath, "utf8"));
  assert.equal(measured.status, "FAIL"); assert.ok(measured.reports[0].report.visual.ssim.minimumObserved < 0.99);
});

test("invalid original native receipt fails before allocating measurement processes or reading references", async t => {
  const f = await fixture(t); await writeFile(f.nativePath, "{}");
  await assert.rejects(f.bridge.collectResult(f.descriptor, f.workspace, new AbortController().signal), /CANDIDATE_INVALID/);
  assert.deepEqual(f.counts(), {decoded: 0, processConfigurations: 0, reads: 0});
  await assert.rejects(readFile(f.reportPath), {code: "ENOENT"});
});

test("cancellation during decoding never publishes artifacts or a success diagnostic", async t => {
  const controller = new AbortController(), f = await fixture(t, {cancelAtDecode: controller});
  await assert.rejects(f.bridge.collectResult(f.descriptor, f.workspace, controller.signal));
  await assert.rejects(readFile(f.reportPath), {code: "ENOENT"});
});
