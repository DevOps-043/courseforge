import {createRequire} from "node:module";
import {dirname, join, resolve, relative, isAbsolute, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {copyFile, constants} from "node:fs/promises";
import {performance} from "node:perf_hooks";
import {executeClosedStageFile} from "./closed-stage-executor.mjs";
const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"));
const compiled = "./dist/composition-worker/domains/production/composition-editor/";
const {compositionConformanceContractSchema} = require(`${compiled}composition-preview-render-conformance.js`);
const {SDR_FRAME_CONVERSION_POLICY, SDR_AUDIO_MUX_POLICY} = require(`${compiled}composition-sdr-conversion-policy.js`);
const {encodeSdrCapturedFrames} = require(`${compiled}qa/composition-sdr-frame-encoder.js`);
const {verifySdrAudioMuxOutput, verifySdrSilentAssemblyOutput} = require(`${compiled}qa/composition-sdr-mux-verification.js`);
const {pinConformanceFile, assertConformanceFileUnchanged} = require(`${compiled}qa/composition-conformance-file-integrity.js`);
const fail = () => {throw new Error("CONTROLLED_RENDER_ORIGINAL_SDR_STAGE_FAILED");};
export const ORIGINAL_SDR_STAGE_TIMEOUT_MILLISECONDS = 600000;

/** Host-fixed V4 stage adapter. Work files remain owned by the enclosing job, never a client. */
export function createOriginalSessionSdrStages(input, ports = {}) {
  const contract = compositionConformanceContractSchema.parse(input.contract);
  const execution = contract.renderExecution;
  if (execution?.sdrConversionPolicy !== SDR_FRAME_CONVERSION_POLICY.id
    || !(input.signal instanceof AbortSignal) || !isAbsolute(input.outputDirectory)
    || !isAbsolute(input.videoPath) || resolve(input.videoPath) !== join(resolve(input.outputDirectory), "video.mp4")
    || !Number.isSafeInteger(input.timeoutMilliseconds) || input.timeoutMilliseconds < 1 || input.timeoutMilliseconds > 600000
    || typeof input.acquireFrames !== "function" || typeof input.verifyFiles !== "function") fail();
  const execute = ports.execute ?? executeClosedStageFile;
  let phase = "WAITING", encoding, mux, silentAssembly, archived, silentPath, finalPin;
  const active = () => {input.signal.throwIfAborted(); if (phase === "FAILED") fail();};
  const verify = async () => {active(); await input.verifyFiles(); active();};
  const match = payload => {
    const canvas = contract.canvas;
    if (payload.signal !== input.signal || payload.width !== canvas.width || payload.height !== canvas.height
      || payload.fps !== canvas.fps || payload.frameCount !== Math.ceil(canvas.durationSeconds * canvas.fps)
      || payload.outputPath !== input.videoPath || payload.hasAudio !== Boolean(execution.sdrAudioMuxPolicy)
      || !isAbsolute(payload.videoOnlyPath) || payload.videoOnlyPath === input.videoPath) fail();
    const suffix = relative(input.outputDirectory, payload.videoOnlyPath);
    // SDK work path must not alias our retained frames/encoded/final output tree.
    if (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`)) fail();
  };
  return {onEncode: async payload => {
    const started = performance.now();
    try {
      active(); match(payload); if (phase !== "WAITING") fail(); phase = "ENCODING";
      await verify(); archived = await input.acquireFrames(); await archived.assertUnchanged();
      encoding = await encodeSdrCapturedFrames({profile: {captureProfile: SDR_FRAME_CONVERSION_POLICY.captureProfile,
        width: payload.width, height: payload.height, fps: payload.fps, frameCount: payload.frameCount},
        framesDirectory: archived.directory, outputParentDirectory: input.outputDirectory,
        ffmpegPath: input.encoderPath, ffmpegSha256: execution.files.encoder.sha256,
        ffprobePath: input.probePath, ffprobeSha256: execution.comparisonTools.probe.sha256,
        timeoutMilliseconds: input.timeoutMilliseconds, signal: input.signal, retainWorkFilesOnFailure: true}, execute);
      await verify(); await archived.assertUnchanged();
      await copyFile(encoding.videoPath, payload.videoOnlyPath, constants.COPYFILE_EXCL);
      silentPath = payload.videoOnlyPath;
      const silent = await pinConformanceFile(silentPath, 2 * 1024 ** 3, false, input.signal);
      if (silent.sha256 !== encoding.output.sha256 || silent.sizeBytes !== encoding.output.sizeBytes) fail();
      await assertConformanceFileUnchanged(encoding.videoPath, encoding.output, 2 * 1024 ** 3, false, input.signal);
      phase = "ENCODED"; return {encodeMs: performance.now() - started};
    } catch {phase = "FAILED"; fail();}
  }, onAfterAssemble: async payload => {
    try {
      active(); match(payload); if (phase !== "ENCODED" || payload.videoOnlyPath !== silentPath) fail(); phase = "VERIFYING";
      await verify(); await archived.assertUnchanged();
      finalPin = await pinConformanceFile(input.videoPath, 2 * 1024 ** 3, false, input.signal);
      const verification = {silentVideoPath: silentPath, silentVideoSha256: encoding.output.sha256,
          videoPath: input.videoPath, videoSha256: finalPin.sha256, ffprobePath: input.probePath,
          ffprobeSha256: execution.comparisonTools.probe.sha256, profile: encoding.profile,
          timeoutMilliseconds: input.timeoutMilliseconds, signal: input.signal};
      if (execution.sdrAudioMuxPolicy) {
        mux = await verifySdrAudioMuxOutput(verification, execute);
        if (mux.policy !== SDR_AUDIO_MUX_POLICY) fail();
      } else silentAssembly = await verifySdrSilentAssemblyOutput(verification, execute);
      await verify(); phase = "VERIFIED";
    } catch {phase = "FAILED"; fail();}
  }, async finalize() {
    try {
      active(); if (phase !== "VERIFIED") fail(); await verify(); await archived.assertUnchanged();
      await assertConformanceFileUnchanged(encoding.videoPath, encoding.output, 2 * 1024 ** 3, false, input.signal);
      await assertConformanceFileUnchanged(input.videoPath, finalPin, 2 * 1024 ** 3, false, input.signal);
      return {sdrEncoding: encoding, ...(mux ? {sdrMux: mux} : {}), ...(silentAssembly ? {sdrSilentAssembly: silentAssembly} : {})};
    } catch {phase = "FAILED"; fail();}
  }};
}
