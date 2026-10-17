import { z } from "zod";

export const AUDIO_ANALYSIS_CONTRACT_VERSION = 1;
export const AUDIO_LOUDNESS_TOLERANCE_LU = 1;
export const AUDIO_MAX_TRUE_PEAK_DBTP = -1;

const loudnormMeasurementSchema = z.object({
  input_i: measurementNumberString(),
  input_lra: finiteNumberString(),
  input_thresh: measurementNumberString(),
  input_tp: measurementNumberString(),
}).passthrough();

export interface AudioLoudnessAnalysis {
  contract_version: typeof AUDIO_ANALYSIS_CONTRACT_VERSION;
  integrated_lufs: number | null;
  loudness_range_lu: number;
  measured_threshold_lufs: number | null;
  passed: boolean;
  target_integrated_lufs: number;
  target_true_peak_dbtp: number;
  tolerance_lu: typeof AUDIO_LOUDNESS_TOLERANCE_LU;
  true_peak_dbtp: number | null;
}

export class AudioLoudnessQualityError extends Error {
  constructor() {
    super("AUDIO_LOUDNESS_QA_FAILED");
  }
}

export function requirePassingAudioLoudness(analysis: AudioLoudnessAnalysis): void {
  if (!analysis.passed) throw new AudioLoudnessQualityError();
}

export function buildLoudnessAnalysisArgs(
  inputPath: string,
  target: { integratedLufs: number; loudnessRangeLu: number; truePeakDbtp: number },
) {
  assertLocalWorkerPath(inputPath);
  return [
    "-hide_banner", "-nostdin", "-v", "info", "-i", inputPath,
    "-map", "0:a:0", "-vn",
    "-af", `loudnorm=I=${target.integratedLufs}:LRA=${target.loudnessRangeLu}:TP=${target.truePeakDbtp}:print_format=json`,
    "-f", "null", "-",
  ];
}

/**
 * FFmpeg writes loudnorm JSON to stderr together with diagnostic text. Parse
 * only bounded JSON candidates and validate every numeric field before use.
 */
export function parseLoudnessAnalysis(
  stderr: string,
  target: { integratedLufs: number; truePeakDbtp: number },
): AudioLoudnessAnalysis {
  if (stderr.length > 512 * 1024) throw new Error("AUDIO_ANALYSIS_OUTPUT_TOO_LARGE");

  const candidates = stderr.match(/\{[^{}]{1,4096}\}/g) || [];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = loudnormMeasurementSchema.safeParse(JSON.parse(candidates[index]));
      if (!parsed.success) continue;
      const integratedLufs = parseMeasurementNumber(parsed.data.input_i);
      const loudnessRangeLu = Number(parsed.data.input_lra);
      const measuredThresholdLufs = parseMeasurementNumber(parsed.data.input_thresh);
      const truePeakDbtp = parseMeasurementNumber(parsed.data.input_tp);
      const passed = integratedLufs !== null
        && truePeakDbtp !== null
        && Math.abs(integratedLufs - target.integratedLufs) <= AUDIO_LOUDNESS_TOLERANCE_LU
        && truePeakDbtp <= AUDIO_MAX_TRUE_PEAK_DBTP;

      return {
        contract_version: AUDIO_ANALYSIS_CONTRACT_VERSION,
        integrated_lufs: integratedLufs,
        loudness_range_lu: loudnessRangeLu,
        measured_threshold_lufs: measuredThresholdLufs,
        passed,
        target_integrated_lufs: target.integratedLufs,
        target_true_peak_dbtp: target.truePeakDbtp,
        tolerance_lu: AUDIO_LOUDNESS_TOLERANCE_LU,
        true_peak_dbtp: truePeakDbtp,
      };
    } catch {
      // FFmpeg may include unrelated JSON-like diagnostics. Continue safely.
    }
  }
  throw new Error("AUDIO_ANALYSIS_MEASUREMENT_MISSING");
}

function finiteNumberString() {
  return z.string().refine((value) => Number.isFinite(Number(value)));
}

function measurementNumberString() {
  return z.string().refine((value) => Number.isFinite(Number(value)) || /^[-+]?inf(?:inity)?$/i.test(value));
}

function parseMeasurementNumber(value: string) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function assertLocalWorkerPath(value: string) {
  if (!value.trim() || value.includes("\0") || /^(?:https?|file):/i.test(value)) {
    throw new Error("AUDIO_ANALYSIS_INPUT_PATH_INVALID");
  }
}
