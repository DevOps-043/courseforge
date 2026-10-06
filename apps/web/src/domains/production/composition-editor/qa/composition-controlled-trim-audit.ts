import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {createHash} from "node:crypto";
import sharp from "sharp";
import {pinConformanceFile, assertConformanceFileUnchanged} from "./composition-conformance-file-integrity";
import {createControlledProcessEnvironment} from "./composition-controlled-process-environment";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";
import {measurePcmSilenceWindows} from "./composition-pcm-silence-windows";

const execute = promisify(execFile);
const SAMPLE_RATE = 48000, CHANNELS = 2, BYTES_PER_SAMPLE = 4;
const MAXIMUM_DECODE_BYTES = 8 * 1024 * 1024;
const TIMELINE_SECONDS = 8, CLIP_START_SECONDS = 1, CLIP_END_SECONDS = 5, SOURCE_OFFSET_SECONDS = 2;
const EXPECTED_GAIN = 0.8, MAXIMUM_RMS_DELTA_DB = 0.5, SILENCE_GUARD_SECONDS = 0.02;
const MAXIMUM_SILENT_RMS = 0.001, MAXIMUM_BACKGROUND_CHANNEL = 50;
const SILENCE_WINDOW_SECONDS = 0.02, SILENCE_HOP_SECONDS = 0.01;
type Decoder = (binary: string, args: string[], options: {timeout: number; maxBuffer: number;
  windowsHide: boolean; encoding: "buffer"; signal?: AbortSignal; env: NodeJS.ProcessEnv}) => Promise<{stdout: Buffer}>;

/** Authored trim fixture only: [1,5), source offset 2 s. Coarse checks, not preview parity or sync. */
export async function auditControlledTrimRender(input: {fps: 24 | 25 | 30 | 60;
  videoPath: string; videoSha256: string; sourcePath: string; sourceSha256: string;
  ffmpegPath: string; ffmpegSha256: string; signal?: AbortSignal}, decode: Decoder = execute) {
  if (![24, 25, 30, 60].includes(input.fps)) throw new Error("CONTROLLED_RENDER_TRIM_ARGUMENT_INVALID");
  assertConformanceJobActive(input.signal);
  const entries = await Promise.all([[input.videoPath, input.videoSha256], [input.sourcePath, input.sourceSha256],
    [input.ffmpegPath, input.ffmpegSha256]].map(async ([path, hash]) => {
    if (!/^[a-f0-9]{64}$/.test(hash!)) throw new Error("CONTROLLED_RENDER_TRIM_HASH_INVALID");
    const pin = await pinConformanceFile(path!, 1024 ** 3);
    if (pin.sha256 !== hash) throw new Error("CONTROLLED_RENDER_TRIM_HASH_MISMATCH");
    return {path: path!, pin};
  }));
  const decodeBytes = async (path: string, start: number, duration?: number) => {
    assertConformanceJobActive(input.signal);
    try {
      const result = await decode(input.ffmpegPath, ["-hide_banner", "-nostdin", "-loglevel", "error", "-protocol_whitelist", "file,pipe",
        "-ss", String(start), "-i", path, ...(duration === undefined
          ? ["-map", "0:v:0", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png"]
          : ["-map", "0:a:0", "-t", String(duration), "-ac", String(CHANNELS), "-ar", String(SAMPLE_RATE),
            "-f", "f32le", "-acodec", "pcm_f32le"]), "-"],
        {timeout: 30000, maxBuffer: MAXIMUM_DECODE_BYTES, windowsHide: true, encoding: "buffer",
          signal: input.signal, env: createControlledProcessEnvironment()});
      assertConformanceJobActive(input.signal);
      if (!Buffer.isBuffer(result.stdout) || !result.stdout.length || result.stdout.length > MAXIMUM_DECODE_BYTES) throw new Error();
      return result.stdout;
    } catch {assertConformanceJobActive(input.signal); throw new Error("CONTROLLED_RENDER_TRIM_DECODE_FAILED");}
  };
  const indexes = [...new Set([0, input.fps - 1, input.fps, input.fps + 1, 3 * input.fps,
    5 * input.fps - 1, 5 * input.fps, 5 * input.fps + 1, 8 * input.fps - 1])];
  const frames = [];
  for (const frameIndex of indexes) {
    const png = await decodeBytes(input.videoPath, frameIndex / input.fps);
    const {data: pixels, info} = await sharp(png, {limitInputPixels: 1920 * 1080}).removeAlpha().raw()
      .toBuffer({resolveWithObject: true}).catch(() => {throw new Error("CONTROLLED_RENDER_TRIM_FRAME_INVALID");});
    if (info.width !== 1920 || info.height !== 1080 || info.channels !== 3) throw new Error("CONTROLLED_RENDER_TRIM_FRAME_INVALID");
    const visible = frameIndex >= CLIP_START_SECONDS * input.fps && frameIndex < CLIP_END_SECONDS * input.fps;
    let sourceFrame: number | null = null;
    if (!visible) {
      if (pixels.some(channel => channel > MAXIMUM_BACKGROUND_CHANNEL)) throw new Error("CONTROLLED_RENDER_TRIM_OUTSIDE_IMAGE_PRESENT");
    } else {
      sourceFrame = 0;
      for (let bit = 0; bit < 10; bit++) {
        const offset = (104 * info.width + 104 + bit * 70) * 3;
        const luminance = (pixels[offset]! + pixels[offset + 1]! + pixels[offset + 2]!) / 3;
        if (luminance > 220) sourceFrame |= 1 << bit;
        else if (luminance > 50) throw new Error("CONTROLLED_RENDER_TRIM_MARKER_INVALID");
      }
      if (sourceFrame !== SOURCE_OFFSET_SECONDS * input.fps + frameIndex - CLIP_START_SECONDS * input.fps)
        throw new Error("CONTROLLED_RENDER_TRIM_SOURCE_TIME_MISMATCH");
    }
    frames.push({frameIndex, sourceFrame, visible, pngSha256: createHash("sha256").update(png).digest("hex")});
  }
  const reference = await decodeBytes(input.sourcePath, SOURCE_OFFSET_SECONDS, CLIP_END_SECONDS - CLIP_START_SECONDS);
  const rendered = await decodeBytes(input.videoPath, 0, TIMELINE_SECONDS);
  const stride = CHANNELS * BYTES_PER_SAMPLE, renderedFrames = TIMELINE_SECONDS * SAMPLE_RATE;
  if (reference.length !== (CLIP_END_SECONDS - CLIP_START_SECONDS) * SAMPLE_RATE * stride
    || rendered.length < renderedFrames * stride || rendered.length > (renderedFrames + 1024) * stride || rendered.length % stride)
    throw new Error("CONTROLLED_RENDER_TRIM_AUDIO_LENGTH_INVALID");
  // Validate every sample, including padding and the explicitly unmeasured boundary guard.
  for (const pcm of [reference, rendered]) for (let offset = 0; offset < pcm.length; offset += BYTES_PER_SAMPLE)
    if (!Number.isFinite(pcm.readFloatLE(offset))) throw new Error("CONTROLLED_RENDER_TRIM_AUDIO_INVALID");
  let maximumRmsDeltaDb = 0, maximumSilentRms = 0, silenceWindowCount = 0;
  for (let channel = 0; channel < CHANNELS; channel++) {
    for (let window = 0; window < 8; window++) {
      let expectedPower = 0, observedPower = 0;
      for (let frame = window * SAMPLE_RATE / 2; frame < (window + 1) * SAMPLE_RATE / 2; frame++) {
        expectedPower += (reference.readFloatLE(frame * stride + channel * BYTES_PER_SAMPLE) * EXPECTED_GAIN) ** 2;
        observedPower += rendered.readFloatLE((frame + CLIP_START_SECONDS * SAMPLE_RATE) * stride + channel * BYTES_PER_SAMPLE) ** 2;
      }
      if (expectedPower < 0.001 || observedPower < 0.001) throw new Error("CONTROLLED_RENDER_TRIM_AUDIO_SIGNAL_MISSING");
      maximumRmsDeltaDb = Math.max(maximumRmsDeltaDb, Math.abs(10 * Math.log10(observedPower / expectedPower)));
      if (maximumRmsDeltaDb > MAXIMUM_RMS_DELTA_DB) throw new Error("CONTROLLED_RENDER_TRIM_AUDIO_GAIN_MISMATCH");
    }
  }
  for (const [start, end] of [[0, CLIP_START_SECONDS - SILENCE_GUARD_SECONDS],
    [CLIP_END_SECONDS + SILENCE_GUARD_SECONDS, TIMELINE_SECONDS]]) {
    assertConformanceJobActive(input.signal);
    const measurement = measurePcmSilenceWindows({pcm: rendered, channelCount: CHANNELS,
      startFrame: Math.ceil(start! * SAMPLE_RATE), endFrame: Math.floor(end! * SAMPLE_RATE),
      windowFrames: Math.round(SILENCE_WINDOW_SECONDS * SAMPLE_RATE), hopFrames: Math.round(SILENCE_HOP_SECONDS * SAMPLE_RATE)});
    maximumSilentRms = Math.max(maximumSilentRms, measurement.maximumRms);
    silenceWindowCount += measurement.windowCount;
    if (maximumSilentRms > MAXIMUM_SILENT_RMS) throw new Error("CONTROLLED_RENDER_TRIM_OUTSIDE_AUDIO_PRESENT");
  }
  await Promise.all(entries.map(({path, pin}) => assertConformanceFileUnchanged(path, pin, 1024 ** 3)));
  assertConformanceJobActive(input.signal);
  return {scope: "AUTHORED_TRIM_MARKERS_COARSE_BACKGROUND_AND_AUDIO_NOT_PREVIEW_PARITY_OR_SYNC" as const,
    status: "PASS" as const, videoSha256: input.videoSha256, sourceSha256: input.sourceSha256,
    decoderSha256: input.ffmpegSha256, frames, audio: {windowCount: 16, maximumRmsDeltaDb, maximumSilentRms,
      silenceWindowCount, silenceWindowSeconds: SILENCE_WINDOW_SECONDS, silenceHopSeconds: SILENCE_HOP_SECONDS,
      silenceGuardSeconds: SILENCE_GUARD_SECONDS, referencePcmSha256: createHash("sha256").update(reference).digest("hex"),
      renderedPcmSha256: createHash("sha256").update(rendered).digest("hex")}};
}
