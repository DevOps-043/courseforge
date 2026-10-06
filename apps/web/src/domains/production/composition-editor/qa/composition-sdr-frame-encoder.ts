import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp, rm, rmdir} from "node:fs/promises";
import {join, resolve} from "node:path";
import {z} from "zod";
import {performance} from "node:perf_hooks";
import {pinConformanceFile, assertConformanceFileUnchanged} from "./composition-conformance-file-integrity";
import {createControlledProcessEnvironment} from "./composition-controlled-process-environment";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";
import {pinSdrFrameSequence, assertSdrFrameSequenceUnchanged} from "./composition-sdr-frame-sequence";
import {validateSdrEncodedOutput} from "./composition-sdr-output-profile";
import {SDR_FRAME_CONVERSION_POLICY, sdrFrameCaptureProfileSchema as profileSchema} from "../composition-sdr-conversion-policy";
export {SDR_FRAME_CONVERSION_POLICY} from "../composition-sdr-conversion-policy";

/** Fixed transform pair; declared capture profile is a precondition, not its attestation.
 * FFmpeg n6.1 vf_zscale: explicit matrix/primaries/TRC/range, no autodetection or tone map. */
type Profile = z.infer<typeof profileSchema>;

export function buildSdrFrameEncoderArguments(input: Profile & {framesDirectory: string; outputPath: string}) {
  const {framesDirectory, outputPath, ...rawProfile} = input;
  const profile = profileSchema.parse(rawProfile);
  return ["-hide_banner", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-n",
    "-framerate", String(profile.fps), "-start_number", "0", "-i", join(resolve(framesDirectory), "frame_%06d.png"),
    "-map", "0:v:0", "-an", "-frames:v", String(profile.frameCount),
    "-vf", SDR_FRAME_CONVERSION_POLICY.encodeFilter, "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-pix_fmt", "yuv420p", "-colorspace:v", "bt709", "-color_primaries:v", "bt709", "-color_trc:v", "bt709",
    "-color_range", "tv", "-chroma_sample_location", "left", "-video_track_timescale", "90000",
    "-movflags", "+faststart", "-f", "mp4", resolve(outputPath)];
}

type EncoderExecutor = (binary: string, args: string[], options: {timeout: number; maxBuffer: number;
  windowsHide: boolean; signal?: AbortSignal; env: NodeJS.ProcessEnv}) => Promise<unknown>;
const executeFile = promisify(execFile);

/** Trusted materialized frames only, no endpoint. Missing zscale/codec fails without fallback.
 * Caller owns/validates the immutable frame sequence and effective capture profile. */
export async function encodeSdrCapturedFrames(input: {profile: Profile; framesDirectory: string;
  outputParentDirectory: string; ffmpegPath: string; ffmpegSha256: string; timeoutMilliseconds: number;
  ffprobePath: string; ffprobeSha256: string;
  signal?: AbortSignal}, execute: EncoderExecutor = executeFile) {
  assertConformanceJobActive(input.signal);
  const profile = profileSchema.parse(input.profile);
  if (!/^[a-f0-9]{64}$/.test(input.ffmpegSha256) || !/^[a-f0-9]{64}$/.test(input.ffprobeSha256) || !Number.isSafeInteger(input.timeoutMilliseconds)
    || input.timeoutMilliseconds < 1 || input.timeoutMilliseconds > 600000) throw new Error("SDR_FRAME_ENCODER_INPUT_INVALID");
  const startedAt = performance.now();
  const remainingMilliseconds = () => {
    assertConformanceJobActive(input.signal);
    const remaining = input.timeoutMilliseconds - (performance.now() - startedAt);
    if (remaining <= 0) throw new Error("SDR_FRAME_ENCODER_DEADLINE_TIMEOUT");
    return Math.max(1, Math.floor(remaining));
  };
  const binary = await pinConformanceFile(input.ffmpegPath, 1024 ** 3);
  if (binary.sha256 !== input.ffmpegSha256) throw new Error("SDR_FRAME_ENCODER_BINARY_MISMATCH");
  const probePin = await pinConformanceFile(input.ffprobePath, 1024 ** 3);
  if (probePin.sha256 !== input.ffprobeSha256) throw new Error("SDR_FRAME_PROBE_BINARY_MISMATCH");
  const frames = await pinSdrFrameSequence({directory: input.framesDirectory, width: profile.width,
    height: profile.height, frameCount: profile.frameCount, signal: input.signal});
  assertConformanceJobActive(input.signal);
  remainingMilliseconds();
  const directory = await mkdtemp(join(resolve(input.outputParentDirectory), "sdr-encode-"));
  const videoPath = join(directory, "video.mp4");
  const cleanup = async () => {
    await rm(videoPath, {force: true});
    await rmdir(directory).catch((error: NodeJS.ErrnoException) => {if (error.code !== "ENOENT") throw error;});
  };
  try {
    assertConformanceJobActive(input.signal);
    await execute(input.ffmpegPath, buildSdrFrameEncoderArguments({...profile,
      framesDirectory: input.framesDirectory, outputPath: videoPath}), {timeout: remainingMilliseconds(),
      maxBuffer: 65536, windowsHide: true, signal: input.signal, env: createControlledProcessEnvironment()});
    assertConformanceJobActive(input.signal);
    const output = await pinConformanceFile(videoPath, 2 * 1024 ** 3);
    const probed = await execute(input.ffprobePath, ["-v", "error", "-protocol_whitelist", "file,pipe", "-count_frames",
      "-show_entries", "stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,nb_read_frames,color_space,color_transfer,color_primaries,color_range,chroma_location,start_time:format=duration,size,format_name,start_time",
      "-of", "json", videoPath], {timeout: remainingMilliseconds(), maxBuffer: 65536, windowsHide: true,
      signal: input.signal, env: createControlledProcessEnvironment()}) as {stdout?: unknown};
    assertConformanceJobActive(input.signal);
    const outputProfile = validateSdrEncodedOutput(probed?.stdout, {...profile, sizeBytes: output.sizeBytes});
    await assertConformanceFileUnchanged(videoPath, output, 2 * 1024 ** 3);
    await assertConformanceFileUnchanged(input.ffprobePath, probePin, 1024 ** 3);
    await assertConformanceFileUnchanged(input.ffmpegPath, binary, 1024 ** 3);
    await assertSdrFrameSequenceUnchanged(frames, input.signal);
    assertConformanceJobActive(input.signal);
    if (!output.sizeBytes) throw new Error("SDR_FRAME_ENCODER_OUTPUT_INVALID");
    remainingMilliseconds();
    return {directory, videoPath, output, cleanup, policy: SDR_FRAME_CONVERSION_POLICY,
      encoderSha256: binary.sha256, probeSha256: probePin.sha256, outputProfile, profile, frames};
  } catch {
    let cleanupFailed = false;
    try {await cleanup();} catch {cleanupFailed = true;}
    assertConformanceJobActive(input.signal);
    throw new Error(cleanupFailed ? "SDR_FRAME_ENCODER_FAILED_WITH_CLEANUP" : "SDR_FRAME_ENCODER_FAILED");
  }
}
