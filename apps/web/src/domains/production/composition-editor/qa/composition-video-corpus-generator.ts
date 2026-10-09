import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import {pinConformanceFile} from "./composition-conformance-file-integrity";
import sharp from "sharp";
import { createCorpusStereoAudio } from "./composition-conformance-corpus-assets";
import { extractDecodedCorpusPcm, measureVideoCorpusDecodedAudio } from "./composition-video-corpus-audio-evidence";
import { buildVideoCorpusEncodingArguments, buildVideoConformanceCorpusCase, listVideoConformanceCorpusRecipes,
  VIDEO_CORPUS_SOURCE_DURATION_SECONDS, type VideoCorpusSource } from "./composition-video-conformance-corpus";
import { NATIVE_CONFORMANCE_CORPUS_FPS } from "./composition-native-conformance-corpus";
import { parseExportedFrameTimes, parseExportedVideoProbe } from "./composition-exported-video-conformance";
import { VIDEO_CORPUS_SOURCE_DURATION_SECONDS as FRAME_SOURCE_DURATION_SECONDS,
  videoCorpusFramePath, writeVideoCorpusFrames } from "./composition-video-corpus-frames";

const executeFile = promisify(execFile);
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_EXECUTABLE_BYTES = 1024 ** 3;
const PROCESS_OUTPUT_LIMIT = 128 * 1024;
const MAX_DECODED_PNG_BYTES = 8 * 1024 * 1024;
const MAX_DECODED_AUDIO_BYTES = 3 * 1024 * 1024;
type CorpusProcessExecutor = (binary: string, args: string[], options: {timeout: number; maxBuffer: number; windowsHide: boolean;
  encoding: "utf8"; signal?: AbortSignal}) => Promise<{stdout: string}>;
type CorpusFrameDecoder = (binary: string, videoPath: string, timeSeconds: number, signal?: AbortSignal) => Promise<Buffer>;
type CorpusAudioDecoder = (binary: string, videoPath: string, signal?: AbortSignal) => Promise<Buffer>;

const decodeFrame: CorpusFrameDecoder = async (binary, videoPath, timeSeconds, signal) => {
  const {stdout} = await executeFile(binary, ["-hide_banner", "-nostdin", "-loglevel", "error", "-ss", String(timeSeconds),
    "-i", videoPath, "-map", "0:v:0", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
  {timeout: 30_000, maxBuffer: MAX_DECODED_PNG_BYTES, windowsHide: true, encoding: "buffer", signal});
  return Buffer.from(stdout);
};

const decodeAudio: CorpusAudioDecoder = async (binary, videoPath, signal) => {
  const {stdout} = await executeFile(binary, ["-hide_banner", "-nostdin", "-loglevel", "error", "-i", videoPath,
    "-map", "0:a:0", "-vn", "-ac", "2", "-ar", "48000", "-f", "wav", "-acodec", "pcm_s16le", "-"],
  {timeout: 60_000, maxBuffer: MAX_DECODED_AUDIO_BYTES, windowsHide: true, encoding: "buffer", signal});
  return extractDecodedCorpusPcm(Buffer.from(stdout));
};

async function hashRegularFile(path: string, maximumBytes: number, signal?: AbortSignal) {
  try {return await pinConformanceFile(path, maximumBytes, false, signal);}
  catch (error) {
    if (signal?.aborted) throw new Error("CONFORMANCE_CORPUS_ABORTED");
    throw new Error(error instanceof Error && error.message === "CONFORMANCE_FILE_INTEGRITY_MISMATCH"
      ? "CONFORMANCE_CORPUS_FILE_CHANGED" : "CONFORMANCE_CORPUS_FILE_INVALID");
  }
}

/** Explicit local fixture generation only: never a gate PASS or provider attestation. */
export async function generateVideoConformanceCorpusSource(input: {
  outputParentDirectory: string; ffmpegPath: string; ffprobePath: string;
  fps: typeof NATIVE_CONFORMANCE_CORPUS_FPS[number]; signal?: AbortSignal;
}, execute: CorpusProcessExecutor = executeFile, writeFrames: typeof writeVideoCorpusFrames = writeVideoCorpusFrames,
decode: CorpusFrameDecoder = decodeFrame, decodeAudioTrack: CorpusAudioDecoder = decodeAudio) {
  const {outputParentDirectory, ffmpegPath, ffprobePath, fps, signal} = input;
  if (![outputParentDirectory, ffmpegPath, ffprobePath].every((path) => isAbsolute(path) && !path.includes("\0"))
    || !NATIVE_CONFORMANCE_CORPUS_FPS.includes(fps)) throw new Error("CONFORMANCE_CORPUS_ARGUMENTS_INVALID");
  const parent = await lstat(outputParentDirectory);
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error("CONFORMANCE_CORPUS_DIRECTORY_INVALID");
  const assertActive = () => {if (signal?.aborted) throw new Error("CONFORMANCE_CORPUS_ABORTED");};
  assertActive();
  const [encoderBefore, probeBefore] = await Promise.all([hashRegularFile(ffmpegPath, MAX_EXECUTABLE_BYTES, signal), hashRegularFile(ffprobePath, MAX_EXECUTABLE_BYTES, signal)]);
  const directory = await mkdtemp(join(outputParentDirectory, "composition-video-corpus-"));
  const audioPath = join(directory, "source.wav"), videoPath = join(directory, "source.mp4"), receiptPath = join(directory, "source-receipt.json");
  let completed = false;
  let stage: "FRAME_GENERATION" | "ENCODE" | "STREAM_PROBE" | "FRAME_PROBE" | "FRAME_DECODE" | "AUDIO_DECODE" | "INTEGRITY" | "RECEIPT" = "FRAME_GENERATION";
  try {
    const audio = createCorpusStereoAudio("VOICE");
    await writeFile(audioPath, audio.bytes, {flag: "wx", mode: 0o600});
    const audioBefore = await hashRegularFile(audioPath, audio.bytes.length, signal);
    if (audioBefore.sha256 !== audio.checksum) throw new Error("CONFORMANCE_CORPUS_INTEGRITY_CHANGED");
    assertActive();
    const generatedFrameCount = await writeFrames(directory, fps, signal);
    if (generatedFrameCount !== FRAME_SOURCE_DURATION_SECONDS * fps) throw new Error("CONFORMANCE_CORPUS_FRAME_COUNT_INVALID");
    stage = "ENCODE";
    await execute(ffmpegPath, buildVideoCorpusEncodingArguments({fps, frameDirectory: directory, audioPath, outputPath: videoPath}),
      {timeout: 5 * 60 * 1000, maxBuffer: PROCESS_OUTPUT_LIMIT, windowsHide: true, encoding: "utf8", signal});
    assertActive();
    for (let frameIndex = 0; frameIndex < generatedFrameCount; frameIndex++)
      await rm(videoCorpusFramePath(directory, frameIndex), {force: true});
    stage = "STREAM_PROBE";
    const before = await hashRegularFile(videoPath, MAX_VIDEO_BYTES, signal);
    const {stdout} = await execute(ffprobePath, ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries",
      "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,sample_rate,channels", "-of", "json", videoPath],
      {timeout: 30_000, maxBuffer: PROCESS_OUTPUT_LIMIT, windowsHide: true, encoding: "utf8", signal});
    assertActive();
    if (Buffer.byteLength(stdout, "utf8") > PROCESS_OUTPUT_LIMIT) throw new Error("CONFORMANCE_CORPUS_PROBE_LIMIT");
    const raw = JSON.parse(stdout) as {streams?: Array<{codec_type?: string; codec_name?: string; channels?: number; sample_rate?: string}>};
    const probe = parseExportedVideoProbe(raw), audioStream = raw.streams?.find((stream) => stream.codec_type === "audio");
    if (probe.width !== 1920 || probe.height !== 1080 || probe.fps !== fps || probe.codec !== "h264" || !probe.hasAudio
      || Math.abs(probe.durationSeconds - VIDEO_CORPUS_SOURCE_DURATION_SECONDS) > 1 / fps
      || audioStream?.codec_name !== "aac" || audioStream.channels !== 2 || audioStream.sample_rate !== "48000")
      throw new Error("CONFORMANCE_CORPUS_PROBE_MISMATCH");
    const expectedFrameCount = VIDEO_CORPUS_SOURCE_DURATION_SECONDS * fps;
    stage = "FRAME_PROBE";
    const frameProbe = await execute(ffprobePath, ["-v", "error", "-protocol_whitelist", "file,pipe", "-select_streams", "v:0",
      "-show_entries", "frame=best_effort_timestamp_time", "-of", "csv=p=0", videoPath],
    {timeout: 60_000, maxBuffer: PROCESS_OUTPUT_LIMIT, windowsHide: true, encoding: "utf8", signal});
    assertActive();
    if (Buffer.byteLength(frameProbe.stdout, "utf8") > PROCESS_OUTPUT_LIMIT) throw new Error("CONFORMANCE_CORPUS_FRAME_PROBE_LIMIT");
    const timeline = parseExportedFrameTimes(frameProbe.stdout, [0, expectedFrameCount - 1],
      {expectedFrameCount, fps, maxTemporalDriftFrames: 0.5});
    stage = "FRAME_DECODE";
    const decodedFrames = [] as Array<{timeSeconds: number; pngSha256: string; pixelSha256: string}>;
    for (const timeSeconds of [0, VIDEO_CORPUS_SOURCE_DURATION_SECONDS / 2]) {
      const png = await decode(ffmpegPath, videoPath, timeSeconds, signal);
      if (png.length <= 0 || png.length > MAX_DECODED_PNG_BYTES) throw new Error("CONFORMANCE_CORPUS_DECODE_SIZE_INVALID");
      const metadata = await sharp(png, {limitInputPixels: 1920 * 1080}).metadata();
      if (metadata.format !== "png" || metadata.width !== 1920 || metadata.height !== 1080)
        throw new Error("CONFORMANCE_CORPUS_DECODE_FRAME_INVALID");
      const pixels = await sharp(png, {limitInputPixels: 1920 * 1080}).ensureAlpha().raw().toBuffer();
      if (pixels.length !== 1920 * 1080 * 4) throw new Error("CONFORMANCE_CORPUS_DECODE_PIXELS_INVALID");
      decodedFrames.push({timeSeconds, pngSha256: createHash("sha256").update(png).digest("hex"),
        pixelSha256: createHash("sha256").update(pixels).digest("hex")});
    }
    if (decodedFrames[0]!.pixelSha256 === decodedFrames[1]!.pixelSha256)
      throw new Error("CONFORMANCE_CORPUS_STATIC_VIDEO_INVALID");
    stage = "AUDIO_DECODE";
    const decodedAudio = measureVideoCorpusDecodedAudio(audio.bytes, await decodeAudioTrack(ffmpegPath, videoPath, signal));
    assertActive();
    stage = "INTEGRITY";
    const [after, encoderAfter, probeAfter, audioAfter] = await Promise.all([hashRegularFile(videoPath, MAX_VIDEO_BYTES, signal),
      hashRegularFile(ffmpegPath, MAX_EXECUTABLE_BYTES, signal), hashRegularFile(ffprobePath, MAX_EXECUTABLE_BYTES, signal), hashRegularFile(audioPath, audio.bytes.length, signal)]);
    if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(encoderBefore) !== JSON.stringify(encoderAfter)
      || JSON.stringify(probeBefore) !== JSON.stringify(probeAfter) || JSON.stringify(audioBefore) !== JSON.stringify(audioAfter))
      throw new Error("CONFORMANCE_CORPUS_INTEGRITY_CHANGED");
    const source: VideoCorpusSource = {id: "27000000-0000-4000-8000-000000000004", checksum: before.sha256,
      sizeBytes: before.sizeBytes, durationSeconds: VIDEO_CORPUS_SOURCE_DURATION_SECONDS, fps, width: 1920, height: 1080, hasAudio: true, mimeType: "video/mp4"};
    const receipt = {schemaVersion: 1, scope: "LOCAL_ENCODING_AND_PROBE_NOT_RENDER_PARITY" as const, source,
      audioSourceSha256: audio.checksum, encoderExecutableSha256: encoderBefore.sha256, probeExecutableSha256: probeBefore.sha256,
      observedDurationSeconds: probe.durationSeconds,
      frameCount: timeline.frameCount, maxTimelineDriftFrames: timeline.maxTimelineDriftFrames,
      decodedFrames, decodedAudio,
      cases: listVideoConformanceCorpusRecipes().map((id) => {
        const recipe = buildVideoConformanceCorpusCase(id, source);
        return {recipeId: id, caseSha256: recipe.caseSha256, documentHash: recipe.documentHash};
      }), limitations: ["NOT_RENDER_PARITY_OR_QA_APPROVAL", "TWO_DECODED_FRAMES_NOT_FULL_VISUAL_PARITY",
        "LOCAL_AUDIO_RMS_NOT_IDENTITY_OR_REMOTE_SYNC",
        "COLOR_TAGS_NOT_CONVERSION_PROOF", "ENCODER_BUILD_CHANGES_SOURCE_HASH"]};
    assertActive();
    stage = "RECEIPT";
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2), {flag: "wx", mode: 0o600});
    completed = true;
    return {directory, videoPath, audioPath, receiptPath, receipt};
  } catch (error) {
    // No subprocess stderr, paths, provider text or stack traces cross this boundary.
    if (signal?.aborted) throw new Error("CONFORMANCE_CORPUS_ABORTED");
    const code = error instanceof Error && /^CONFORMANCE_CORPUS_[A-Z_]+$/.test(error.message)
      ? error.message : `CONFORMANCE_CORPUS_${stage}_FAILED`;
    throw new Error(code);
  } finally {
    if (!completed) {
      // Delete only exact files in our fresh directory, never recurse into unknown stage output.
      await Promise.all([audioPath, videoPath, receiptPath].map((path) => rm(path, {force: true})));
      for (let frameIndex = 0; frameIndex < FRAME_SOURCE_DURATION_SECONDS * fps; frameIndex++)
        await rm(videoCorpusFramePath(directory, frameIndex), {force: true});
      try {await rmdir(directory);} catch {throw new Error("CONFORMANCE_CORPUS_CLEANUP_FAILED");}
    }
  }
}
