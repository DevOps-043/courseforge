export const AVATAR_CLIP_CROSSFADE_FRAMES = 12;

export interface AvatarClipDurationLike {
  durationInFrames: number;
}

function normalizeDurationInFrames(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
}

export function getAvatarClipCrossfadeFrames(
  currentClip: AvatarClipDurationLike,
  nextClip: AvatarClipDurationLike,
): number {
  const currentDuration = normalizeDurationInFrames(currentClip.durationInFrames);
  const nextDuration = normalizeDurationInFrames(nextClip.durationInFrames);
  const boundedByClipLength = Math.min(
    Math.floor(currentDuration / 4),
    Math.floor(nextDuration / 4),
  );

  return Math.max(0, Math.min(AVATAR_CLIP_CROSSFADE_FRAMES, boundedByClipLength));
}

export function getAvatarClipEffectiveDurationInFrames(
  clips: AvatarClipDurationLike[],
): number {
  if (clips.length === 0) {
    return 0;
  }

  const rawDuration = clips.reduce(
    (sum, clip) => sum + normalizeDurationInFrames(clip.durationInFrames),
    0,
  );
  const overlapDuration = clips.reduce((sum, clip, index) => {
    const nextClip = clips[index + 1];
    return nextClip ? sum + getAvatarClipCrossfadeFrames(clip, nextClip) : sum;
  }, 0);

  return Math.max(1, rawDuration - overlapDuration);
}

export function getAvatarSegmentCrossfadeFrames(params: {
  current: { startFrame: number; endFrame: number };
  previous?: { endFrame: number } | null;
  next?: { startFrame: number } | null;
}) {
  const currentDuration = Math.max(1, params.current.endFrame - params.current.startFrame);
  const maxFadeFrames = Math.max(0, currentDuration - 1);
  const fadeInFrames = params.previous
    ? Math.min(maxFadeFrames, Math.max(0, params.previous.endFrame - params.current.startFrame))
    : 0;
  const fadeOutFrames = params.next
    ? Math.min(maxFadeFrames, Math.max(0, params.current.endFrame - params.next.startFrame))
    : 0;

  return {
    fadeInFrames,
    fadeOutFrames,
  };
}
