import { execFile } from "node:child_process";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";
import {createControlledProcessEnvironment} from "./composition-controlled-process-environment";
import { promisify } from "node:util";
import { z } from "zod";
import { AUDIO_PROCESSING_PROFILES } from "../../audio-processing/audio-processing-profiles";
import {requiresControlledExecutorIntervention} from "./composition-controlled-execution-fence";

const execFileAsync = promisify(execFile);
const MAX_MEASUREMENT_OUTPUT_CHARS = 512 * 1024;
const ANALYSIS_TIMEOUT_MS = 10 * 60 * 1000;
const measurementReference = AUDIO_PROCESSING_PROFILES.find((profile) => profile.id === "voice-course-v1")!.processing.loudness;

export const EXPORTED_AUDIO_LOUDNESS_POLICIES = {
  "course-v1": { integratedLufs: measurementReference.integratedLufs, maximumTruePeakDbtp: -1, toleranceLu: 1 },
} as const;
export type ExportedAudioLoudnessPolicyId = keyof typeof EXPORTED_AUDIO_LOUDNESS_POLICIES;

const numberText = z.string().regex(/^-?(?:\d+(?:\.\d+)?|inf)$/i);
const measurementSchema = z.object({ input_i: numberText, input_tp: numberText, input_lra: numberText, input_thresh: numberText }).passthrough();
export interface ExportedAudioLoudnessMeasurement {
  integratedLufs: number | null;
  loudnessRangeLu: number;
  thresholdLufs: number | null;
  truePeakDbtp: number | null;
}
export type ExportedAudioLoudnessFailure = "SILENT_OR_UNMEASURABLE" | "LOUDNESS_OUTSIDE_TOLERANCE" | "TRUE_PEAK_ABOVE_LIMIT" | "MEASUREMENT_FAILED";
export interface ExportedAudioLoudnessReport {
  failures: ExportedAudioLoudnessFailure[];
  measurement: ExportedAudioLoudnessMeasurement | null;
  method: "FFMPEG_LOUDNORM_INPUT_V1";
  policy: ({ id: ExportedAudioLoudnessPolicyId } & typeof EXPORTED_AUDIO_LOUDNESS_POLICIES[ExportedAudioLoudnessPolicyId]) | null;
  status: "NOT_APPLICABLE" | "MEASURED_POLICY_NOT_SET" | "PASS" | "FAIL" | "MEASUREMENT_FAILED";
}

export function resolveExportedAudioLoudnessPolicyId(value: string | undefined): ExportedAudioLoudnessPolicyId | undefined {
  if (value === undefined) return undefined;
  if (value !== "course-v1") throw new Error("EXPORTED_AUDIO_LOUDNESS_POLICY_INVALID");
  return value;
}

/** Reads input_* only: output_* describes normalized audio discarded by this analysis. */
export function parseExportedAudioLoudness(stderr: string): ExportedAudioLoudnessMeasurement {
  if (stderr.length > MAX_MEASUREMENT_OUTPUT_CHARS) throw new Error("EXPORTED_AUDIO_LOUDNESS_OUTPUT_TOO_LARGE");
  const candidates = [...stderr.matchAll(/^\[Parsed_loudnorm_\d+\s+@[^\]\r\n]{1,120}\]\s*\r?\n(\{[^{}]{1,4096}\})/gm)];
  const candidate = candidates.at(-1)?.[1];
  if (!candidate) throw new Error("EXPORTED_AUDIO_LOUDNESS_MEASUREMENT_MISSING");
  let raw: unknown;
  try { raw = JSON.parse(candidate); } catch { throw new Error("EXPORTED_AUDIO_LOUDNESS_MEASUREMENT_INVALID"); }
  const parsed = measurementSchema.safeParse(raw);
  if (!parsed.success) throw new Error("EXPORTED_AUDIO_LOUDNESS_MEASUREMENT_INVALID");
  const measurement = (value: string, minimum: number, maximum: number): number | null => {
    if (value.toLowerCase() === "-inf") return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < minimum || numeric > maximum) throw new Error("EXPORTED_AUDIO_LOUDNESS_MEASUREMENT_INVALID");
    return numeric;
  };
  const integratedLufs = measurement(parsed.data.input_i, -120, 20);
  const truePeakDbtp = measurement(parsed.data.input_tp, -120, 24);
  const loudnessRangeLu = measurement(parsed.data.input_lra, 0, 100);
  const thresholdLufs = measurement(parsed.data.input_thresh, -120, 20);
  if (loudnessRangeLu === null) throw new Error("EXPORTED_AUDIO_LOUDNESS_MEASUREMENT_INVALID");
  return { integratedLufs, loudnessRangeLu, thresholdLufs, truePeakDbtp };
}

export function evaluateExportedAudioLoudness(
  measurement: ExportedAudioLoudnessMeasurement | null,
  policyId?: ExportedAudioLoudnessPolicyId,
): ExportedAudioLoudnessReport {
  resolveExportedAudioLoudnessPolicyId(policyId);
  const policy = policyId ? { id: policyId, ...EXPORTED_AUDIO_LOUDNESS_POLICIES[policyId] } : null;
  if (!measurement) return { failures: [], measurement, method: "FFMPEG_LOUDNORM_INPUT_V1", policy, status: "NOT_APPLICABLE" };
  const failures: ExportedAudioLoudnessFailure[] = [];
  if (measurement.integratedLufs === null || measurement.truePeakDbtp === null) failures.push("SILENT_OR_UNMEASURABLE");
  if (policy && measurement.integratedLufs !== null && Math.abs(measurement.integratedLufs - policy.integratedLufs) > policy.toleranceLu) failures.push("LOUDNESS_OUTSIDE_TOLERANCE");
  if (policy && measurement.truePeakDbtp !== null && measurement.truePeakDbtp > policy.maximumTruePeakDbtp) failures.push("TRUE_PEAK_ABOVE_LIMIT");
  return {
    failures, measurement, method: "FFMPEG_LOUDNORM_INPUT_V1", policy,
    status: failures.length ? "FAIL" : policy ? "PASS" : "MEASURED_POLICY_NOT_SET",
  };
}

export function buildExportedAudioLoudnessArgs(videoPath: string): string[] {
  if (!videoPath.trim() || videoPath.includes("\0") || /^(?:https?|file|data):/i.test(videoPath)) throw new Error("EXPORTED_AUDIO_LOUDNESS_PATH_INVALID");
  return [
    "-hide_banner", "-nostdin", "-nostats", "-v", "info", "-protocol_whitelist", "file,pipe", "-i", videoPath,
    "-map", "0:a:0", "-vn", "-af",
    `loudnorm=I=${measurementReference.integratedLufs}:LRA=${measurementReference.loudnessRangeLu}:TP=${measurementReference.truePeakDbtp}:print_format=json`,
    "-f", "null", "-",
  ];
}

type AudioAnalysisExecutor = (binary: string, args: string[], options: { maxBuffer: number; timeout: number; windowsHide: boolean; encoding: "utf8"; signal?: AbortSignal; env: NodeJS.ProcessEnv }) => Promise<{ stderr: string }>;

export async function measureExportedAudioLoudness(params: {
  ffmpegPath: string;
  videoPath: string;
  policyId?: ExportedAudioLoudnessPolicyId;
  execute?: AudioAnalysisExecutor;
  signal?: AbortSignal;
}): Promise<ExportedAudioLoudnessReport> {
  assertConformanceJobActive(params.signal);
  resolveExportedAudioLoudnessPolicyId(params.policyId);
  const args = buildExportedAudioLoudnessArgs(params.videoPath);
  try {
    const { stderr } = await (params.execute ?? execFileAsync)(params.ffmpegPath, args, {
      encoding: "utf8", maxBuffer: MAX_MEASUREMENT_OUTPUT_CHARS, timeout: ANALYSIS_TIMEOUT_MS, windowsHide: true,
      signal: params.signal, env: createControlledProcessEnvironment(),
    });
    assertConformanceJobActive(params.signal);
    return evaluateExportedAudioLoudness(parseExportedAudioLoudness(stderr), params.policyId);
  } catch (error) {
    if (error instanceof Error && requiresControlledExecutorIntervention(error.message)) throw error;
    assertConformanceJobActive(params.signal);
    return {
      failures: ["MEASUREMENT_FAILED"], measurement: null, method: "FFMPEG_LOUDNORM_INPUT_V1",
      policy: params.policyId ? { id: params.policyId, ...EXPORTED_AUDIO_LOUDNESS_POLICIES[params.policyId] } : null,
      status: "MEASUREMENT_FAILED",
    };
  }
}
