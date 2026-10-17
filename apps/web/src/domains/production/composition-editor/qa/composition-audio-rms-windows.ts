import { AUDIO_RMS_WINDOW_POLICY, AUDIO_TIMING_POLICY } from "./composition-audio-conformance-policy";
import { StereoPcmEnergyAccumulator, type StereoEnergyWindows } from "./composition-pcm-energy-stream";

export type { StereoEnergyWindows } from "./composition-pcm-energy-stream";
export interface AudioRmsWindowReport {
  status: "NOT_REQUESTED" | "PASS" | "FAIL" | "INCOMPLETE";
  policy: typeof AUDIO_RMS_WINDOW_POLICY;
  reason: string | null;
  comparedChannelWindows: number;
  silentChannelWindows: number;
  failedChannelWindows: number;
  maximumObservedDeltaDb: number | null;
  failures: Array<{ channel: number; windowIndex: number; deltaDb: number | null; reason: "RMS_DELTA_EXCEEDED" | "CHANNEL_ACTIVITY_MISMATCH" }>;
}
export function audioRmsWindowReport(status: AudioRmsWindowReport["status"], reason: string | null = null): AudioRmsWindowReport {
  return { status, policy: AUDIO_RMS_WINDOW_POLICY, reason, comparedChannelWindows: 0, silentChannelWindows: 0,
    failedChannelWindows: 0, maximumObservedDeltaDb: null, failures: [] };
}

/** Packed f32le stereo. Includes the final partial window with its exact sample count. */
export function buildStereoPcmEnergyWindows(pcm: Buffer, windowMilliseconds: number): StereoEnergyWindows {
  const accumulator = new StereoPcmEnergyAccumulator(windowMilliseconds);
  accumulator.push(pcm); return accumulator.finish();
}

function assertCanonicalWindows(windows: StereoEnergyWindows) {
  const framesPerWindow = AUDIO_RMS_WINDOW_POLICY.sampleRate * AUDIO_RMS_WINDOW_POLICY.windowMilliseconds / 1_000;
  const maximumWindows = Math.ceil((AUDIO_TIMING_POLICY.maximumDurationSeconds + 1) * 1_000 / AUDIO_RMS_WINDOW_POLICY.windowMilliseconds);
  if (!windows.sampleCounts.length || windows.sampleCounts.length > maximumWindows
    || windows.channels.length !== 2 || windows.channels.some((channel) => channel.length !== windows.sampleCounts.length
      || channel.some((value) => !Number.isFinite(value) || value < 0 || value > 32))
    || windows.sampleCounts.some((count, index) => !Number.isInteger(count) || count <= 0 || count > framesPerWindow
      || index < windows.sampleCounts.length - 1 && count !== framesPerWindow)) throw new Error("AUDIO_TIMING_RMS_WINDOWS_INVALID");
}

/** Compare at the same timeline positions: never align away drift, normalize gain, or discard a channel/tail. */
export function compareStereoRmsWindows(reference: StereoEnergyWindows, rendered: StereoEnergyWindows): AudioRmsWindowReport {
  assertCanonicalWindows(reference); assertCanonicalWindows(rendered);
  if (reference.sampleCounts.length !== rendered.sampleCounts.length
    || reference.sampleCounts.some((count, index) => count !== rendered.sampleCounts[index])) {
    return audioRmsWindowReport("INCOMPLETE", "CANONICAL_WINDOW_COVERAGE_MISMATCH");
  }
  const report = audioRmsWindowReport("PASS");
  for (let channel = 0; channel < 2; channel++) for (let windowIndex = 0; windowIndex < reference.sampleCounts.length; windowIndex++) {
    const referenceRms = reference.channels[channel]![windowIndex]!;
    const renderedRms = rendered.channels[channel]![windowIndex]!;
    const referenceSilent = referenceRms <= AUDIO_RMS_WINDOW_POLICY.silenceRms;
    const renderedSilent = renderedRms <= AUDIO_RMS_WINDOW_POLICY.silenceRms;
    if (referenceSilent && renderedSilent) { report.silentChannelWindows++; continue; }
    report.comparedChannelWindows++;
    // A silence crossing has no finite, meaningful ratio; persist null, never Infinity/NaN.
    const deltaDb = referenceSilent !== renderedSilent ? null : Math.abs(20 * Math.log10(renderedRms / referenceRms));
    if (deltaDb !== null) report.maximumObservedDeltaDb = Math.max(report.maximumObservedDeltaDb ?? 0, deltaDb);
    if (deltaDb === null || deltaDb > AUDIO_RMS_WINDOW_POLICY.maximumDeltaDb) {
      report.failedChannelWindows++;
      if (report.failures.length < AUDIO_RMS_WINDOW_POLICY.maximumRecordedFailures) report.failures.push({ channel, windowIndex, deltaDb,
        reason: deltaDb === null ? "CHANNEL_ACTIVITY_MISMATCH" : "RMS_DELTA_EXCEEDED" });
    }
  }
  if (report.failedChannelWindows) { report.status = "FAIL"; report.reason = "RMS_WINDOW_MISMATCH"; }
  else if (!report.comparedChannelWindows) { report.status = "INCOMPLETE"; report.reason = "SILENT_PROGRAM"; }
  return report;
}
