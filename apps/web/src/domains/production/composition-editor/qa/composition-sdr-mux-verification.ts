import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {createHash} from "node:crypto";
import {performance} from "node:perf_hooks";
import {z} from "zod";
import {SDR_AUDIO_MUX_POLICY, SDR_FRAME_CONVERSION_POLICY, sdrFrameCaptureProfileSchema} from "../composition-sdr-conversion-policy";
import {pinConformanceFile, assertConformanceFileUnchanged} from "./composition-conformance-file-integrity";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";
import {createControlledProcessEnvironment} from "./composition-controlled-process-environment";
import {assertSdrCheckpointStreamProfile} from "./composition-sdr-checkpoint-decoder";
import {validateSdrEncodedOutput} from "./composition-sdr-output-profile";
import {hashSdrPacketTiming} from "./composition-sdr-packet-timing";

const MAXIMUM_PACKET_JSON_BYTES = 16 * 1024 * 1024;
const packetHash = z.string().regex(/^SHA256:[a-f0-9]{64}$/i).transform(value => value.toLowerCase());
const packetSchema = z.object({packets: z.array(z.object({data_hash: packetHash,
  size: z.string().max(10).regex(/^[1-9]\d*$/)}).passthrough()).min(1).max(36000),
  streams: z.array(z.object({codec_type: z.literal("video"), extradata_hash: packetHash}).passthrough()).length(1)}).passthrough();

/** Ordered packet payload + codec extradata identity. Not timing, decoding or origin proof. */
export function hashSdrVideoPackets(encoded: unknown, frameCount: number) {
  try {
    if (!Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > 36000
      || typeof encoded !== "string" || Buffer.byteLength(encoded) > MAXIMUM_PACKET_JSON_BYTES) throw new Error();
    const parsed = packetSchema.parse(JSON.parse(encoded));
    if (parsed.packets.length !== frameCount) throw new Error();
    const digest = createHash("sha256").update("courseforge-sdr-video-payloads-v1\n").update(parsed.streams[0]!.extradata_hash);
    for (const packet of parsed.packets) digest.update(JSON.stringify([packet.size, packet.data_hash]));
    return digest.digest("hex");
  } catch {throw new Error("SDR_MUX_VIDEO_PACKETS_INVALID");}
}

type ProbeExecutor = (binary: string, args: string[], options: {timeout: number; maxBuffer: number;
  windowsHide: boolean; signal?: AbortSignal; env: NodeJS.ProcessEnv}) => Promise<{stdout: string}>;
const executeFile = promisify(execFile);

/** Verify the SDK-muxed file before the driver emits its receipt. Never repairs or relabels it. */
export async function verifySdrAudioMuxOutput(input: {silentVideoPath: string; silentVideoSha256: string;
  videoPath: string; videoSha256: string; ffprobePath: string; ffprobeSha256: string;
  profile: {width: number; height: number; fps: number; frameCount: number}; timeoutMilliseconds: number;
  signal?: AbortSignal}, execute: ProbeExecutor = executeFile) {
  assertConformanceJobActive(input.signal);
  const profile = sdrFrameCaptureProfileSchema.parse({...input.profile, captureProfile: SDR_FRAME_CONVERSION_POLICY.captureProfile});
  if (!Number.isSafeInteger(input.timeoutMilliseconds) || input.timeoutMilliseconds < 1 || input.timeoutMilliseconds > 600000
    || [input.silentVideoSha256, input.videoSha256, input.ffprobeSha256].some(hash => !/^[a-f0-9]{64}$/.test(hash)))
    throw new Error("SDR_MUX_VERIFICATION_INPUT_INVALID");
  const started = performance.now();
  const remaining = () => {
    assertConformanceJobActive(input.signal);
    const duration = input.timeoutMilliseconds - (performance.now() - started);
    if (duration <= 0) throw new Error("SDR_MUX_VERIFICATION_TIMEOUT");
    return Math.max(1, Math.floor(duration));
  };
  const silent = await pinConformanceFile(input.silentVideoPath, 2 * 1024 ** 3);
  const output = await pinConformanceFile(input.videoPath, 2 * 1024 ** 3);
  const probe = await pinConformanceFile(input.ffprobePath, 1024 ** 3);
  if (silent.sha256 !== input.silentVideoSha256 || output.sha256 !== input.videoSha256 || probe.sha256 !== input.ffprobeSha256)
    throw new Error("SDR_MUX_VERIFICATION_HASH_MISMATCH");
  const run = async (args: string[], maxBuffer: number) => {
    const result = await execute(input.ffprobePath, ["-v", "error", "-protocol_whitelist", "file,pipe", ...args],
      {timeout: remaining(), maxBuffer, windowsHide: true, signal: input.signal, env: createControlledProcessEnvironment()});
    remaining(); return result.stdout;
  };
  const metadata = await run(["-count_frames", "-show_entries",
    "stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,nb_read_frames,color_space,color_transfer,color_primaries,color_range,chroma_location,start_time,sample_rate,channels,duration:format=duration,size,format_name,start_time",
    "-of", "json", input.videoPath], 65536);
  let outputProfile: ReturnType<typeof validateSdrEncodedOutput>;
  try {
    if (Buffer.byteLength(metadata) > 65536) throw new Error();
    const parsed = JSON.parse(metadata) as {streams: Array<Record<string, unknown>>; format: unknown};
    assertSdrCheckpointStreamProfile(parsed, SDR_AUDIO_MUX_POLICY,
      {durationSeconds: profile.frameCount / profile.fps, frameDurationSeconds: 1 / profile.fps});
    const videos = parsed.streams.filter(stream => stream.codec_type === "video").map(stream => {
      const {duration: _streamDuration, ...countedVideoFields} = stream; return countedVideoFields;
    });
    outputProfile = validateSdrEncodedOutput(JSON.stringify({streams: videos,
      format: parsed.format}), {...profile, sizeBytes: output.sizeBytes});
  } catch {throw new Error("SDR_MUX_OUTPUT_PROFILE_INVALID");}
  const hashes: string[] = [];
  const timingHashes: string[] = [];
  for (const path of [input.silentVideoPath, input.videoPath]) {
    const packets = await run(["-select_streams", "v:0", "-show_packets", "-show_streams", "-show_data_hash", "sha256",
      "-show_entries", "packet=size,data_hash,pts,dts,duration:stream=codec_type,extradata_hash,time_base", "-of", "json", path], MAXIMUM_PACKET_JSON_BYTES);
    hashes.push(hashSdrVideoPackets(packets, profile.frameCount));
    timingHashes.push(hashSdrPacketTiming(packets, profile));
  }
  if (hashes[0] !== hashes[1]) throw new Error("SDR_MUX_VIDEO_PAYLOAD_CHANGED");
  if (timingHashes[0] !== timingHashes[1]) throw new Error("SDR_MUX_VIDEO_TIMING_CHANGED");
  for (const [path, pin, maximum] of [[input.silentVideoPath, silent, 2 * 1024 ** 3],
    [input.videoPath, output, 2 * 1024 ** 3], [input.ffprobePath, probe, 1024 ** 3]] as const)
    await assertConformanceFileUnchanged(path, pin, maximum);
  remaining();
  return {policy: SDR_AUDIO_MUX_POLICY, scope: "LOCAL_PROBED_VIDEO_PAYLOADS_NOT_SYNC_OR_RENDER_ATTESTATION" as const,
    silentVideoSha256: silent.sha256, videoSha256: output.sha256, probeSha256: probe.sha256,
    videoPayloadSha256: hashes[0]!, videoTimingSha256: timingHashes[0]!, frameCount: profile.frameCount, outputProfile};
}
