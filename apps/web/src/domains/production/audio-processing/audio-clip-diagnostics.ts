import type { AudioLoudnessAnalysis } from "./audio-processing.types";

export interface AudioClipDiagnostics {
  gainDecibels: number | null;
  estimatedTruePeakDbtp: number | null;
  status: "MUTED" | "UNMEASURED" | "SILENT" | "REVIEW_SOURCE" | "PEAK_ABOVE_TARGET" | "MEASURED";
}

/** The source peak plus constant gain is an estimate, never approval of a mix or trimmed clip. */
export function diagnoseAudioClip(
  analysis: AudioLoudnessAnalysis | null | undefined,
  effectiveVolume: number,
): AudioClipDiagnostics {
  if (!Number.isFinite(effectiveVolume) || effectiveVolume < 0 || effectiveVolume > 1) {
    throw new Error("AUDIO_CLIP_GAIN_INVALID");
  }
  if (effectiveVolume === 0) return { estimatedTruePeakDbtp: null, gainDecibels: null, status: "MUTED" };
  const gainDecibels = 20 * Math.log10(effectiveVolume);
  if (!analysis) return { estimatedTruePeakDbtp: null, gainDecibels, status: "UNMEASURED" };
  const estimatedTruePeakDbtp = analysis.truePeakDbtp === null ? null : analysis.truePeakDbtp + gainDecibels;
  const status = analysis.integratedLufs === null && analysis.truePeakDbtp === null
    ? "SILENT"
    : estimatedTruePeakDbtp !== null && estimatedTruePeakDbtp > analysis.targetTruePeakDbtp
      ? "PEAK_ABOVE_TARGET"
      : !analysis.passed || analysis.integratedLufs === null || analysis.truePeakDbtp === null
        ? "REVIEW_SOURCE"
        : "MEASURED";
  return { estimatedTruePeakDbtp, gainDecibels, status };
}
