import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, readdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { RenderInternals } from "@remotion/renderer";
import { z } from "zod";
import { compositionConformanceContractSchema, type CompositionConformanceReport } from "../composition-preview-render-conformance";
import { measureCompositionConformanceDirectories, compositionConformanceCaptureMetadataSchema } from "./composition-conformance-files";
import { parseExportedAudioSignal, type ExportedAudioSignal } from "./composition-exported-audio-signal";
import { evaluateExportedAudioLoudness, measureExportedAudioLoudness, type ExportedAudioLoudnessPolicyId, type ExportedAudioLoudnessReport } from "./composition-exported-audio-loudness";
import { audioTimingReport, measureExportedAudioTiming, type AudioTimingReport } from "./composition-exported-audio-timing";
import { evaluateExportedColorTags, readExportedColorTags, resolveExportedColorTagPolicyId,
  type ExportedColorTagPolicyId, type ExportedColorTagReport } from "./composition-exported-color-tags";

const execFileAsync = promisify(execFile);
const MAX_EXPORTED_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
const VIDEO_DECODE_TIMEOUT_MS = 10 * 60 * 1_000;
const probeSchema = z.object({
  format: z.object({ duration: z.string() }).passthrough(),
  streams: z.array(z.object({
    avg_frame_rate: z.string().optional(),
    codec_type: z.string(),
    height: z.number().int().positive().optional(),
    width: z.number().int().positive().optional(),
  }).passthrough()),
}).passthrough();
export const exportedVideoReceiptSchema = z.object({
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  videoSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export interface ExportedVideoConformanceReport {
  visualMeasurements?: Awaited<ReturnType<typeof measureCompositionConformanceDirectories>>["measurements"];
  colorTags?: ExportedColorTagReport;
  documentHash: string;
  audioTiming: AudioTimingReport;
  audioLoudness: ExportedAudioLoudnessReport;
  audioSignal: ExportedAudioSignal | null;
  audioStatus: "EXPECTATION_UNKNOWN" | "MISSING_REQUIRED_TRACK" | "NOT_REQUIRED" | "REQUIRED_AUDIO_BELOW_FLOOR" | "SIGNAL_ABOVE_FLOOR_NOT_FULLY_EVALUATED";
  provenance: "LOCAL_RECEIPT_NOT_AUTHENTICATED";
  reportVersion: 2;
  scope: "EXPORTED_VIDEO_VISUAL_AND_AUDIO_MEASUREMENTS";
  status: CompositionConformanceReport["status"];
  video: {
    codec: string | null;
    durationSeconds: number;
    hasAudio: boolean;
    frameCount: number;
    maxTimelineDriftFrames: number;
    sha256: string;
    sizeBytes: number;
  };
  visual: CompositionConformanceReport;
}

export function parseExportedVideoProbe(value: unknown) {
  const parsed = probeSchema.parse(value);
  const video = parsed.streams.find((stream) => stream.codec_type === "video");
  if (!video?.avg_frame_rate || !video.width || !video.height) throw new Error("EXPORTED_VIDEO_STREAM_MISSING");
  const [numerator, denominator] = video.avg_frame_rate.split("/").map(Number);
  const fps = numerator! / denominator!;
  const durationSeconds = Number(parsed.format.duration);
  if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("EXPORTED_VIDEO_TIMING_INVALID");
  }
  return {
    colorTags: readExportedColorTags(video),
    codec: typeof video.codec_name === "string" ? video.codec_name : null,
    durationSeconds,
    fps,
    hasAudio: parsed.streams.some((stream) => stream.codec_type === "audio"),
    height: video.height,
    width: video.width,
  };
}

export function evaluateExportedAudioPresence(required: boolean | undefined, hasAudio: boolean): ExportedVideoConformanceReport["audioStatus"] | "TRACK_PRESENT_NEEDS_SIGNAL_CHECK" {
  if (required === undefined) return "EXPECTATION_UNKNOWN";
  if (!required) return "NOT_REQUIRED";
  return hasAudio ? "TRACK_PRESENT_NEEDS_SIGNAL_CHECK" : "MISSING_REQUIRED_TRACK";
}

export function evaluateExportedVideoConformanceStatus(input: {
  audioStatus: ExportedVideoConformanceReport["audioStatus"];
  audioLoudnessStatus: ExportedAudioLoudnessReport["status"];
  visualStatus: CompositionConformanceReport["status"];
  audioTimingStatus?: AudioTimingReport["status"];
  colorTagStatus?: ExportedColorTagReport["status"];
}): CompositionConformanceReport["status"] {
  if (input.audioStatus === "MISSING_REQUIRED_TRACK" || input.audioStatus === "REQUIRED_AUDIO_BELOW_FLOOR"
    || input.audioLoudnessStatus === "FAIL" || input.audioLoudnessStatus === "MEASUREMENT_FAILED"
    || input.audioTimingStatus === "FAIL" || input.audioTimingStatus === "MEASUREMENT_FAILED"
    || input.colorTagStatus === "FAIL") return "FAIL";
  return (input.audioTimingStatus === "INCOMPLETE" || input.colorTagStatus === "INCOMPLETE")
    && input.visualStatus === "PASS" ? "INCOMPLETE" : input.visualStatus;
}

export function parseExportedFrameTimes(stdout: string, frameIndexes: number[], timeline?: {
  expectedFrameCount: number;
  fps: number;
  maxTemporalDriftFrames: number;
}): { checkpointTimes: number[]; frameCount: number; maxTimelineDriftFrames: number } {
  const lines = stdout.trim().split(/\r?\n/);
  const times = lines.map((line) => /^\d+(?:\.\d+)?,?$/.test(line) ? Number(line.replace(/,$/, "")) : NaN);
  if (frameIndexes.length === 0 || frameIndexes.length > 48
    || frameIndexes.some((index, position) => !Number.isSafeInteger(index) || index < 0 || (position > 0 && index <= frameIndexes[position - 1]!))
    || times.some((time) => !Number.isFinite(time) || time < 0)
    || frameIndexes.at(-1)! >= times.length) {
    throw new Error("EXPORTED_VIDEO_FRAMES_INCOMPLETE");
  }
  let maxTimelineDriftFrames = 0;
  if (timeline) {
    if (!Number.isSafeInteger(timeline.expectedFrameCount) || timeline.expectedFrameCount <= 0
      || !Number.isFinite(timeline.fps) || timeline.fps <= 0
      || !Number.isFinite(timeline.maxTemporalDriftFrames) || timeline.maxTemporalDriftFrames < 0
      || times.length !== timeline.expectedFrameCount) {
      throw new Error("EXPORTED_VIDEO_FRAME_COUNT_MISMATCH");
    }
    for (let index = 0; index < times.length; index += 1) {
      const driftFrames = Math.abs(times[index]! * timeline.fps - index);
      maxTimelineDriftFrames = Math.max(maxTimelineDriftFrames, driftFrames);
      if (index > 0 && times[index]! <= times[index - 1]!) throw new Error("EXPORTED_VIDEO_FRAME_TIMESTAMPS_INVALID");
      if (driftFrames > timeline.maxTemporalDriftFrames) throw new Error("EXPORTED_VIDEO_TIMELINE_DRIFT");
    }
  }
  return { checkpointTimes: frameIndexes.map((index) => times[index]!), frameCount: times.length, maxTimelineDriftFrames };
}

export async function compareExportedVideoWithPreview(params: {
  audioReferencePath?: string;
  audioReferenceMetadataPath?: string;
  audioPolicyId?: ExportedAudioLoudnessPolicyId;
  colorTagPolicyId?: ExportedColorTagPolicyId;
  contractPath: string;
  previewDirectory: string;
  previewMetadataPath: string;
  renderReceiptPath: string;
  videoPath: string;
  includeVisualMeasurements?: boolean;
}): Promise<ExportedVideoConformanceReport> {
  if (Boolean(params.audioReferencePath) !== Boolean(params.audioReferenceMetadataPath)) throw new Error("EXPORTED_AUDIO_REFERENCE_ARGUMENTS_INVALID");
  resolveExportedColorTagPolicyId(params.colorTagPolicyId);
  const contract = compositionConformanceContractSchema.parse(JSON.parse(await readFile(resolve(params.contractPath), "utf8")) as unknown);
  const receipt = exportedVideoReceiptSchema.parse(JSON.parse(await readFile(resolve(params.renderReceiptPath), "utf8")) as unknown);
  const file = await stat(resolve(params.videoPath));
  if (!file.isFile() || file.size <= 0 || file.size > MAX_EXPORTED_VIDEO_BYTES) throw new Error("EXPORTED_VIDEO_SIZE_INVALID");
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(resolve(params.videoPath))) digest.update(chunk as Buffer);
  const sha256 = digest.digest("hex");
  if (sha256 !== receipt.videoSha256) throw new Error("EXPORTED_VIDEO_RECEIPT_HASH_MISMATCH");
  if (receipt.documentHash !== contract.documentHash) throw new Error("EXPORTED_VIDEO_DOCUMENT_HASH_MISMATCH");

  const ffprobePath = RenderInternals.getExecutablePath({ binariesDirectory: null, indent: false, logLevel: "error", type: "ffprobe" });
  const ffmpegPath = RenderInternals.getExecutablePath({ binariesDirectory: null, indent: false, logLevel: "error", type: "ffmpeg" });
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,color_space,color_primaries,color_transfer,color_range",
    "-of", "json", resolve(params.videoPath),
  ], { maxBuffer: 128 * 1024, timeout: 30_000, windowsHide: true });
  const probe = parseExportedVideoProbe(JSON.parse(stdout) as unknown);
  const frozenColorPolicy = contract.schemaVersion === 4 ? contract.colorTagPolicy : undefined;
  const colorTags = evaluateExportedColorTags(probe.colorTags, frozenColorPolicy ?? params.colorTagPolicyId);
  let audioStatus = evaluateExportedAudioPresence(contract.schemaVersion !== 1 ? contract.audio.required : undefined, probe.hasAudio);
  let audioSignal: ExportedAudioSignal | null = null;
  if (audioStatus === "TRACK_PRESENT_NEEDS_SIGNAL_CHECK") {
    const { stderr } = await execFileAsync(ffmpegPath, [
      "-hide_banner", "-nostdin", "-v", "info", "-i", resolve(params.videoPath),
      "-map", "0:a:0", "-vn", "-af", "volumedetect", "-f", "null", "-",
    ], { maxBuffer: 512 * 1024, timeout: VIDEO_DECODE_TIMEOUT_MS, windowsHide: true });
    audioSignal = parseExportedAudioSignal(stderr);
    audioStatus = audioSignal.signalAboveFloor ? "SIGNAL_ABOVE_FLOOR_NOT_FULLY_EVALUATED" : "REQUIRED_AUDIO_BELOW_FLOOR";
  }
  if (probe.width !== contract.canvas.width || probe.height !== contract.canvas.height) throw new Error("EXPORTED_VIDEO_DIMENSIONS_MISMATCH");
  if (Math.abs(probe.fps - contract.renderProfile.fps) > 0.001) throw new Error("EXPORTED_VIDEO_FPS_MISMATCH");
  if (Math.abs(probe.durationSeconds - contract.canvas.durationSeconds) > 1 / contract.renderProfile.fps) {
    throw new Error("EXPORTED_VIDEO_DURATION_MISMATCH");
  }
  const audioLoudness = probe.hasAudio
    ? await measureExportedAudioLoudness({ ffmpegPath, videoPath: resolve(params.videoPath), policyId: params.audioPolicyId })
    : evaluateExportedAudioLoudness(null, params.audioPolicyId);
  const audioTiming = params.audioReferencePath && params.audioReferenceMetadataPath
    ? probe.hasAudio ? await measureExportedAudioTiming({
      ffmpegPath, videoPath: resolve(params.videoPath), referencePath: params.audioReferencePath,
      referenceMetadataPath: params.audioReferenceMetadataPath, documentHash: contract.documentHash, frameDurationMilliseconds: 1000 / probe.fps,
      durationSeconds: contract.canvas.durationSeconds,
    }) : audioTimingReport("MEASUREMENT_FAILED", "AUDIO_TIMING_TRACK_MISSING")
    : audioTimingReport("NOT_REQUESTED");

  const workDirectory = await mkdtemp(join(tmpdir(), "courseforge-export-conformance-"));
  const metadataPath = join(workDirectory, "render-metadata.json");
  try {
    const indexes = contract.checkpoints.map((checkpoint) => checkpoint.frameIndex);
    const frameProbe = await execFileAsync(ffprobePath, [
      "-v", "error", "-select_streams", "v:0", "-show_entries", "frame=best_effort_timestamp_time",
      "-of", "csv=p=0", resolve(params.videoPath),
    ], { maxBuffer: 64 * 1024 * 1024, timeout: VIDEO_DECODE_TIMEOUT_MS, windowsHide: true });
    const timeline = parseExportedFrameTimes(frameProbe.stdout, indexes, {
      expectedFrameCount: Math.ceil(contract.canvas.durationSeconds * contract.renderProfile.fps),
      fps: contract.renderProfile.fps,
      maxTemporalDriftFrames: contract.thresholds.maxTemporalDriftFrames,
    });
    for (let position = 0; position < indexes.length; position += 1) {
      await execFileAsync(ffmpegPath, [
        "-hide_banner", "-nostdin", "-loglevel", "error", "-i", resolve(params.videoPath),
        "-map", "0:v:0", "-an", "-ss", String(timeline.checkpointTimes[position]), "-frames:v", "1",
        join(workDirectory, `frame-${indexes[position]}.png`),
      ], { maxBuffer: 128 * 1024, timeout: VIDEO_DECODE_TIMEOUT_MS, windowsHide: true });
    }
    const renderMetadata = compositionConformanceCaptureMetadataSchema.parse({
      colorTags,
      documentHash: receipt.documentHash,
      frames: indexes.map((frameIndex, position) => ({ frameIndex, timeSeconds: timeline.checkpointTimes[position] })),
    });
    await writeFile(metadataPath, JSON.stringify(renderMetadata), "utf8");
    const measuredVisual = await measureCompositionConformanceDirectories({
      contractPath: params.contractPath,
      previewDirectory: params.previewDirectory,
      previewMetadataPath: params.previewMetadataPath,
      renderDirectory: workDirectory,
      renderMetadataPath: metadataPath,
    });
    const visual = measuredVisual.report;
    return {
      ...(params.includeVisualMeasurements === true ? {visualMeasurements: measuredVisual.measurements} : {}),
      colorTags,
      documentHash: contract.documentHash,
      audioTiming,
      audioLoudness,
      audioSignal,
      audioStatus,
      provenance: "LOCAL_RECEIPT_NOT_AUTHENTICATED",
      reportVersion: 2,
      scope: "EXPORTED_VIDEO_VISUAL_AND_AUDIO_MEASUREMENTS",
      status: evaluateExportedVideoConformanceStatus({ audioStatus, audioLoudnessStatus: audioLoudness.status,
        visualStatus: visual.status, audioTimingStatus: audioTiming.status, colorTagStatus: colorTags.status }),
      video: { codec: probe.codec, durationSeconds: probe.durationSeconds, frameCount: timeline.frameCount, hasAudio: probe.hasAudio, maxTimelineDriftFrames: timeline.maxTimelineDriftFrames, sha256, sizeBytes: file.size },
      visual,
    };
  } finally {
    for (const entry of await readdir(workDirectory)) {
      if (/^frame-\d+\.png$/.test(entry) || entry === "render-metadata.json") {
        await rm(join(workDirectory, entry), { force: true });
      }
    }
    await rmdir(workDirectory);
  }
}
