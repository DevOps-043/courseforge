/** Trusted authored corpus ONLY. Public SDK capture/encode, not the full producer pipeline. */
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {dirname, join, resolve, isAbsolute} from "node:path";
import {mkdir, mkdtemp, readFile, writeFile} from "node:fs/promises";
import {promisify} from "node:util";
import {execFile} from "node:child_process";
import {prepareControlledSdkMedia} from "./controlled-sdk-media.mjs";
import {prepareControlledSdkTextBatches} from "./controlled-sdk-text-batches.mjs";
import {encodeControlledSdrCapture} from "./controlled-sdk-sdr.mjs";
import {runControlledSdkWorkflow, SDK_LIFECYCLE_POLICY} from "./controlled-sdk-lifecycle.mjs";
import {SDK_PROCESS_BUDGETS} from "./controlled-sdk-policy.mjs";
import {pinControlledSdkInstallation, assertControlledSdkInstallationUnchanged} from "./controlled-sdk-installation.mjs";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const appRequire = createRequire(join(web, "package.json"));
const compiled = join(web, ".tmp/hyperframes-tests/domains/production/composition-editor/qa");
const {compileControlledRenderCorpus, compileControlledVideoCorpus, compileControlledNativeFontCorpus} = appRequire(join(compiled, "composition-controlled-render-corpus.js"));
const {pinConformanceFile, assertConformanceFileUnchanged} = appRequire(join(compiled, "composition-conformance-file-integrity.js"));
const {readCaptureBrowserIdentity, assertCaptureBrowserIdentityUnchanged} = appRequire(join(compiled, "composition-browser-identity.js"));
const {auditControlledRenderColor} = appRequire(join(compiled, "composition-controlled-render-color-audit.js"));
const {auditControlledSplitRender} = appRequire(join(compiled, "composition-controlled-split-audit.js"));
const {auditControlledTrimRender} = appRequire(join(compiled, "composition-controlled-trim-audit.js"));
const {controlledRenderExecutionContractSchema, evaluateControlledRenderExecution} = appRequire(join(compiled, "../composition-render-execution-contract.js"));
const {buildSnapshotConformanceContract} = appRequire(join(compiled, "../composition-snapshot-conformance-contract.js"));
const {buildControlledEventComparisonArtifacts} = appRequire(join(compiled, "composition-controlled-event-comparison-artifacts.js"));
const {prepareCompositionEventBatchContracts} = appRequire(join(compiled, "../composition-conformance-event-batch-contract.js"));
const {measureControlledEventSeekRepeatability} = appRequire(join(compiled, "composition-controlled-seek-repeatability.js"));
const {CONTROLLED_RENDER_DEADLINE_POLICY} = appRequire(join(compiled, "composition-controlled-render-deadline.js"));
const {createControlledProcessEnvironment} = appRequire(join(compiled, "composition-controlled-process-environment.js"));
const {SDR_FRAME_CONVERSION_POLICY} = appRequire(join(compiled, "../composition-sdr-conversion-policy.js"));
const {assertSdrFrameSequenceUnchanged} = appRequire(join(compiled, "composition-sdr-frame-sequence.js"));
const {SDR_AUDIO_MUX_POLICY} = appRequire(join(compiled, "../composition-sdr-conversion-policy.js"));
const {verifySdrAudioMuxOutput} = appRequire(join(compiled, "composition-sdr-mux-verification.js"));
const {buildControlledExecutionObservation} = appRequire(join(compiled, "composition-controlled-execution-observation.js"));
const execute = promisify(execFile);
const MAX_PIN_BYTES = 1024 ** 3;
const VERSION = "0.7.106";
const EXECUTION_ROLES = {node: "node", producer: "@hyperframes/producer:entry", engine: "@hyperframes/engine:entry",
  runtime: "runtime", browser: "browser", encoder: "ffmpeg", decoder: "ffprobe"};
const COMPARISON_ROLES = {pixelDecoder: "pixelDecoder", probe: "ffprobe"};
function executionFiles(pins) {
  return Object.fromEntries(Object.entries(EXECUTION_ROLES).map(([role, id]) => {
    const pin = pins.find((entry) => entry.id === id)?.pin;
    if (!pin) throw new Error("CONTROLLED_RENDER_EXECUTION_PIN_MISSING");
    return [role, {sha256: pin.sha256, sizeBytes: pin.sizeBytes}];
  }));
}
function comparisonTools(pins) {
  return {policy: "EXPLICIT_PIXEL_DECODER_AND_PROBE_V1", ...Object.fromEntries(Object.entries(COMPARISON_ROLES).map(([role, id]) => {
    const pin = pins.find(entry => entry.id === id)?.pin;
    if (!pin) throw new Error("CONTROLLED_COMPARISON_TOOL_PIN_MISSING");
    return [role, {sha256: pin.sha256, sizeBytes: pin.sizeBytes}];
  }))};
}

async function main() {
  return runControlledSdkWorkflow({work: renderObserved, cleanupTimeoutMs: SDK_LIFECYCLE_POLICY.maximumCleanupMs,
    publish: async (result, lifecycle, controller) => {
      await result.verifyFinalFiles(controller);
      await controller.step(() => writeFile(result.receiptPath, JSON.stringify({...result.receipt, lifecycle,
        deadline: {policy: CONTROLLED_RENDER_DEADLINE_POLICY.id,
          totalMilliseconds: CONTROLLED_RENDER_DEADLINE_POLICY.maximumMilliseconds}}, null, 2), {flag: "wx", mode: 0o600}));
      controller.remainingMilliseconds();
      process.stdout.write(`${JSON.stringify(result.output)}\n`);
    }});
}

async function renderObserved(controller) {
  const {step, acquire, signal, remainingMilliseconds} = controller;
  const args = new Map(), values = process.argv.slice(2);
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index], value = values[index + 1];
    if (!["--browser", "--fps", "--trusted-local-synthetic", "--source-receipt", "--recipe", "--native-recipe", "--sdr-conversion"].includes(key)
      || !value || value.startsWith("--") || args.has(key)) throw new Error("CONTROLLED_RENDER_ARGUMENTS_INVALID");
    args.set(key, value);
  }
  const browserPath = args.get("--browser"), fps = Number(args.get("--fps")), explicitSdr = args.get("--sdr-conversion") === "yes";
  if (!isAbsolute(browserPath ?? "") || ![24, 25, 30, 60].includes(fps)
    || args.get("--trusted-local-synthetic") !== "yes"
    || args.has("--sdr-conversion") && !explicitSdr
    || args.has("--source-receipt") !== args.has("--recipe") || args.has("--source-receipt") && args.has("--native-recipe"))
    throw new Error("CONTROLLED_RENDER_ARGUMENTS_INVALID");
  const {RenderInternals} = appRequire("@remotion/renderer");
  const binary = (type) => RenderInternals.getExecutablePath({binariesDirectory: null, indent: false, logLevel: "error", type});
  const ffprobe = binary("ffprobe");
  const pixelDecoder = binary("ffmpeg");
  // Clear secrets and caller overrides BEFORE importing SDKs or launching child processes.
  const allowed = new Set(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"]);
  for (const key of Object.keys(process.env)) if (!allowed.has(key)) delete process.env[key];
  const localRequire = createRequire(import.meta.url);
  const ffmpeg = localRequire("ffmpeg-static");
  if (!ffmpeg || !isAbsolute(ffmpeg)) throw new Error("CONTROLLED_RENDER_FFMPEG_BINARY_MISSING");
  Object.assign(process.env, {NODE_ENV: "production", HYPERFRAMES_NO_TELEMETRY: "1",
    HYPERFRAMES_FFMPEG_PATH: ffmpeg, HYPERFRAMES_FFPROBE_PATH: ffprobe,
    PRODUCER_HEADLESS_SHELL_PATH: browserPath, PRODUCER_VERIFY_HYPERFRAME_RUNTIME: "true"});
  const files = {node: process.execPath, driver: fileURLToPath(import.meta.url), browser: browserPath, ffmpeg, ffprobe, pixelDecoder,
    comparisonAdapter: join(compiled, "composition-controlled-comparison-artifacts.js"),
    eventComparisonAdapter: join(compiled, "composition-controlled-event-comparison-artifacts.js"),
    eventContractPreparer: join(compiled, "../composition-conformance-event-batch-contract.js"),
    seekEvaluator: join(compiled, "composition-controlled-seek-repeatability.js"),
    seekBinding: join(compiled, "composition-controlled-seek-binding.js"),
    seekPolicy: join(compiled, "../composition-render-seek-policy.js"),
    executionContract: join(compiled, "../composition-render-execution-contract.js"),
    snapshotContract: join(compiled, "../composition-snapshot-conformance-contract.js"),
    textDriver: join(dirname(fileURLToPath(import.meta.url)), "controlled-sdk-text.mjs"),
    textBatchDriver: join(dirname(fileURLToPath(import.meta.url)), "controlled-sdk-text-batches.mjs"),
    eventCheckpointPlanner: join(compiled, "../composition-conformance-event-checkpoints.js"),
    eventBatchIdentity: join(compiled, "../composition-conformance-batch-identity.js"),
    fontCollector: join(compiled, "composition-controlled-font-capture.js"),
    fontWitness: join(compiled, "composition-controlled-font-witness.js"),
    fontWitnessContract: join(compiled, "../composition-font-usage-contract.js"),
    textCollector: join(compiled, "composition-text-checkpoint-capture.js"),
    textGeometryComparator: join(compiled, "composition-renderer-text-geometry.js"),
    textRegionContract: join(compiled, "composition-text-region-comparison.js"),
    textEvidenceContract: join(compiled, "composition-text-parity-evidence.js"),
    splitEvaluator: join(compiled, "composition-controlled-split-audit.js"),
    ffmpegPackage: localRequire.resolve("ffmpeg-static/package.json"), ffmpegLicense: `${ffmpeg}.LICENSE`,
    mediaDriver: join(dirname(fileURLToPath(import.meta.url)), "controlled-sdk-media.mjs"),
    lifecycleDriver: join(dirname(fileURLToPath(import.meta.url)), "controlled-sdk-lifecycle.mjs"),
    sdkLimits: join(dirname(fileURLToPath(import.meta.url)), "controlled-sdk-policy.mjs"),
    installationInventory: join(dirname(fileURLToPath(import.meta.url)), "controlled-sdk-installation.mjs"),
    deadlinePolicy: join(compiled, "composition-controlled-render-deadline.js"),
    environmentPolicy: join(compiled, "composition-controlled-process-environment.js"),
    sdrEncoder: join(compiled, "composition-sdr-frame-encoder.js"),
    sdrOutputProfile: join(compiled, "composition-sdr-output-profile.js"),
    sdrFrameSequence: join(compiled, "composition-sdr-frame-sequence.js"),
    sdrMuxVerifier: join(compiled, "composition-sdr-mux-verification.js"),
    sdrPacketTiming: join(compiled, "composition-sdr-packet-timing.js"),
    executionObservationBuilder: join(compiled, "composition-controlled-execution-observation.js"),
    trimAuditor: join(compiled, "composition-controlled-trim-audit.js"),
    pcmSilenceWindows: join(compiled, "composition-pcm-silence-windows.js"),
    sdrDecodeProfile: join(compiled, "composition-sdr-checkpoint-decoder.js"),
    sdrPolicy: join(compiled, "../composition-sdr-conversion-policy.js"),
    sdrDriver: join(dirname(fileURLToPath(import.meta.url)), "controlled-sdk-sdr.mjs"),
    lock: join(dirname(fileURLToPath(import.meta.url)), "package-lock.json")};
  for (const name of ["@hyperframes/producer", "@hyperframes/engine"]) {
    const entry = fileURLToPath(import.meta.resolve(name)), metadata = join(dirname(entry), "../package.json");
    const parsed = JSON.parse(await step(() => readFile(metadata, "utf8")));
    if (parsed.name !== name || parsed.version !== VERSION) throw new Error("CONTROLLED_RENDER_SDK_VERSION_MISMATCH");
    files[`${name}:entry`] = entry; files[`${name}:metadata`] = metadata;
    if (name === "@hyperframes/producer") files.runtime = join(dirname(entry), "hyperframe.runtime.iife.js");
  }
  const preparation = await step(() => args.has("--source-receipt")
    ? compileControlledVideoCorpus(args.get("--source-receipt"), args.get("--recipe"))
    : args.has("--native-recipe") ? compileControlledNativeFontCorpus(fps, args.get("--native-recipe"),
      join(dirname(appRequire.resolve("next/package.json")), "dist/next-devtools/server/font/geist-latin.woff2"))
    : compileControlledRenderCorpus(fps));
  const {fixture, html} = preparation, hasVideo = Boolean(preparation.sourcePath), hasText = Boolean(preparation.fonts);
  if (fixture.document.canvas.fps !== fps) throw new Error("CONTROLLED_RENDER_SOURCE_FPS_MISMATCH");
  const directory = await step(() => mkdtemp(join(web, ".tmp/observed-neutral-render-")));
  const project = join(directory, "project"), frames = join(directory, "frames");
  await step(() => mkdir(join(project, "assets"), {recursive: true})); await step(() => mkdir(frames));
  files.entry = join(project, "index.html"); files.gsap = join(project, "assets/gsap.min.js");
  await step(() => writeFile(files.entry, html, {flag: "wx"}));
  await step(async () => writeFile(files.gsap, await readFile(appRequire.resolve("gsap/dist/gsap.min.js")), {flag: "wx"}));
  if (hasText) {
    files.originalFont = preparation.fontPath;
    files.materializedFont = join(project, preparation.materializedFontPath);
    await step(() => mkdir(dirname(files.materializedFont), {recursive: true}));
    await step(async () => writeFile(files.materializedFont, await readFile(files.originalFont), {flag: "wx"}));
    if ((await step(() => pinConformanceFile(files.materializedFont, MAX_PIN_BYTES))).sha256 !== preparation.fontPin.sha256)
      throw new Error("CONTROLLED_RENDER_FONT_BYTES_CHANGED");
  }
  if (hasVideo) {
    files.sourceReceipt = args.get("--source-receipt"); files.originalSource = preparation.sourcePath;
    files.materializedSource = join(project, "assets/source.mp4");
    await step(async () => writeFile(files.materializedSource, await readFile(preparation.sourcePath), {flag: "wx"}));
    if ((await step(() => pinConformanceFile(files.materializedSource, MAX_PIN_BYTES))).sha256 !== preparation.sourceSha256)
      throw new Error("CONTROLLED_RENDER_SOURCE_EVIDENCE_INVALID");
  }
  const pinned = await step(() => Promise.all(Object.entries(files).map(async ([id, path]) => ({id, path, pin: await pinConformanceFile(path, MAX_PIN_BYTES)}))));
  if (hasText && pinned.find(item => item.id === "originalFont").pin.sha256 !== preparation.fontPin.sha256)
    throw new Error("CONTROLLED_RENDER_FONT_BYTES_CHANGED");
  if (hasVideo && (pinned.find((item) => item.id === "sourceReceipt").pin.sha256 !== preparation.receiptSha256
    || pinned.find((item) => item.id === "originalSource").pin.sha256 !== preparation.sourceSha256))
    throw new Error("CONTROLLED_RENDER_SOURCE_EVIDENCE_INVALID");
  const sdkInstallation = await step(() => pinControlledSdkInstallation(
    join(dirname(fileURLToPath(import.meta.url)), "node_modules"), {checkActive: remainingMilliseconds}));
  const {createFileServer} = await step(() => import("@hyperframes/producer"));
  const engine = await step(() => import("@hyperframes/engine"));
  const media = await step(() => prepareControlledSdkMedia({engine, html, projectDirectory: project, workDirectory: directory,
    fps, durationSeconds: 8, expectedVideoCount: hasVideo ? fixture.document.clips.length : 0,
    expectedAudioCount: hasVideo ? fixture.document.clips.length : 0, signal, remainingMilliseconds}));
  const server = await acquire("server", () => createFileServer({projectDir: project, fps: {num: fps, den: 1}}),
    async value => {
      const handle = value.close();
      if (typeof handle?.once !== "function") throw new Error("CONTROLLED_RENDER_SDK_SERVER_CLOSE_UNCONFIRMED");
      await new Promise((resolveClose, rejectClose) => {handle.once("close", resolveClose); handle.once("error", rejectClose);});
    });
    const session = await acquire("capture", () => engine.createCaptureSession(server.url, frames, {width: 1920, height: 1080,
      fps: {num: fps, den: 1}, format: "png", deviceScaleFactor: 1, compositionDurationSeconds: 8,
      skipReadinessVideoIds: media.videoIds, videoMetadataHints: media.metadataHints}, media.beforeCapture,
    {chromePath: browserPath, enableBrowserPool: false, disableGpu: true, browserGpuMode: "software",
      forceScreenshot: true, staticFrameDedup: false, useDrawElement: false}), value => engine.closeCaptureSession(value));
    const cdp = await acquire("cdp", () => session.page.createCDPSession(), value => value.detach());
    const client = {send: (method, params) => cdp.send(method, params), close: () => {},
      onEvent: (method, handler) => {cdp.on(method, handler); return () => cdp.off(method, handler);}};
    const before = await step(() => readCaptureBrowserIdentity(client));
    // Freeze before any captured frame. Local self-reported baseline, not an operator/image attestation.
    const expectedExecution = controlledRenderExecutionContractSchema.parse({policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1",
      backend: "CONTROLLED", sdkVersion: VERSION, files: executionFiles(pinned), expectedBrowser: before.version,
      comparisonTools: comparisonTools(pinned),
      ...(explicitSdr ? {sdrConversionPolicy: SDR_FRAME_CONVERSION_POLICY.id} : {}),
      ...(explicitSdr && hasVideo ? {sdrAudioMuxPolicy: SDR_AUDIO_MUX_POLICY} : {}),
      seekRepeatabilityPolicy: "EXACT_RGBA_FORWARD_REVERSE_V1"});
    const conformanceContract = buildSnapshotConformanceContract({document: fixture.document, documentHash: fixture.documentHash,
      contractVersion: 4, assets: hasVideo ? [{id: fixture.source.id, checksum: preparation.sourceSha256}]
        : fixture.assets.map(({id, checksum}) => ({id, checksum})),
      renderProfile: {format: "mp4", fps, quality: "high", resolution: "1080p"}, renderExecution: expectedExecution,
      ...(explicitSdr ? {colorTags: true} : {}),
      eventCheckpoints: true, eventBatchIndex: 0,
      ...(hasText ? {fontUsage: true, fontManifest: preparation.fonts} : {})});
    const eventContracts = prepareCompositionEventBatchContracts({document: fixture.document, parentContract: conformanceContract});
    const conformanceContracts = Array.from({length: eventContracts.batchCount}, (_, index) => eventContracts.select(index).contract);
    const textCapture = hasText ? await acquire("text", () => prepareControlledSdkTextBatches({client, document: fixture.document,
      contracts: conformanceContracts, fonts: preparation.fonts, origin: new URL(server.url).origin, signal,
      verifyFiles: async () => {
        for (const id of ["originalFont", "materializedFont"]) {
          const entry = pinned.find(item => item.id === id);
          await step(() => assertConformanceFileUnchanged(entry.path, entry.pin, MAX_PIN_BYTES));
        }
      }}), value => value.close()) : undefined;
    await step(() => engine.initializeSession(session));
    if (textCapture) await step(() => textCapture.loadDeclaredFonts());
    if (session.warnings.length || ["timeout", "script_failure"].includes(session.subTimelineWaitOutcome))
      throw new Error("CONTROLLED_RENDER_CAPTURE_READINESS_FAILED");
    // Reject media/text rather than silently omit extraction, mixing or font verification.
    const unsupported = await step(() => session.page.evaluate((allowVideo) => document.querySelectorAll(
      allowVideo === "native" ? "video,audio" : allowVideo ? "[data-text-clip-id],[data-caption-clip-id]"
        : "video,audio,[data-text-clip-id],[data-caption-clip-id]").length, hasText ? "native" : hasVideo));
    if (unsupported) throw new Error("CONTROLLED_RENDER_UNSUPPORTED_SYNTHETIC_CONTENT");
    for (let index = 0; index < 8 * fps; index++) await step(() => engine.captureFrame(session, index, index / fps));
    media.beginRepeatability();
    const seekRepeatabilityBatches = await step(() => measureControlledEventSeekRepeatability({document: fixture.document,
      contracts: conformanceContracts, signal,
      capture: async (batchIndex, frameIndex, timeSeconds) => {
        const captured = await step(() => engine.captureFrameToBuffer(session, frameIndex, timeSeconds));
        if (textCapture) await step(() => textCapture.observeCapture(batchIndex, frameIndex, timeSeconds));
        return captured.buffer;
      }}));
    const nativeEvidenceBatches = textCapture ? await step(() => textCapture.finish()) : undefined;
    const seekRepeatability = seekRepeatabilityBatches[0], nativeEvidence = nativeEvidenceBatches?.[0];
    const after = await step(() => readCaptureBrowserIdentity(client));
    assertCaptureBrowserIdentityUnchanged(before, after);
    const videoPath = join(directory, "final.mp4"), silentVideoPath = hasVideo ? join(directory, "silent.mp4") : videoPath;
    const sdrEncoding = explicitSdr ? await encodeControlledSdrCapture({controller, expectedExecution,
      profile: {captureProfile: SDR_FRAME_CONVERSION_POLICY.captureProfile, width: 1920, height: 1080, fps, frameCount: 8 * fps},
      framesDirectory: frames, outputParentDirectory: directory, ffmpegPath: ffmpeg,
      ffprobePath: ffprobe, outputPath: silentVideoPath, maximumEncodeMilliseconds: SDK_PROCESS_BUDGETS.encodeMs,
    }) : undefined;
    if (!sdrEncoding) {
      const encoded = await step(() => engine.encodeFramesFromDir(frames, "frame_%06d.png", silentVideoPath,
        {fps: {num: fps, den: 1}, width: 1920, height: 1080, codec: "h264", preset: "medium", quality: 18, pixelFormat: "yuv420p", useGpu: false},
        signal, {ffmpegEncodeTimeout: Math.min(SDK_PROCESS_BUDGETS.encodeMs, remainingMilliseconds())}));
      if (!encoded.success || encoded.framesEncoded !== 8 * fps) throw new Error("CONTROLLED_RENDER_ENCODE_FAILED");
    }
    const silentSdrPin = sdrEncoding && hasVideo ? await step(() => pinConformanceFile(silentVideoPath, MAX_PIN_BYTES)) : undefined;
    const mediaEvidence = await step(() => media.mix());
    if (hasVideo) {
      const muxed = await step(() => engine.muxVideoWithAudio(silentVideoPath, mediaEvidence.audioPath, videoPath, signal,
        {ffmpegProcessTimeout: Math.min(SDK_PROCESS_BUDGETS.muxMs, remainingMilliseconds()), audioCodec: "aac",
          ...(explicitSdr ? {preserveAudioPrimingEditList: true} : {})}, {num: fps, den: 1}));
      if (!muxed.success) throw new Error("CONTROLLED_RENDER_AUDIO_MUX_FAILED");
    }
    const output = await step(() => pinConformanceFile(videoPath, MAX_PIN_BYTES));
    const decode = (binaryPath, decodeArgs, options) => step(() => execute(binaryPath, decodeArgs,
      {...options, signal, env: createControlledProcessEnvironment(), timeout: Math.min(options.timeout, remainingMilliseconds())}));
    const sdrMux = explicitSdr && hasVideo ? await step(() => verifySdrAudioMuxOutput({
      silentVideoPath, silentVideoSha256: sdrEncoding.output.sha256, videoPath, videoSha256: output.sha256,
      ffprobePath: ffprobe, ffprobeSha256: pinned.find(item => item.id === "ffprobe").pin.sha256,
      profile: {width: 1920, height: 1080, fps, frameCount: 8 * fps}, signal,
      timeoutMilliseconds: Math.min(SDK_PROCESS_BUDGETS.probeMs, remainingMilliseconds()),
    }, decode)) : undefined;
    const {stdout} = await decode(ffprobe, ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries",
      "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate", "-of", "json", videoPath],
    {timeout: SDK_PROCESS_BUDGETS.probeMs, maxBuffer: 65536, windowsHide: true});
    const probe = JSON.parse(stdout), stream = probe.streams.find((item) => item.codec_type === "video");
    if (stream?.codec_name !== "h264" || stream.width !== 1920 || stream.height !== 1080
      || stream.avg_frame_rate !== `${fps}/1` || Math.abs(Number(probe.format.duration) - 8) > 1 / fps)
      throw new Error("CONTROLLED_RENDER_OUTPUT_PROFILE_MISMATCH");
    if (hasVideo && !probe.streams.some((item) => item.codec_type === "audio" && item.codec_name === "aac"))
      throw new Error("CONTROLLED_RENDER_AUDIO_STREAM_MISSING");
    const colorAudit = hasVideo || hasText ? undefined : await step(() => auditControlledRenderColor({videoPath, videoSha256: output.sha256,
      ffmpegPath: explicitSdr ? pixelDecoder : ffmpeg,
      ffmpegSha256: pinned.find((item) => item.id === (explicitSdr ? "pixelDecoder" : "ffmpeg")).pin.sha256,
      ...(explicitSdr ? {sdrConversionPolicy: SDR_FRAME_CONVERSION_POLICY.id} : {}),
      plan: fixture.colorAuditPlan, fps, durationSeconds: 8, signal}, decode));
    if (!hasVideo && !hasText && colorAudit.status !== "PASS") throw new Error("CONTROLLED_RENDER_COLOR_AUDIT_FAILED");
    const splitAudit = args.get("--recipe") === "video-split" ? await step(() => auditControlledSplitRender({fps,
      videoPath, videoSha256: output.sha256, sourcePath: files.materializedSource, sourceSha256: preparation.sourceSha256,
      ffmpegPath: ffmpeg, ffmpegSha256: pinned.find((item) => item.id === "ffmpeg").pin.sha256}, decode)) : undefined;
    const trimAudit = args.get("--recipe") === "video-trim" ? await step(() => auditControlledTrimRender({fps,
      videoPath, videoSha256: output.sha256, sourcePath: files.materializedSource, sourceSha256: preparation.sourceSha256,
      ffmpegPath: ffmpeg, ffmpegSha256: pinned.find(item => item.id === "ffmpeg").pin.sha256, signal}, decode)) : undefined;
    const {audioPath: _privateAudioPath, ...publicMediaEvidence} = mediaEvidence;
    for (const item of pinned) {
      try {await step(() => assertConformanceFileUnchanged(item.path, item.pin, MAX_PIN_BYTES));} catch {
        throw new Error(`CONTROLLED_RENDER_PIN_${item.id.replace(/[^a-z]/gi, "_").toUpperCase()}_CHANGED`);
      }
    }
    await step(() => assertConformanceFileUnchanged(videoPath, output, MAX_PIN_BYTES));
    const observedPins = await step(() => Promise.all([...new Set([...Object.values(EXECUTION_ROLES), ...Object.values(COMPARISON_ROLES)])].map(async (id) => {
      const input = pinned.find((item) => item.id === id);
      return {id, pin: await pinConformanceFile(input.path, MAX_PIN_BYTES)};
    })));
    const executionObservation = buildControlledExecutionObservation({expected: expectedExecution, sdrEncoding, sdrMux,
      observation: {policy: expectedExecution.policy, documentHash: fixture.documentHash, videoSha256: output.sha256,
      files: executionFiles(observedPins), comparisonTools: comparisonTools(observedPins),
      browserBefore: before.version, browserAfter: after.version}});
    const executionReport = evaluateControlledRenderExecution({expected: expectedExecution, documentHash: fixture.documentHash,
      videoSha256: output.sha256, observation: executionObservation});
    if (executionReport.status !== "MATCH") throw new Error("CONTROLLED_RENDER_EXECUTION_MISMATCH");
    const completeComparison = buildControlledEventComparisonArtifacts({document: fixture.document,
      parentContract: conformanceContract, observation: executionObservation, videoSha256: output.sha256,
      batches: conformanceContracts.map((contract, index) => ({contract,
        seekRepeatability: seekRepeatabilityBatches[index], nativeEvidence: nativeEvidenceBatches?.[index]}))});
    const comparisons = completeComparison.artifacts;
    const comparison = comparisons[0];
    const comparisonContractPath = join(directory, "comparison-contract.json");
    const comparisonReceiptPath = join(directory, "comparison-receipt.json");
    await step(() => writeFile(comparisonContractPath, JSON.stringify(comparison.contract, null, 2), {flag: "wx", mode: 0o600}));
    await step(() => writeFile(comparisonReceiptPath, JSON.stringify(comparison.receipt, null, 2), {flag: "wx", mode: 0o600}));
    const comparisonPaths = [comparisonContractPath, comparisonReceiptPath];
    for (let index = 1; index < comparisons.length; index++) {
      for (const [kind, value] of [["contract", comparisons[index].contract], ["receipt", comparisons[index].receipt]]) {
        const path = join(directory, `comparison-${kind}-batch-${index}.json`);
        await step(() => writeFile(path, JSON.stringify(value, null, 2), {flag: "wx", mode: 0o600}));
        comparisonPaths.push(path);
      }
    }
    const comparisonPins = await step(() => Promise.all(comparisonPaths
      .map(async (path) => ({path, pin: await pinConformanceFile(path, 1024 * 1024)}))));
    for (const item of comparisonPins) await step(() => assertConformanceFileUnchanged(item.path, item.pin, 1024 * 1024));
    const receiptPath = join(directory, "receipt.json");
    return {receiptPath, receipt: {scope: hasVideo ? "SDK_VIDEO_CORPUS_RENDER_NOT_PRODUCTION_ATTESTATION"
      : hasText ? "SDK_NATIVE_FONT_CORPUS_NOT_PRODUCTION_ATTESTATION" : "SDK_NEUTRAL_CHART_RENDER_SESSION_NOT_PRODUCTION_ATTESTATION",
      sdkVersion: VERSION, browserSession: {scope: before.scope, before: before.version, after: after.version},
      sdkInstallation: sdkInstallation.summary,
      inputs: pinned.map(({id, pin}) => ({id, sha256: pin.sha256, sizeBytes: pin.sizeBytes})),
      documentHash: fixture.documentHash, corpusCaseSha256: fixture.caseSha256, fps, capturedFrames: 8 * fps,
      output: {sha256: output.sha256, sizeBytes: output.sizeBytes}, colorAudit, splitAudit,
      mediaEvidence: publicMediaEvidence, recipeId: hasVideo ? args.get("--recipe") : hasText ? args.get("--native-recipe") : "color-neutral",
      conformanceContract, renderExecution: executionObservation, renderExecutionReport: executionReport,
      ...(sdrEncoding ? {sdrEncoding: {policy: SDR_FRAME_CONVERSION_POLICY.id, scope: SDR_FRAME_CONVERSION_POLICY.scope,
        frames: sdrEncoding.frames, outputProfile: sdrEncoding.outputProfile,
        encoderSha256: sdrEncoding.encoderSha256, probeSha256: sdrEncoding.probeSha256}} : {}),
      ...(sdrMux ? {sdrMux} : {}),
      ...(trimAudit ? {trimAudit} : {}),
      seekRepeatability,
      nativeEvidence,
      eventCoverage: completeComparison.coverage,
      seekRepeatabilityBatches, ...(nativeEvidenceBatches ? {nativeEvidenceBatches} : {}),
      comparisonArtifacts: comparisonPins.map(({path, pin}) => ({file: path.slice(directory.length + 1), sha256: pin.sha256, sizeBytes: pin.sizeBytes})),
      incomplete: ["FULL_PRODUCER_PIPELINE", "EFFECTIVE_FONTS", "SDR_CONVERSION", "ISOLATION_AND_PROCESS_TREE",
        "DEPENDENCY_CLOSURE", "DURABLE_TENANT_JOB_BINDING", "PREVIEW_RENDER_COMPARISON"]},
      output: {receiptPath, comparisonContractPath, comparisonReceiptPath, outputSha256: output.sha256, capturedFrames: 8 * fps},
      async verifyFinalFiles(publisher) {
        if (sdrEncoding) await publisher.step(() => assertSdrFrameSequenceUnchanged(sdrEncoding.frames, publisher.signal));
        if (silentSdrPin) await publisher.step(() => assertConformanceFileUnchanged(silentVideoPath, silentSdrPin, MAX_PIN_BYTES));
        await publisher.step(() => assertControlledSdkInstallationUnchanged(sdkInstallation,
          {checkActive: publisher.remainingMilliseconds}));
        for (const item of pinned) await publisher.step(() => assertConformanceFileUnchanged(item.path, item.pin, MAX_PIN_BYTES));
        for (const item of comparisonPins) await publisher.step(() => assertConformanceFileUnchanged(item.path, item.pin, 1024 * 1024));
        await publisher.step(() => assertConformanceFileUnchanged(videoPath, output, MAX_PIN_BYTES));
      }};
}
void main().catch((error) => {
  const code = error instanceof Error && /^(CONTROLLED_RENDER|CONFORMANCE_FILE|CONFORMANCE_BROWSER)_[A-Z_]+$/.test(error.message)
    ? error.message : "CONTROLLED_RENDER_OBSERVED_NEUTRAL_FAILED";
  process.stderr.write(`${JSON.stringify({code, cleanupCodes: error?.cleanupCodes ?? []})}\n`); process.exitCode = 1;
});
