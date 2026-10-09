import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";
import type {ExportedVideoConformanceReport} from "./composition-exported-video-conformance";
import {isDeepStrictEqual} from "node:util";
import {audioTimingReport} from "./composition-exported-audio-timing";

/** Silence is a frozen obligation, not a fallback when audio evidence is missing. */
export function assertSilentConformanceContract(input: unknown) {
  const contract = compositionConformanceContractSchema.parse(input);
  if (contract.schemaVersion === 1 || contract.audio.required)
    throw new Error("CONFORMANCE_SILENT_AUDIO_EXPECTATION_INVALID");
  return contract;
}

/** Does not promote visual/renderer status or manufacture timing/RMS measurements. */
export function assertSilentConformanceMeasurement(contractInput: unknown,
  report: Pick<ExportedVideoConformanceReport, "documentHash" | "audioStatus" | "audioTiming" | "audioLoudness" | "video">
    & {audioPlayback?: unknown}) {
  const contract = assertSilentConformanceContract(contractInput);
  if (report.documentHash !== contract.documentHash) throw new Error("CONFORMANCE_SILENT_MEASUREMENT_INVALID");
  assertSilentConformanceAudioReport(report);
}

/** Shared with durable V2 validation; the worker separately binds the frozen contract. */
export function assertSilentConformanceAudioReport(report: {
  video: {hasAudio?: unknown}; audioStatus?: unknown; audioTiming: unknown;
  audioLoudness?: {status?: unknown; measurement?: unknown}; audioPlayback?: unknown;
}) {
  if (report.video.hasAudio !== false
    || report.audioStatus !== "NOT_REQUIRED" || report.audioLoudness?.status !== "NOT_APPLICABLE"
    || !isDeepStrictEqual(report.audioTiming, audioTimingReport("NOT_REQUESTED"))
    || report.audioLoudness?.measurement !== null || report.audioPlayback !== undefined)
    throw new Error("CONFORMANCE_SILENT_MEASUREMENT_INVALID");
}
