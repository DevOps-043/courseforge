import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { RenderInternals } from "@remotion/renderer";
import { z } from "zod";
import { evaluateExportedVideoConformanceStatus, type ExportedAudioPresenceStatus } from "./composition-exported-conformance-gate";
export { evaluateExportedVideoConformanceStatus } from "./composition-exported-conformance-gate";
import { compositionConformanceContractSchema, type CompositionConformanceReport } from "../composition-preview-render-conformance";
import { measureCompositionConformanceDirectories, compositionConformanceCaptureMetadataSchema } from "./composition-conformance-files";
import { parseExportedAudioSignal, type ExportedAudioSignal } from "./composition-exported-audio-signal";
import { evaluateExportedAudioLoudness, measureExportedAudioLoudness, type ExportedAudioLoudnessPolicyId, type ExportedAudioLoudnessReport } from "./composition-exported-audio-loudness";
import { audioTimingReport, measureExportedAudioTiming, type AudioTimingReport } from "./composition-exported-audio-timing";
import { evaluateExportedColorTags, readExportedColorTags, resolveExportedColorTagPolicyId,
  type ExportedColorTagPolicyId, type ExportedColorTagReport } from "./composition-exported-color-tags";
import type { ColorChartAuditPlan } from "./composition-color-chart-audit";
import { auditExportedColorChartCheckpoints, validateExportedColorChartPlan,
  type ExportedColorChartReport } from "./composition-exported-color-chart";
import { assertConformanceFileUnchanged, pinConformanceFile } from "./composition-conformance-file-integrity";
import {controlledRenderExecutionObservationSchema, evaluateControlledRenderExecution} from "../composition-render-execution-contract";
import {controlledSeekRepeatabilityReportSchema} from "../composition-render-seek-policy";
import {bindControlledSeekRepeatability} from "./composition-controlled-seek-binding";
import {controlledNativeEvidenceSchema} from "./composition-controlled-font-witness";
import {bindControlledRendererNativeEvidence} from "./composition-controlled-native-binding";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";
import {createControlledProcessEnvironment} from "./composition-controlled-process-environment";
import {pinComparisonTools} from "./composition-comparison-tool-integrity";
import {resolveSdrCheckpointFilter, assertSdrCheckpointStreamProfile} from "./composition-sdr-checkpoint-decoder";
import type {ComparisonProcessPorts} from "./composition-comparison-process-ports";
import {requiresControlledExecutorIntervention} from "./composition-controlled-execution-fence";

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
  renderExecution: controlledRenderExecutionObservationSchema.optional(),
  seekRepeatability: controlledSeekRepeatabilityReportSchema.optional(),
  nativeEvidence: controlledNativeEvidenceSchema.optional(),
}).strict();

export interface ExportedVideoConformanceReport {
  visualMeasurements?: Awaited<ReturnType<typeof measureCompositionConformanceDirectories>>["measurements"];
  colorTags?: ExportedColorTagReport;
  colorChart?: ExportedColorChartReport;
  documentHash: string;
  audioTiming: AudioTimingReport;
  audioLoudness: ExportedAudioLoudnessReport;
  audioSignal: ExportedAudioSignal | null;
  audioStatus: ExportedAudioPresenceStatus;
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
  colorChartAuditPlan?: ColorChartAuditPlan;
  contractPath: string;
  previewDirectory: string;
  previewMetadataPath: string;
  renderReceiptPath: string;
  videoPath: string;
  includeVisualMeasurements?: boolean;
  signal?: AbortSignal;
  /** Host configuration, never supplied by a receipt/client. All process paths are mandatory together. */
  processPorts?: ComparisonProcessPorts;
}): Promise<ExportedVideoConformanceReport> {
  assertConformanceJobActive(params.signal);
  const processPorts = params.processPorts;
  if (processPorts && (typeof processPorts.pixelDecoderPath !== "string" || typeof processPorts.probePath !== "string"
    || !isAbsolute(processPorts.pixelDecoderPath) || !isAbsolute(processPorts.probePath)
    || processPorts.pixelDecoderPath.includes("\0") || processPorts.probePath.includes("\0")
    || typeof processPorts.execute !== "function" || typeof processPorts.consumePcm !== "function"))
    throw new Error("EXPORTED_VIDEO_PROCESS_CONFIGURATION_INVALID");
  const execute = async (binary: string, args: string[], options: {maxBuffer: number; timeout: number; windowsHide: boolean}) => {
    assertConformanceJobActive(params.signal);
    try {
      const result = await (processPorts?.execute ?? execFileAsync)(binary, args,
        {...options, encoding: "utf8", signal: params.signal, env: createControlledProcessEnvironment()});
      assertConformanceJobActive(params.signal); return result;
    } catch (error) {
      if (error instanceof Error && requiresControlledExecutorIntervention(error.message)) throw error;
      assertConformanceJobActive(params.signal); throw error;
    }
  };
  if (Boolean(params.audioReferencePath) !== Boolean(params.audioReferenceMetadataPath)) throw new Error("EXPORTED_AUDIO_REFERENCE_ARGUMENTS_INVALID");
  resolveExportedColorTagPolicyId(params.colorTagPolicyId);
  const contract = compositionConformanceContractSchema.parse(JSON.parse(await readFile(resolve(params.contractPath), "utf8")) as unknown);
  const colorChartPlan = params.colorChartAuditPlan ? validateExportedColorChartPlan(contract, params.colorChartAuditPlan) : undefined;
  const receipt = exportedVideoReceiptSchema.parse(JSON.parse(await readFile(resolve(params.renderReceiptPath), "utf8")) as unknown);
  const videoPin = await pinConformanceFile(resolve(params.videoPath), MAX_EXPORTED_VIDEO_BYTES);
  const sha256 = videoPin.sha256;
  if (sha256 !== receipt.videoSha256) throw new Error("EXPORTED_VIDEO_RECEIPT_HASH_MISMATCH");
  if (receipt.documentHash !== contract.documentHash) throw new Error("EXPORTED_VIDEO_DOCUMENT_HASH_MISMATCH");
  const native = bindControlledRendererNativeEvidence(contract, receipt.nativeEvidence, sha256);
  const checkpointFilter = resolveSdrCheckpointFilter({expected: contract.schemaVersion === 4 ? contract.renderExecution : undefined,
    observation: receipt.renderExecution, documentHash: contract.documentHash, videoSha256: sha256});

  const ffprobePath = processPorts?.probePath ?? RenderInternals.getExecutablePath({ binariesDirectory: null, indent: false, logLevel: "error", type: "ffprobe" });
  const ffmpegPath = processPorts?.pixelDecoderPath ?? RenderInternals.getExecutablePath({ binariesDirectory: null, indent: false, logLevel: "error", type: "ffmpeg" });
  // Resolve locally, never accept executable paths from the receipt or a browser/client.
  const comparisonTools = await pinComparisonTools({pixelDecoderPath: ffmpegPath, probePath: ffprobePath,
    expected: contract.schemaVersion === 4 ? contract.renderExecution?.comparisonTools : undefined, signal: params.signal});
  const { stdout } = await execute(ffprobePath, [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,pix_fmt,chroma_location,color_space,color_primaries,color_transfer,color_range,sample_rate,channels,start_time,duration",
    "-of", "json", resolve(params.videoPath),
  ], { maxBuffer: 128 * 1024, timeout: 30_000, windowsHide: true });
  const rawProbe: unknown = JSON.parse(stdout);
  if (checkpointFilter) assertSdrCheckpointStreamProfile(rawProbe,
    contract.schemaVersion === 4 ? contract.renderExecution?.sdrAudioMuxPolicy : undefined,
    {durationSeconds: contract.canvas.durationSeconds, frameDurationSeconds: 1 / contract.renderProfile.fps});
  const probe = parseExportedVideoProbe(rawProbe);
  const frozenColorPolicy = contract.schemaVersion === 4 ? contract.colorTagPolicy : undefined;
  const colorTags = evaluateExportedColorTags(probe.colorTags, frozenColorPolicy ?? params.colorTagPolicyId);
  let audioStatus = evaluateExportedAudioPresence(contract.schemaVersion !== 1 ? contract.audio.required : undefined, probe.hasAudio);
  let audioSignal: ExportedAudioSignal | null = null;
  if (audioStatus === "TRACK_PRESENT_NEEDS_SIGNAL_CHECK") {
    const { stderr } = await execute(ffmpegPath, [
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
    ? await measureExportedAudioLoudness({ ffmpegPath, videoPath: resolve(params.videoPath), policyId: params.audioPolicyId,
      signal: params.signal, ...(processPorts ? {execute: processPorts.execute} : {}) })
    : evaluateExportedAudioLoudness(null, params.audioPolicyId);
  const audioTiming = params.audioReferencePath && params.audioReferenceMetadataPath
    ? probe.hasAudio ? await measureExportedAudioTiming({
      ffmpegPath, videoPath: resolve(params.videoPath), referencePath: params.audioReferencePath,
      referenceMetadataPath: params.audioReferenceMetadataPath, documentHash: contract.documentHash, frameDurationMilliseconds: 1000 / probe.fps,
      durationSeconds: contract.canvas.durationSeconds,
      signal: params.signal,
    }, undefined, processPorts?.consumePcm) : audioTimingReport("MEASUREMENT_FAILED", "AUDIO_TIMING_TRACK_MISSING")
    : audioTimingReport("NOT_REQUESTED");

  const workDirectory = await mkdtemp(join(tmpdir(), "courseforge-export-conformance-"));
  const metadataPath = join(workDirectory, "render-metadata.json");
  let terminationUnconfirmed = false;
  try {
    assertConformanceJobActive(params.signal);
    const indexes = contract.checkpoints.map((checkpoint) => checkpoint.frameIndex);
    const frameProbe = await execute(ffprobePath, [
      "-v", "error", "-select_streams", "v:0", "-show_entries", "frame=best_effort_timestamp_time",
      "-of", "csv=p=0", resolve(params.videoPath),
    ], { maxBuffer: 64 * 1024 * 1024, timeout: VIDEO_DECODE_TIMEOUT_MS, windowsHide: true });
    const timeline = parseExportedFrameTimes(frameProbe.stdout, indexes, {
      expectedFrameCount: Math.ceil(contract.canvas.durationSeconds * contract.renderProfile.fps),
      fps: contract.renderProfile.fps,
      maxTemporalDriftFrames: contract.thresholds.maxTemporalDriftFrames,
    });
    for (let position = 0; position < indexes.length; position += 1) {
      await execute(ffmpegPath, [
        "-hide_banner", "-nostdin", "-loglevel", "error", "-i", resolve(params.videoPath),
        "-map", "0:v:0", "-an", "-ss", String(timeline.checkpointTimes[position]), "-frames:v", "1",
        ...(checkpointFilter ? ["-vf", checkpointFilter] : []),
        join(workDirectory, `frame-${indexes[position]}.png`),
      ], { maxBuffer: 128 * 1024, timeout: VIDEO_DECODE_TIMEOUT_MS, windowsHide: true });
    }
    const renderMetadata = compositionConformanceCaptureMetadataSchema.parse({
      colorTags,
      ...(native ? {textParity: native.nativeEvidence.textEvidence} : {}),
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
    assertConformanceJobActive(params.signal);
    if (native?.fontWitness) {
      if (!visual.fontUsage) throw new Error("EXPORTED_VIDEO_FONT_PENDING_REPORT_REQUIRED");
      visual.fontUsage.observedWitness = native.fontWitness;
    }
    if (contract.schemaVersion === 4 && contract.renderExecution) {
      visual.renderExecution = evaluateControlledRenderExecution({expected: contract.renderExecution,
        documentHash: contract.documentHash, videoSha256: sha256, observation: receipt.renderExecution});
      if (visual.renderExecution.status === "MISMATCH") {
        visual.status = "FAIL";
        visual.failures.push({metric: "render_execution", message: "La ejecución no coincide con el contrato congelado."});
      }
    } else if (receipt.renderExecution) throw new Error("CONFORMANCE_RENDER_EXECUTION_UNAUTHORIZED");
    const seek = bindControlledSeekRepeatability(contract, receipt.seekRepeatability);
    if (seek) {
      visual.seekRepeatability = seek;
      visual.incompletenessReasons = visual.incompletenessReasons?.filter(reason => reason !== "RENDER_SEEK_REPEATABILITY_UNAVAILABLE");
    }
    const colorChart = colorChartPlan ? await auditExportedColorChartCheckpoints({plan: colorChartPlan, frameIndexes: indexes,
      previewDirectory: resolve(params.previewDirectory), renderDirectory: workDirectory}) : undefined;
    await assertConformanceFileUnchanged(resolve(params.videoPath), videoPin, MAX_EXPORTED_VIDEO_BYTES);
    await comparisonTools.assertUnchanged();
    assertConformanceJobActive(params.signal);
    return {
      ...(params.includeVisualMeasurements === true ? {visualMeasurements: measuredVisual.measurements} : {}),
      colorTags,
      ...(colorChart ? {colorChart} : {}),
      documentHash: contract.documentHash,
      audioTiming,
      audioLoudness,
      audioSignal,
      audioStatus,
      provenance: "LOCAL_RECEIPT_NOT_AUTHENTICATED",
      reportVersion: 2,
      scope: "EXPORTED_VIDEO_VISUAL_AND_AUDIO_MEASUREMENTS",
      status: evaluateExportedVideoConformanceStatus({ audioStatus, audioLoudnessStatus: audioLoudness.status,
        visualStatus: visual.status, audioTimingStatus: audioTiming.status, audioRmsStatus: audioTiming.rms.status,
        colorTagStatus: colorTags.status, colorChartStatus: colorChart?.status }),
      video: { codec: probe.codec, durationSeconds: probe.durationSeconds, frameCount: timeline.frameCount, hasAudio: probe.hasAudio, maxTimelineDriftFrames: timeline.maxTimelineDriftFrames, sha256, sizeBytes: videoPin.sizeBytes },
      visual,
    };
  } catch (error) {
    terminationUnconfirmed = error instanceof Error && requiresControlledExecutorIntervention(error.message);
    throw error;
  } finally {
    // An owned decoder with unknown closure may still access these files. Never clean them under it.
    if (!terminationUnconfirmed) {
      for (const entry of await readdir(workDirectory)) {
        if (/^frame-\d+\.png$/.test(entry) || entry === "render-metadata.json") {
          await rm(join(workDirectory, entry), { force: true });
        }
      }
      await rmdir(workDirectory);
    }
  }
}
