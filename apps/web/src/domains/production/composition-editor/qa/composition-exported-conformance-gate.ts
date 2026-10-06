import type { CompositionConformanceReport } from "../composition-preview-render-conformance";
import type { ExportedAudioLoudnessReport } from "./composition-exported-audio-loudness";
import type { AudioTimingReport } from "./composition-exported-audio-timing";
import type { ExportedColorTagReport } from "./composition-exported-color-tags";
import { z } from "zod";

export const exportedAudioPresenceStatusSchema = z.enum(["EXPECTATION_UNKNOWN", "MISSING_REQUIRED_TRACK", "NOT_REQUIRED",
  "REQUIRED_AUDIO_BELOW_FLOOR", "SIGNAL_ABOVE_FLOOR_NOT_FULLY_EVALUATED"]);
export type ExportedAudioPresenceStatus = z.infer<typeof exportedAudioPresenceStatusSchema>;

/** Pure composition of measured obligations, never an approval of QA/publication. */
export function evaluateExportedVideoConformanceStatus(input: {
  audioStatus: ExportedAudioPresenceStatus;
  audioLoudnessStatus: ExportedAudioLoudnessReport["status"];
  visualStatus: CompositionConformanceReport["status"];
  audioTimingStatus?: AudioTimingReport["status"];
  audioRmsStatus?: AudioTimingReport["rms"]["status"];
  colorTagStatus?: ExportedColorTagReport["status"];
  colorChartStatus?: "PASS" | "FAIL";
}): CompositionConformanceReport["status"] {
  if (input.audioStatus === "MISSING_REQUIRED_TRACK" || input.audioStatus === "REQUIRED_AUDIO_BELOW_FLOOR"
    || input.audioLoudnessStatus === "FAIL" || input.audioLoudnessStatus === "MEASUREMENT_FAILED"
    || input.audioTimingStatus === "FAIL" || input.audioTimingStatus === "MEASUREMENT_FAILED" || input.audioRmsStatus === "FAIL"
    || input.colorTagStatus === "FAIL" || input.colorChartStatus === "FAIL") return "FAIL";
  if (input.visualStatus !== "PASS") return input.visualStatus;
  const requiredAudioIncomplete = input.audioStatus === "SIGNAL_ABOVE_FLOOR_NOT_FULLY_EVALUATED"
    && (input.audioLoudnessStatus !== "PASS" || input.audioTimingStatus !== "PASS" || input.audioRmsStatus !== "PASS");
  // A missing obligation or measurement is not evidence of parity. Audio explicitly
  // absent from the frozen document need not have an unrequested timing comparison.
  return input.audioStatus === "EXPECTATION_UNKNOWN" || requiredAudioIncomplete
    || input.audioLoudnessStatus === "MEASURED_POLICY_NOT_SET" || input.audioTimingStatus === "INCOMPLETE"
    || input.audioRmsStatus === "INCOMPLETE" || input.colorTagStatus === "INCOMPLETE" ? "INCOMPLETE" : "PASS";
}
