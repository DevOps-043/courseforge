import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {createHash} from "node:crypto";
import sharp from "sharp";
import {pinConformanceFile, assertConformanceFileUnchanged} from "./composition-conformance-file-integrity";

const execute = promisify(execFile);
const SAMPLE_RATE = 48000, CHANNELS = 2, DURATION_SECONDS = 8, EXPECTED_GAIN = 0.8;
type Decoder = (binary: string, args: string[], options: {timeout: number; maxBuffer: number; windowsHide: boolean;
  encoding: "buffer"}) => Promise<{stdout: Buffer}>;

/** Independent authored split fixture: offset 1 s, split at 3 s, unchanged continuous source and gain 0.8. */
export async function auditControlledSplitRender(input: {fps: 24 | 25 | 30 | 60; videoPath: string; videoSha256: string;
  sourcePath: string; sourceSha256: string; ffmpegPath: string; ffmpegSha256: string}, decode: Decoder = execute) {
  if (![24, 25, 30, 60].includes(input.fps)) throw new Error("CONTROLLED_RENDER_SPLIT_AUDIT_ARGUMENT_INVALID");
  const entries = [{path: input.videoPath, hash: input.videoSha256}, {path: input.sourcePath, hash: input.sourceSha256},
    {path: input.ffmpegPath, hash: input.ffmpegSha256}];
  const pinned = await Promise.all(entries.map(async (entry) => {
    const pin = await pinConformanceFile(entry.path, 1024 ** 3);
    if (pin.sha256 !== entry.hash) throw new Error("CONTROLLED_RENDER_SPLIT_AUDIT_HASH_MISMATCH");
    return {...entry, pin};
  }));
  const decodeBytes = async (path: string, time: number, format: "png" | "f32le") => {
    try {
      const {stdout} = await decode(input.ffmpegPath, ["-hide_banner", "-nostdin", "-loglevel", "error", "-protocol_whitelist", "file,pipe",
        "-ss", String(time), "-i", path, ...(format === "png" ? ["-map", "0:v:0", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png"]
          : ["-map", "0:a:0", "-t", String(DURATION_SECONDS), "-ac", String(CHANNELS), "-ar", String(SAMPLE_RATE), "-f", "f32le", "-acodec", "pcm_f32le"]), "-"],
      {timeout: 30000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, encoding: "buffer"});
      if (!stdout.length || stdout.length > 8 * 1024 * 1024) throw new Error();
      return stdout;
    } catch {throw new Error("CONTROLLED_RENDER_SPLIT_AUDIT_DECODE_FAILED");}
  };
  const frameIndices = [0, 3 * input.fps - 1, 3 * input.fps, 3 * input.fps + 1, 4 * input.fps, 8 * input.fps - 1];
  const frames = [];
  for (const frameIndex of frameIndices) {
    const png = await decodeBytes(input.videoPath, frameIndex / input.fps, "png");
    const {data: pixels, info} = await sharp(png, {limitInputPixels: 1920 * 1080}).ensureAlpha().raw().toBuffer({resolveWithObject: true});
    if (info.width !== 1920 || info.height !== 1080 || info.channels !== 4) throw new Error("CONTROLLED_RENDER_SPLIT_AUDIT_FRAME_INVALID");
    let decodedSourceFrame = 0;
    for (let bit = 0; bit < 10; bit++) {
      const offset = (104 * info.width + 104 + bit * 70) * 4;
      const luminance = (pixels[offset]! + pixels[offset + 1]! + pixels[offset + 2]!) / 3;
      if (luminance > 220) decodedSourceFrame |= 1 << bit;
      else if (luminance > 50) throw new Error("CONTROLLED_RENDER_SPLIT_AUDIT_MARKER_INVALID");
    }
    const expectedSourceFrame = input.fps + frameIndex;
    if (decodedSourceFrame !== expectedSourceFrame) throw new Error("CONTROLLED_RENDER_SPLIT_AUDIT_SOURCE_TIME_MISMATCH");
    frames.push({frameIndex, expectedSourceFrame, decodedSourceFrame, pngSha256: createHash("sha256").update(png).digest("hex")});
  }
  const source = await decodeBytes(input.sourcePath, 1, "f32le"), rendered = await decodeBytes(input.videoPath, 0, "f32le");
  const expectedFrames = SAMPLE_RATE * DURATION_SECONDS;
  if (source.length !== expectedFrames * CHANNELS * 4 || rendered.length < source.length
    || rendered.length > source.length + 1024 * CHANNELS * 4 || rendered.length % (CHANNELS * 4))
    throw new Error("CONTROLLED_RENDER_SPLIT_AUDIT_AUDIO_LENGTH_INVALID");
  let maximumRmsDeltaDb = 0;
  for (let window = 0; window < 16; window++) for (let channel = 0; channel < CHANNELS; channel++) {
    let referencePower = 0, renderedPower = 0;
    for (let frame = window * SAMPLE_RATE / 2; frame < (window + 1) * SAMPLE_RATE / 2; frame++) {
      const offset = (frame * CHANNELS + channel) * 4;
      const reference = source.readFloatLE(offset) * EXPECTED_GAIN, sample = rendered.readFloatLE(offset);
      if (!Number.isFinite(reference) || !Number.isFinite(sample)) throw new Error("CONTROLLED_RENDER_SPLIT_AUDIT_AUDIO_INVALID");
      referencePower += reference ** 2; renderedPower += sample ** 2;
    }
    if (referencePower < 0.001 || renderedPower < 0.001) throw new Error("CONTROLLED_RENDER_SPLIT_AUDIT_AUDIO_SILENT");
    const delta = Math.abs(10 * Math.log10(renderedPower / referencePower));
    maximumRmsDeltaDb = Math.max(delta, maximumRmsDeltaDb);
    if (delta > 0.5) throw new Error("CONTROLLED_RENDER_SPLIT_AUDIT_AUDIO_GAIN_MISMATCH");
  }
  await Promise.all(pinned.map((entry) => assertConformanceFileUnchanged(entry.path, entry.pin, 1024 ** 3)));
  return {scope: "AUTHORED_SPLIT_MARKERS_AND_COARSE_AUDIO_GAIN_NOT_PREVIEW_PARITY" as const,
    videoSha256: input.videoSha256, sourceSha256: input.sourceSha256, decoderSha256: input.ffmpegSha256,
    frames, audio: {windowCount: 32, maximumRmsDeltaDb, sourcePcmSha256: createHash("sha256").update(source).digest("hex"),
      renderedPcmSha256: createHash("sha256").update(rendered).digest("hex")}, status: "PASS" as const};
}
