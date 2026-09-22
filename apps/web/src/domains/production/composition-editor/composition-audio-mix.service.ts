import type {
  CompositionClip,
  CompositionEditorDocument,
  CompositionTrack,
  CompositionTrackRole,
} from "./composition-document.types";
import {
  compositionClipHasConfigurableAudio,
  resolveCompositionClipAudioVolume,
} from "./composition-clip-audio.service";

export interface CompositionVolumePoint {
  timeSeconds: number;
  volume: number;
}

export interface CompositionClipVolumeAutomation {
  baselineVolume: number;
  points: CompositionVolumePoint[];
  targetClipId: string;
}

interface TimeInterval {
  endSeconds: number;
  startSeconds: number;
}

/**
 * Builds seek-safe volume envelopes from persisted clip timing. The result is
 * framework-agnostic so preview and render can compile the same automation.
 */
export function buildCompositionVolumeAutomations(
  document: CompositionEditorDocument,
): CompositionClipVolumeAutomation[] {
  const { ducking } = document.audioMix;
  const tracksById = new Map(document.tracks.map((track) => [track.id, track]));
  const triggerRoles = new Set<CompositionTrackRole>(ducking.triggerRoles);
  const triggerIntervals = mergeTriggerIntervals(
    ducking.enabled && ducking.duckedVolumeRatio < 1
      ? document.clips
      .filter((clip) => isAudibleTriggerClip(clip, tracksById.get(clip.trackId), triggerRoles))
      .map(toInterval)
      : [],
    ducking.attackSeconds + ducking.releaseSeconds,
  );

  const duckingAutomations = triggerIntervals.length === 0 ? [] : document.clips.flatMap((clip) => {
    const track = tracksById.get(clip.trackId);
    if (!isDuckingTargetClip(clip, track, ducking.targetRole)) return [];
    const baselineVolume = resolveCompositionClipAudioVolume(clip, track);
    if (baselineVolume === 0) return [];
    const duckedVolume = roundVolume(baselineVolume * ducking.duckedVolumeRatio);
    const clipInterval = toInterval(clip);
    const relevantTriggers = triggerIntervals.filter((interval) => (
      interval.endSeconds + ducking.releaseSeconds > clipInterval.startSeconds
      && interval.startSeconds - ducking.attackSeconds < clipInterval.endSeconds
    ));
    if (relevantTriggers.length === 0) return [];

    const breakpointTimes = new Set<number>([clipInterval.startSeconds, clipInterval.endSeconds]);
    for (const interval of relevantTriggers) {
      breakpointTimes.add(clampTime(interval.startSeconds - ducking.attackSeconds, clipInterval));
      breakpointTimes.add(clampTime(interval.startSeconds, clipInterval));
      breakpointTimes.add(clampTime(interval.endSeconds, clipInterval));
      breakpointTimes.add(clampTime(interval.endSeconds + ducking.releaseSeconds, clipInterval));
    }
    const points = [...breakpointTimes]
      .sort((left, right) => left - right)
      .map((timeSeconds) => ({
        timeSeconds: roundSeconds(timeSeconds),
        volume: resolveVolumeAtTime({
          attackSeconds: ducking.attackSeconds,
          baselineVolume,
          duckedVolume,
          intervals: relevantTriggers,
          releaseSeconds: ducking.releaseSeconds,
          timeSeconds,
        }),
      }))
      .filter((point, index, allPoints) => (
        index === 0
        || point.timeSeconds !== allPoints[index - 1]?.timeSeconds
        || point.volume !== allPoints[index - 1]?.volume
      ));

    return [{ baselineVolume, points, targetClipId: clip.id }];
  });

  const duckingByClipId = new Map(duckingAutomations.map((automation) => [automation.targetClipId, automation]));
  return document.clips.flatMap((clip) => {
    const track = tracksById.get(clip.trackId);
    if (!compositionClipHasConfigurableAudio(clip, track) || clip.hidden || track?.hidden || track?.muted) return [];
    const fadeInSeconds = clip.fadeInSeconds || 0;
    const fadeOutSeconds = clip.fadeOutSeconds || 0;
    const duckingAutomation = duckingByClipId.get(clip.id);
    if (fadeInSeconds <= 0 && fadeOutSeconds <= 0) return duckingAutomation ? [duckingAutomation] : [];

    const baselineVolume = resolveCompositionClipAudioVolume(clip, track);
    if (baselineVolume === 0) return [];
    const interval = toInterval(clip);
    const breakpointTimes = new Set<number>([
      interval.startSeconds,
      interval.endSeconds,
      ...(duckingAutomation?.points.map((point) => point.timeSeconds) || []),
    ]);
    if (fadeInSeconds > 0) breakpointTimes.add(interval.startSeconds + fadeInSeconds);
    if (fadeOutSeconds > 0) breakpointTimes.add(interval.endSeconds - fadeOutSeconds);
    const points = [...breakpointTimes]
      .sort((left, right) => left - right)
      .map((timeSeconds) => {
        const duckedVolume = duckingAutomation
          ? interpolateAutomationVolume(duckingAutomation.points, timeSeconds)
          : baselineVolume;
        return {
          timeSeconds: roundSeconds(timeSeconds),
          volume: roundVolume(duckedVolume * resolveFadeGain(interval, fadeInSeconds, fadeOutSeconds, timeSeconds)),
        };
      });
    return [{ baselineVolume, points, targetClipId: clip.id }];
  });
}

function interpolateAutomationVolume(points: CompositionVolumePoint[], timeSeconds: number) {
  const first = points[0];
  if (!first) return 1;
  if (timeSeconds <= first.timeSeconds) return first.volume;
  for (let index = 1; index < points.length; index += 1) {
    const next = points[index]!;
    const previous = points[index - 1]!;
    if (timeSeconds > next.timeSeconds) continue;
    const duration = next.timeSeconds - previous.timeSeconds;
    return duration <= 0 ? next.volume : interpolate(previous.volume, next.volume, (timeSeconds - previous.timeSeconds) / duration);
  }
  return points[points.length - 1]!.volume;
}

function resolveFadeGain(interval: TimeInterval, fadeInSeconds: number, fadeOutSeconds: number, timeSeconds: number) {
  const fadeInGain = fadeInSeconds > 0
    ? Math.min(1, Math.max(0, (timeSeconds - interval.startSeconds) / fadeInSeconds))
    : 1;
  const fadeOutGain = fadeOutSeconds > 0
    ? Math.min(1, Math.max(0, (interval.endSeconds - timeSeconds) / fadeOutSeconds))
    : 1;
  return Math.min(fadeInGain, fadeOutGain);
}

function isAudibleTriggerClip(
  clip: CompositionClip,
  track: CompositionTrack | undefined,
  triggerRoles: ReadonlySet<CompositionTrackRole>,
) {
  const role = resolveTrackRole(track, clip.trackId);
  if (!role || !triggerRoles.has(role)) return false;
  if (clip.hidden || track?.hidden || track?.muted || (track?.volume ?? 1) <= 0) return false;
  if (!compositionClipHasConfigurableAudio(clip, track) || resolveCompositionClipAudioVolume(clip, track) <= 0) return false;
  return role === "VOICE" ? clip.kind === "AUDIO" : clip.kind === "VIDEO";
}

function isDuckingTargetClip(
  clip: CompositionClip,
  track: CompositionTrack | undefined,
  targetRole: "MUSIC",
) {
  return clip.kind === "AUDIO"
    && compositionClipHasConfigurableAudio(clip, track)
    && resolveTrackRole(track, clip.trackId) === targetRole
    && !clip.hidden
    && !track?.hidden
    && !track?.muted;
}

function resolveTrackRole(track: CompositionTrack | undefined, trackId: string): CompositionTrackRole | undefined {
  if (track?.semanticRole) return track.semanticRole;
  if (trackId === "voice") return "VOICE";
  if (trackId === "avatar") return "AVATAR";
  if (trackId === "music" || trackId === "audio") return "MUSIC";
  return undefined;
}

function mergeTriggerIntervals(intervals: TimeInterval[], transitionOverlapSeconds: number) {
  const sorted = intervals.slice().sort((left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds);
  const merged: TimeInterval[] = [];
  for (const interval of sorted) {
    const current = merged[merged.length - 1];
    if (!current || interval.startSeconds > current.endSeconds + transitionOverlapSeconds) {
      merged.push({ ...interval });
      continue;
    }
    current.endSeconds = Math.max(current.endSeconds, interval.endSeconds);
  }
  return merged;
}

function resolveVolumeAtTime(params: {
  attackSeconds: number;
  baselineVolume: number;
  duckedVolume: number;
  intervals: TimeInterval[];
  releaseSeconds: number;
  timeSeconds: number;
}) {
  let volume = params.baselineVolume;
  for (const interval of params.intervals) {
    const attackStart = interval.startSeconds - params.attackSeconds;
    const releaseEnd = interval.endSeconds + params.releaseSeconds;
    if (params.timeSeconds < attackStart || params.timeSeconds > releaseEnd) continue;
    if (params.timeSeconds < interval.startSeconds && params.attackSeconds > 0) {
      const progress = (params.timeSeconds - attackStart) / params.attackSeconds;
      volume = Math.min(volume, interpolate(params.baselineVolume, params.duckedVolume, progress));
    } else if (params.timeSeconds <= interval.endSeconds) {
      volume = Math.min(volume, params.duckedVolume);
    } else if (params.releaseSeconds > 0) {
      const progress = (params.timeSeconds - interval.endSeconds) / params.releaseSeconds;
      volume = Math.min(volume, interpolate(params.duckedVolume, params.baselineVolume, progress));
    }
  }
  return roundVolume(volume);
}

function interpolate(from: number, to: number, progress: number) {
  return from + (to - from) * Math.max(0, Math.min(1, progress));
}

function toInterval(clip: CompositionClip): TimeInterval {
  return {
    endSeconds: clip.startSeconds + clip.durationSeconds,
    startSeconds: clip.startSeconds,
  };
}

function clampTime(value: number, interval: TimeInterval) {
  return Math.max(interval.startSeconds, Math.min(interval.endSeconds, value));
}

function clampVolume(value: number) {
  return Math.max(0, Math.min(1, value));
}

function roundSeconds(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

function roundVolume(value: number) {
  return Math.round(clampVolume(value) * 10_000) / 10_000;
}
