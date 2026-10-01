import type { z } from "zod";
import { playbackWitnessSchema } from "./composition-playback-audio-contract";
import type { AudioTimingReport } from "./composition-exported-audio-timing";
import { AUDIO_TIMING_POLICY } from "./composition-audio-conformance-policy";
import { evaluateMediaBoundaries } from "./composition-playback-boundaries";
import { PLAYBACK_CAPTURE_POLICY } from "./composition-playback-capture-runtime";

export const PLAYBACK_AV_POLICY = Object.freeze({id: "browser-av-clock-and-boundaries-v2", maximumAvDriftMilliseconds: 20,
  eventToleranceFrames: 1, uncertainty: "OBSERVED_RENDER_QUANTUM_PLUS_LAG_GRID"} as const);
/** Clock/decoded media timing, not semantic lip-sync or an acoustic/device measurement. */
export function evaluatePlaybackAudioWitness(witness: z.infer<typeof playbackWitnessSchema>, timing: AudioTimingReport,
  fps: number, clipCount: number) {
  witness = playbackWitnessSchema.parse(witness);
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("AUDIO_PLAYBACK_FPS_INVALID");
  if (!Number.isSafeInteger(clipCount) || clipCount < 0 || clipCount > 64) throw new Error("AUDIO_PLAYBACK_CLIP_COUNT_INVALID");
  const report = {policy: PLAYBACK_AV_POLICY, witness, status: "PASS" as "PASS" | "FAIL" | "INCOMPLETE",
    reason: null as string | null, effectiveEventToleranceMilliseconds: 1000 / fps,
    maximumAvDriftUpperBoundMilliseconds: null as number | null, maximumMediaDriftUpperBoundMilliseconds: null as number | null,
    boundaries: evaluateMediaBoundaries(witness.boundaries, witness.originFrame, PLAYBACK_CAPTURE_POLICY.sampleRate,
      witness.quantumMilliseconds, 1000 / fps, clipCount)};
  if (report.boundaries.status === "FAIL") return {...report, status: "FAIL" as const, reason: "PLAYBACK_MEDIA_BOUNDARIES_FAILED"};
  if (timing.lagMilliseconds === null || witness.eventCount < clipCount) return {...report, status: "INCOMPLETE" as const, reason: "PLAYBACK_EVENT_OR_LAG_EVIDENCE_MISSING"};
  const av = witness.maxClockDriftMilliseconds + Math.abs(timing.lagMilliseconds);
  const uncertainty = witness.quantumMilliseconds + AUDIO_TIMING_POLICY.lagUncertaintyMilliseconds;
  report.maximumAvDriftUpperBoundMilliseconds = av + uncertainty;
  report.maximumMediaDriftUpperBoundMilliseconds = witness.maxMediaDriftMilliseconds + witness.quantumMilliseconds;
  if (av - uncertainty > PLAYBACK_AV_POLICY.maximumAvDriftMilliseconds
    || witness.maxMediaDriftMilliseconds - witness.quantumMilliseconds > report.effectiveEventToleranceMilliseconds) {
    return {...report, status: "FAIL" as const, reason: "PLAYBACK_TIMING_OUTSIDE_TOLERANCE"};
  }
  if (av + uncertainty > PLAYBACK_AV_POLICY.maximumAvDriftMilliseconds
    || report.maximumMediaDriftUpperBoundMilliseconds > report.effectiveEventToleranceMilliseconds) {
    return {...report, status: "INCOMPLETE" as const, reason: "PLAYBACK_TIMING_UNCERTAINTY_BOUNDARY"};
  }
  return report.boundaries.status === "INCOMPLETE" ? {...report, status: "INCOMPLETE" as const, reason: "PLAYBACK_MEDIA_BOUNDARIES_INCOMPLETE"} : report;
}
export type PlaybackAudioGateReport = ReturnType<typeof evaluatePlaybackAudioWitness>;
