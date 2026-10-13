import type { CompositionEditorDocument } from "./composition-document.types";
import type { CompositionClipVolumeAutomation } from "./composition-audio-mix.service";
import {
  resolveCompositionClipAudioVolume,
  compositionClipHasConfigurableAudio,
} from "./composition-clip-audio.service";
import { evaluateVolumeEnvelope } from "./composition-volume-envelope";
import { resolvePlaybackVolume } from "./composition-volume-interpolation";

/** Shared deterministic subdivision of products of linear gain ramps. */
const GAIN_PRODUCT_SEGMENTS = 16;

export function applyAuthoredVolumeEnvelopes(
  document: CompositionEditorDocument,
  base: CompositionClipVolumeAutomation[],
  audioWindows?: ReadonlyMap<
    string,
    { startSeconds: number; endSeconds: number }
  >,
) {
  const automations = new Map(
    base.map((automation) => [automation.targetClipId, automation]),
  );
  const tracks = new Map(document.tracks.map((track) => [track.id, track]));
  for (const clip of document.clips) {
    const track = tracks.get(clip.trackId);
    if (
      !clip.volumeEnvelope?.length ||
      !compositionClipHasConfigurableAudio(clip, track) ||
      clip.hidden ||
      track?.hidden ||
      track?.muted
    )
      continue;
    const baselineVolume = resolveCompositionClipAudioVolume(clip, track);
    const existing = automations.get(clip.id);
    const rate = clip.playbackRate ?? 1;
    const window = audioWindows?.get(clip.id);
    const start = window?.startSeconds ?? clip.startSeconds;
    const end = window?.endSeconds ?? clip.startSeconds + clip.durationSeconds;
    const breakpoints = [
      ...new Set([
        start,
        end,
        clip.startSeconds,
        clip.startSeconds + clip.durationSeconds,
        ...(existing?.points.map((point) => point.timeSeconds) ?? []),
        ...clip.volumeEnvelope
          .map(
            (point) =>
              clip.startSeconds +
              (point.sourceTimeSeconds - (clip.sourceOffsetSeconds ?? 0)) /
                rate,
          )
          .filter((time) => time > start && time < end),
      ]),
    ].sort((left, right) => left - right);
    const times = new Set(breakpoints);
    for (let index = 1; index < breakpoints.length; index += 1)
      for (let segment = 1; segment < GAIN_PRODUCT_SEGMENTS; segment += 1) {
        times.add(
          breakpoints[index - 1] +
            ((breakpoints[index] - breakpoints[index - 1]) * segment) /
              GAIN_PRODUCT_SEGMENTS,
        );
      }
    const points = [...times]
      .sort((left, right) => left - right)
      .map((timeSeconds) => ({
        timeSeconds,
        volume:
          resolvePlaybackVolume(
            existing?.points ?? [],
            timeSeconds,
            baselineVolume,
          ) *
          evaluateVolumeEnvelope(
            clip.volumeEnvelope!,
            (clip.sourceOffsetSeconds ?? 0) +
              (timeSeconds - clip.startSeconds) * rate,
          ),
      }));
    automations.set(clip.id, { targetClipId: clip.id, baselineVolume, points });
  }
  return document.clips.flatMap((clip) =>
    automations.has(clip.id) ? [automations.get(clip.id)!] : [],
  );
}
