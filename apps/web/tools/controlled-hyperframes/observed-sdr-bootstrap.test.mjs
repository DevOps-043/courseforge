import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createHash} from "node:crypto";
import {EventEmitter} from "node:events";
import {mkdtemp, mkdir, writeFile, readFile, rm, stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import sharp from "sharp";
import {buildProducerExtensionPackage, projectProducerExtensionInventory} from "./build-producer-extension-v1.mjs";
import {fileRecord} from "./producer-extension-files.mjs";
import {runObservedMaterializedProducer} from "./run-observed-materialized-producer.mjs";
import {collectMaterializedProducerCandidate} from "./materialized-producer-collector.mjs";
import {encodeMaterializedProducerRequest, decodeMaterializedProducerRequest, prepareMaterializedProducerLaunch,
  MATERIALIZED_MEASUREMENT_REQUEST_POLICY, materializedExecutionDigest} from "./materialized-producer-request.mjs";
import {encodeObservedOperatorReference} from "./observed-producer-operator-reference.mjs";
import {OBSERVED_OPERATOR_CONFIGURATION_POLICY} from "./observed-producer-operator-configuration.mjs";
import {ORIGINAL_SESSION_OBSERVER_POLICY} from "./original-session-observer.mjs";
import {MATERIALIZED_MEASUREMENT_PLAN_POLICY} from "./materialized-measurement-plan-policy.mjs";
import {ORIGINAL_NATIVE_RECEIPT_FILE} from "./original-native-receipt.mjs";
import {runObservedProducer, observeProducerSession, observeProducerBeforeFrame, observeProducerAfterFrame,
  encodeObservedProducerStage, observeProducerAssembly} from "./courseforge-producer-observer-v1.mjs";
const require = createRequire(new URL("../../package.json", import.meta.url));
const compiled = "./dist/composition-worker/domains/production/composition-editor/";
const {createInitialCompositionDocument} = require(`${compiled}composition-document.factory.js`);
const {hashCompositionDocument} = require(`${compiled}composition-document.service.js`);
const {digestControlledDependencyManifest} = require(`${compiled}qa/composition-controlled-dependency-inventory.js`);
const {SDR_FRAME_CONVERSION_POLICY, SDR_AUDIO_MUX_POLICY} = require(`${compiled}composition-sdr-conversion-policy.js`);
// Fixture construction only. All exercised worker/observer/encoder/binders use operational modules.
const {buildSnapshotConformanceContract} = require("./.tmp/hyperframes-tests/domains/production/composition-editor/composition-snapshot-conformance-contract.js");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

test("V3 bootstrap integrates original observers, V4 stages and independent receipt validation", async t => {
  const root = await mkdtemp(join(tmpdir(), "cf-sdr-bootstrap-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const signal = new AbortController().signal;
  const artifact = await buildProducerExtensionPackage({sourceDirectory: fileURLToPath(new URL("./node_modules/@hyperframes/producer", import.meta.url)),
    outputDirectory: join(root, "producer"), signal});
  const fragment = await projectProducerExtensionInventory({directory: artifact.directory,
    expectedManifestSha256: artifact.manifestSha256, rootId: "producer", signal});
  const tools = join(root, "tools"); await mkdir(tools);
  const binaryPath = join(tools, "fixture.txt"), binary = Buffer.from("not executable, injected ports only"); await writeFile(binaryPath, binary);
  const binding = {rootId: "tools", path: "fixture.txt"};
  const files = [...fragment.files, {...binding, ...fileRecord("fixture.txt", binary)}];
  const roles = Object.fromEntries(["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"]
    .map(role => [role, role === "producer" ? fragment.producer : binding]));
  const manifest = {policy: "EXACT_DECLARED_DEPENDENCY_TREES_V1", roots: ["producer", "tools"], files, roles,
    comparisonTools: {pixelDecoder: binding, probe: binding}};
  const dependencyInventory = {manifest, expectedManifestSha256: digestControlledDependencyManifest(manifest),
    roots: {producer: artifact.directory, tools}};
  const identity = {sha256: sha(binary), sizeBytes: binary.length};
  const browser = {protocolVersion: "1.3", product: "fixture", revision: "fixture", userAgent: "fixture", jsVersion: "fixture"};
  const png = await sharp({create: {width: 16, height: 16, channels: 3, background: "#203040"}}).png().toBuffer();
  let iteration = 0;
  for (const mode of ["silent", "audio", "drift", "network-rejected"]) await t.test(mode, async () => {
    const hasAudio = mode === "audio";
    const document = createInitialCompositionDocument({animatedDeck: null, assets: [], sourceInsertionMode: "MANUAL",
      plan: {title: "Bootstrap", subtitle: "Original", accentColor: "#38BDF8", durationSeconds: 1}});
    Object.assign(document.canvas, {width: 16, height: 16, durationSeconds: 0.08, fps: 25});
    const execution = {policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1", backend: "CONTROLLED", sdkVersion: "0.7.106",
      files: Object.fromEntries(Object.entries(roles).map(([role, entry]) => {
        const file = files.find(file => file.rootId === entry.rootId && file.path === entry.path);
        return [role, {sha256: file.sha256, sizeBytes: file.sizeBytes}];
      })), expectedBrowser: browser, comparisonTools: {policy: "EXPLICIT_PIXEL_DECODER_AND_PROBE_V1", pixelDecoder: identity, probe: identity},
      seekRepeatabilityPolicy: "EXACT_RGBA_FORWARD_REVERSE_V1", sdrConversionPolicy: SDR_FRAME_CONVERSION_POLICY.id,
      ...(hasAudio ? {sdrAudioMuxPolicy: SDR_AUDIO_MUX_POLICY} : {})};
    const contract = buildSnapshotConformanceContract({document, documentHash: hashCompositionDocument(document), assets: [],
      contractVersion: 4, colorTags: true, renderExecution: execution,
      renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
    const directory = join(root, `input-${mode}`), outputParentDirectory = join(root, `output-${mode}`), sdkWork = join(root, `sdk-${mode}`);
    await mkdir(directory); await mkdir(join(directory, "assets")); await mkdir(outputParentDirectory); await mkdir(sdkWork);
    const sourceFiles = {"composition-document.json": JSON.stringify(document), "conformance-contract.json": JSON.stringify(contract),
      "font-manifest.json": "[]", "conformance-reference.json": "{}", "index.html": "<html>fixture, not executed</html>",
      "assets/gsap.min.js": "// fixture, not executed"};
    for (const [path, bytes] of Object.entries(sourceFiles)) await writeFile(join(directory, path), bytes);
    const request = {policy: MATERIALIZED_MEASUREMENT_REQUEST_POLICY,
      executionId: `00000000-0000-4000-8000-${String(++iteration).padStart(12, "0")}`,
      organizationId: "00000000-0000-4000-8000-000000000010", revisionId: "00000000-0000-4000-8000-000000000011",
      documentHash: hashCompositionDocument(document), projectHash: "b".repeat(64), directory, outputParentDirectory,
      browserPath: binaryPath, encoderPath: binaryPath, probePath: binaryPath, fps: 25,
      renderExecutionSha256: materializedExecutionDigest(execution)};
    const plan = {scope: MATERIALIZED_MEASUREMENT_PLAN_POLICY.scope, organizationId: request.organizationId, revisionId: request.revisionId,
      projectHash: request.projectHash, documentHash: request.documentHash, contractSha256: sha(JSON.stringify(contract)),
      document, contract, fonts: [], files: Object.entries(sourceFiles).map(([path, bytes]) => fileRecord(path, Buffer.from(bytes)))};
    const planBytes = Buffer.from(JSON.stringify(plan)); await writeFile(join(directory, MATERIALIZED_MEASUREMENT_PLAN_POLICY.path), planBytes);
    Object.assign(request, {measurementPlanSha256: sha(planBytes), measurementPlanSizeBytes: planBytes.length});
    const configuration = {policy: OBSERVED_OPERATOR_CONFIGURATION_POLICY, observerPolicy: ORIGINAL_SESSION_OBSERVER_POLICY,
      packageDirectory: artifact.directory, expectedPackageManifestSha256: artifact.manifestSha256, dependencyInventory, execution};
    const configBytes = Buffer.from(JSON.stringify(configuration)), configPath = join(root, `operator-${mode}.json`); await writeFile(configPath, configBytes);
    const encodedReference = encodeObservedOperatorReference({path: configPath, sha256: sha(configBytes)});
    const workspace = {directory, entryPath: join(directory, "index.html"), receipt: request,
      measurementPlanReference: {sha256: request.measurementPlanSha256, sizeBytes: request.measurementPlanSizeBytes}};
    const installation = {...request, nodePath: binaryPath, operatorConfiguration: {path: configPath, sha256: sha(configBytes)}};
    const launch = prepareMaterializedProducerLaunch({...request, contract}, workspace, installation);
    assert.deepEqual(decodeMaterializedProducerRequest(launch.arguments[2]), request);
    assert.throws(() => prepareMaterializedProducerLaunch({...request, contract}, {...workspace, measurementPlanReference: undefined}, installation), /PROFILE_UNSUPPORTED/);
    const {operatorConfiguration: _operator, ...legacyInstallation} = installation;
    assert.throws(() => prepareMaterializedProducerLaunch({...request, contract}, workspace, legacyInstallation), /PROFILE_UNSUPPORTED/);
    const outputPath = join(outputParentDirectory, request.executionId, "video.mp4");
    let reverseReads = 0, stageCalls = 0;
    const probe = async (_binary, args) => {
      stageCalls++;
      const path = args.at(-1);
      if (args.includes("-an")) {await writeFile(path, "encoded fixture, not media", {flag: "wx"}); return {stdout: ""};}
      if (args.includes("-show_packets")) return {stdout: JSON.stringify({
        streams: [{codec_type: "video", time_base: "1/12800", extradata_hash: `SHA256:${"e".repeat(64)}`}],
        packets: ["a", "b"].map((hash, index) => ({size: "100", data_hash: `SHA256:${hash.repeat(64)}`,
          pts: index * 512, dts: (index - 2) * 512 - (mode === "drift" && path === outputPath ? 512 : 0), duration: 512}))})};
      return {stdout: JSON.stringify({streams: [{codec_type: "video", codec_name: "h264", width: 16, height: 16,
        pix_fmt: "yuv420p", avg_frame_rate: "25/1", nb_read_frames: "2", color_space: "bt709", color_transfer: "bt709",
        color_primaries: "bt709", color_range: "tv", chroma_location: "left", start_time: "0"},
        ...(hasAudio && path === outputPath ? [{codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2,
          start_time: "0", duration: "0.08"}] : [])],
        format: {duration: "0.08", size: String((await stat(path)).size), format_name: "mov,mp4", start_time: "0"}})};
    };
    const producer = {DEFAULT_CONFIG: {enableStreamingEncode: true}, createRenderJob(config) {return {config, duration: 0.08};},
      async executeObservedRenderJob(job, _directory, videoPath, _progress, jobSignal, hooks) {
        assert.equal(job.config.producerConfig.enableStreamingEncode, false);
        assert.deepEqual(job.config.fps, {num: 25, den: 1});
        await runObservedProducer(async () => {
          const session = {page: {}, captureMode: "screenshot", serverUrl: "http://127.0.0.1:1234"};
          const cdp = new EventEmitter();
          cdp.send = async function (method) {
            if (method === "Browser.getVersion") return browser;
            return {result: {value: []}};
          };
          await observeProducerSession(session, async () => cdp);
          if (mode === "network-rejected") cdp.emit("Fetch.requestPaused", {requestId: "external-request",
            request: {url: "https://outside.invalid/private", method: "GET"}});
          for (let frameIndex = 0; frameIndex < 2; frameIndex++) {
            const time = frameIndex / 25;
            await observeProducerBeforeFrame(session, frameIndex, time, time);
            await observeProducerAfterFrame(session, frameIndex, time, time, png, async (_index, seconds, capture) => {
              reverseReads++; return {quantizedTime: seconds, ...(capture ? {buffer: png} : {})};
            });
          }
          const stage = {job, abortSignal: jobSignal, width: 16, height: 16, hasAudio, needsAlpha: false,
            isGif: false, isPngSequence: false, videoOnlyPath: join(sdkWork, "silent.mp4"), outputPath: videoPath};
          await encodeObservedProducerStage(stage);
          await writeFile(videoPath, "SDK remux fixture, not media");
          await observeProducerAssembly(stage);
          await rm(stage.videoOnlyPath); // Verify bootstrap does not rely on an SDK-disposed temporary.
        }, job, jobSignal, hooks);
        Object.assign(job, {status: "complete", outcome: "completed", warnings: [], outputPath: videoPath,
          perfSummary: {observability: {capture: {forceScreenshot: true, captureMode: "screenshot", workerCount: 1,
            browserGpuMode: "software", hasHdrContent: false}}}});
      }};
    const run = () => runObservedMaterializedProducer(launch.arguments[2], encodedReference,
      {signal, environment: {}, observedLoaderPorts: {importModule: async () => producer}, sdrStagePorts: {execute: probe}});
    if (mode === "network-rejected") {
      await assert.rejects(run(), /OBSERVED_PROCESS_FAILED/);
      assert.equal(stageCalls, 0); // HTTP rejection must happen before encoding or candidate receipt publication.
      await assert.rejects(readFile(join(outputParentDirectory, request.executionId, ORIGINAL_NATIVE_RECEIPT_FILE)), {code: "ENOENT"});
    } else if (mode === "drift") {
      await assert.rejects(run(), /OBSERVED_PROCESS_FAILED/);
      assert.equal(stageCalls, 5); // Must reach packet verification, not pass from an unrelated early failure.
      await assert.rejects(readFile(join(outputParentDirectory, request.executionId, ORIGINAL_NATIVE_RECEIPT_FILE)), {code: "ENOENT"});
    } else {
      await run(); assert.ok(reverseReads > 0); assert.equal(stageCalls, 5);
      const collected = await collectMaterializedProducerCandidate(request, signal, {execution, contract, document, frameCount: 2});
      assert.equal(collected.originalNative.renderExecutionObservation.sdrConversionPolicy, SDR_FRAME_CONVERSION_POLICY.id);
      assert.equal(collected.originalNative.renderExecutionObservation.sdrAudioMuxPolicy, hasAudio ? SDR_AUDIO_MUX_POLICY : undefined);
      assert.equal(collected.originalNative.seekRepeatability.status, "PASS");
      assert.equal(collected.originalSession.observations.frameCount, 2);
      await collected.assertUnchanged();
      await writeFile(outputPath, "changed"); await assert.rejects(collected.assertUnchanged());
    }
  });
});
