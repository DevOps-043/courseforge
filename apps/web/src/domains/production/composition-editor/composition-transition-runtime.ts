import type {
  CompositionClip,
  CompositionEditorDocument,
} from "./composition-document.types";
import { resolveCompositionClipAudioVolume } from "./composition-clip-audio.service";
import { resolveCompositionTransitionEligibility } from "./composition-transition.service";
import type { CompositionTransition } from "./composition-transition.types";

export interface CompositionTransitionRuntimeClipWindow {
  durationSeconds: number;
  endSeconds: number;
  sourceOffsetSeconds: number;
  startSeconds: number;
}

export interface CompositionTransitionRuntimeItem {
  audioMode: CompositionTransition["audioMode"];
  direction?: "DOWN" | "LEFT" | "RIGHT" | "UP";
  durationSeconds: number;
  easing: CompositionTransition["easing"];
  endSeconds: number;
  fromClipId: string;
  fromAudioTargetId?: string;
  fromAudioVolume?: number;
  fromOpacity: number;
  id: string;
  overlayColor?: string;
  overlayId?: string;
  startSeconds: number;
  toClipId: string;
  toAudioTargetId?: string;
  toAudioVolume?: number;
  toOpacity: number;
  type: CompositionTransition["type"];
  blurPixels?: number;
}

export interface CompositionTransitionRuntime {
  audioWindowsByClipId: ReadonlyMap<string, CompositionTransitionRuntimeClipWindow>;
  clipWindowsById: ReadonlyMap<string, CompositionTransitionRuntimeClipWindow>;
  items: CompositionTransitionRuntimeItem[];
}

/**
 * Produces the timing projection consumed by both interactive preview and
 * HyperFrames render. Canonical clip timing stays untouched; only the
 * disposable runtime windows are extended into verified media handles.
 */
export function buildCompositionTransitionRuntime(
  document: CompositionEditorDocument,
): CompositionTransitionRuntime {
  const clipWindowsById = new Map(
    document.clips.map((clip) => [clip.id, canonicalWindow(clip)] as const),
  );
  const audioWindowsByClipId = new Map(
    document.clips.map((clip) => [clip.id, canonicalWindow(clip)] as const),
  );
  const tracksById = new Map(document.tracks.map((track) => [track.id, track]));
  const items = (document.transitions?.items || []).map((transition) => {
    const eligibility = resolveCompositionTransitionEligibility({
      document,
      excludeTransitionId: transition.id,
      transition,
    });
    if (!eligibility.available || !eligibility.window) {
      throw new Error(
        eligibility.issues[0]?.message || `La transición ${transition.id} no se puede compilar.`,
      );
    }
    const fromClip = requireClip(document, transition.fromClipId);
    const toClip = requireClip(document, transition.toClipId);
    const window = eligibility.window;
    const fromWindow = clipWindowsById.get(fromClip.id)!;
    const toWindow = clipWindowsById.get(toClip.id)!;
    fromWindow.endSeconds = Math.max(fromWindow.endSeconds, window.endSeconds);
    fromWindow.durationSeconds = roundSeconds(fromWindow.endSeconds - fromWindow.startSeconds);
    toWindow.startSeconds = Math.min(toWindow.startSeconds, window.startSeconds);
    toWindow.durationSeconds = roundSeconds(toWindow.endSeconds - toWindow.startSeconds);
    toWindow.sourceOffsetSeconds = resolveRuntimeSourceOffset(toClip, toWindow.startSeconds);

    if (transition.audioMode === "CROSSFADE") {
      const fromAudioWindow = audioWindowsByClipId.get(fromClip.id)!;
      const toAudioWindow = audioWindowsByClipId.get(toClip.id)!;
      fromAudioWindow.endSeconds = Math.max(fromAudioWindow.endSeconds, window.endSeconds);
      fromAudioWindow.durationSeconds = roundSeconds(fromAudioWindow.endSeconds - fromAudioWindow.startSeconds);
      toAudioWindow.startSeconds = Math.min(toAudioWindow.startSeconds, window.startSeconds);
      toAudioWindow.durationSeconds = roundSeconds(toAudioWindow.endSeconds - toAudioWindow.startSeconds);
      toAudioWindow.sourceOffsetSeconds = resolveRuntimeSourceOffset(toClip, toAudioWindow.startSeconds);
    }

    return {
      ...(transition.parameters?.blurPixels !== undefined
        ? { blurPixels: transition.parameters.blurPixels }
        : {}),
      ...(transition.parameters?.direction
        ? { direction: transition.parameters.direction }
        : {}),
      audioMode: transition.audioMode,
      durationSeconds: transition.durationSeconds,
      easing: transition.easing,
      endSeconds: window.endSeconds,
      fromClipId: transition.fromClipId,
      fromOpacity: fromClip.layout.opacity,
      ...(transition.audioMode === "CROSSFADE" ? {
        fromAudioTargetId: `${transition.fromClipId}-audio`,
        fromAudioVolume: resolveCompositionClipAudioVolume(fromClip, tracksById.get(fromClip.trackId)),
      } : {}),
      id: transition.id,
      ...(transition.type === "DIP_TO_COLOR"
        ? {
            overlayColor: transition.parameters!.color,
            overlayId: `${transition.id}-overlay`,
          }
        : {}),
      startSeconds: window.startSeconds,
      toClipId: transition.toClipId,
      toOpacity: toClip.layout.opacity,
      ...(transition.audioMode === "CROSSFADE" ? {
        toAudioTargetId: `${transition.toClipId}-audio`,
        toAudioVolume: resolveCompositionClipAudioVolume(toClip, tracksById.get(toClip.trackId)),
      } : {}),
      type: transition.type,
    };
  });

  return { audioWindowsByClipId, clipWindowsById, items };
}

function canonicalWindow(clip: CompositionClip): CompositionTransitionRuntimeClipWindow {
  return {
    durationSeconds: clip.durationSeconds,
    endSeconds: roundSeconds(clip.startSeconds + clip.durationSeconds),
    sourceOffsetSeconds: clip.sourceOffsetSeconds || 0,
    startSeconds: clip.startSeconds,
  };
}

function resolveRuntimeSourceOffset(clip: CompositionClip, runtimeStartSeconds: number) {
  if (clip.kind !== "VIDEO") return clip.sourceOffsetSeconds || 0;
  return roundSeconds(Math.max(
    0,
    (clip.sourceOffsetSeconds || 0) - (clip.startSeconds - runtimeStartSeconds),
  ));
}

function requireClip(document: CompositionEditorDocument, clipId: string) {
  const clip = document.clips.find((candidate) => candidate.id === clipId);
  if (!clip) throw new Error(`La transición apunta al clip inexistente ${clipId}.`);
  return clip;
}

function roundSeconds(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
