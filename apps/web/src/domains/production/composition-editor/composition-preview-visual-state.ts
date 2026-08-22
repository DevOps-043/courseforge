import type { CompositionClip, CompositionTrack } from "./composition-document.types";
import { resolveCompositionClipAudioVolume } from "./composition-clip-audio.service";

export function resolveCompositionPreviewMediaFit(clip: CompositionClip, track: CompositionTrack | undefined) {
  const isAvatar = track?.semanticRole === "AVATAR" || track?.id === "avatar";
  return clip.mediaFit || (isAvatar ? "CONTAIN" : "COVER");
}

export function resolveCompositionPreviewAspectAnchor(
  mediaFit: "CONTAIN" | "COVER",
  track: CompositionTrack | undefined,
) {
  const isAvatar = track?.semanticRole === "AVATAR" || track?.id === "avatar";
  const isBroll = track?.semanticRole === "BROLL" || track?.id === "broll";
  if (mediaFit !== "CONTAIN" || (!isAvatar && !isBroll)) return null;
  return isAvatar ? "BOTTOM_RIGHT" as const : "CENTER" as const;
}

export function resolveCompositionPreviewClipVolume(
  clip: CompositionClip,
  track: CompositionTrack | undefined,
) {
  return resolveCompositionClipAudioVolume(clip, track);
}
