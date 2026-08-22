import type { CompositionClip, CompositionTrack } from "./composition-document.types";

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
  if (track?.muted) return 0;
  const trackVolume = track?.volume ?? 1;
  const isBrollVideo = clip.kind === "VIDEO"
    && (track?.semanticRole === "BROLL" || track?.id === "broll");
  const clipVolume = isBrollVideo ? clip.volume ?? 0 : 1;
  return Math.max(0, Math.min(1, trackVolume * clipVolume));
}
