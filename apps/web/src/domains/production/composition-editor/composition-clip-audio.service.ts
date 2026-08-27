import type {
  CompositionClip,
  CompositionTrack,
} from "./composition-document.types";

/** Whether the editable clip owns an audible source that can be mixed independently. */
export function compositionClipHasConfigurableAudio(
  clip: CompositionClip,
  track?: CompositionTrack,
): boolean {
  if (clip.source.type !== "PRODUCTION_ASSET" && clip.source.type !== "ASSEMBLY_BRAND_ASSET") return false;
  if (clip.kind === "AUDIO") return true;
  if (clip.kind !== "VIDEO") return false;
  if (clip.source.hasAudio !== undefined) return clip.source.hasAudio;
  // Historical avatar documents predate media probing but carry narration;
  // historical B-roll remains fail-closed and therefore stays silent.
  return track?.semanticRole === "AVATAR" || track?.id === "avatar";
}

/**
 * Preserves historical behavior: B-roll starts muted while every other audible
 * clip inherits a neutral 100% multiplier until the user authors a value.
 */
export function resolveCompositionClipDefaultVolume(
  clip: CompositionClip,
  track: CompositionTrack | undefined,
): number {
  const isBrollVideo = clip.kind === "VIDEO"
    && (track?.semanticRole === "BROLL" || track?.id === "broll");
  return isBrollVideo ? 0 : 1;
}

/** Track volume remains the master gain; clip volume is the local multiplier. */
export function resolveCompositionClipAudioVolume(
  clip: CompositionClip,
  track: CompositionTrack | undefined,
): number {
  if (track?.muted) return 0;
  const trackVolume = track?.volume ?? 1;
  const clipVolume = clip.volume
    ?? resolveCompositionClipDefaultVolume(clip, track);
  return clampVolume(trackVolume * clipVolume);
}

function clampVolume(value: number) {
  return Math.max(0, Math.min(1, value));
}
