import { buildCompositionVolumeAutomations, type CompositionClipVolumeAutomation } from "./composition-audio-mix.service";
import { resolvePlaybackVolume } from "./composition-volume-interpolation";
export { resolvePlaybackVolume } from "./composition-volume-interpolation";
import { applyAuthoredVolumeEnvelopes } from "./composition-authored-volume";
import { resolveCompositionClipAudioVolume } from "./composition-clip-audio.service";
import type { CompositionEditorDocument } from "./composition-document.types";
import { buildCompositionTransitionRuntime, type CompositionTransitionRuntime } from "./composition-transition-runtime";

export const COMPOSITION_PLAYBACK_AUDIO_ENVELOPE_VERSION = 2;
export const COMPOSITION_AUDIO_CROSSFADE_SEGMENTS = 16;

/** Audio crossfades are linear and independent of visual easing; gains multiply authored fade/duck envelopes. */
export function buildCompositionPlaybackVolumeAutomations(
  document: CompositionEditorDocument,
  runtime: CompositionTransitionRuntime = buildCompositionTransitionRuntime(document),
): CompositionClipVolumeAutomation[] {
  const base = applyAuthoredVolumeEnvelopes(document, buildCompositionVolumeAutomations(document), runtime.audioWindowsByClipId);
  const crossfades = runtime.items.filter((transition) => transition.audioMode === "CROSSFADE");
  if (!crossfades.length) return base;
  const automations = new Map(base.map((automation) => [automation.targetClipId, automation]));
  const clips = new Map(document.clips.map((clip) => [clip.id, clip]));
  const tracks = new Map(document.tracks.map((track) => [track.id, track]));
  const affectedIds = new Set(crossfades.flatMap((transition) => [transition.fromClipId, transition.toClipId]));
  for (const clipId of affectedIds) {
    const clip = clips.get(clipId)!;
    const window = runtime.audioWindowsByClipId.get(clipId)!;
    const baselineVolume = resolveCompositionClipAudioVolume(clip, tracks.get(clip.trackId));
    const basePoints = automations.get(clipId)?.points || [];
    const transitions = crossfades.filter((transition) => transition.fromClipId === clipId || transition.toClipId === clipId);
    const times = new Set([window.startSeconds, window.endSeconds,
      ...basePoints.filter((point) => point.timeSeconds >= window.startSeconds && point.timeSeconds <= window.endSeconds).map((point) => point.timeSeconds)]);
    // Subdivision also covers products of ramping fade/duck gain with crossfade gain.
    // It defines one deterministic piecewise policy, rather than competing timeline tweens.
    for (const transition of transitions) for (let segment = 0; segment <= COMPOSITION_AUDIO_CROSSFADE_SEGMENTS; segment++) {
      times.add(transition.startSeconds + transition.durationSeconds * segment / COMPOSITION_AUDIO_CROSSFADE_SEGMENTS);
    }
    const points = [...times].sort((left, right) => left - right).map((timeSeconds) => {
      let gain = 1;
      for (const transition of transitions) {
        const progress = Math.max(0, Math.min(1, (timeSeconds - transition.startSeconds) / transition.durationSeconds));
        gain *= transition.toClipId === clipId ? progress : 1 - progress;
      }
      return { timeSeconds, volume: resolvePlaybackVolume(basePoints, timeSeconds, baselineVolume) * gain };
    });
    automations.set(clipId, { targetClipId: clipId, baselineVolume, points });
  }
  return document.clips.flatMap((clip) => automations.has(clip.id) ? [automations.get(clip.id)!] : []);
}
