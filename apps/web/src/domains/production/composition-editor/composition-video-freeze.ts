export const COMPOSITION_VIDEO_MAX_FREEZE_SECONDS = 3;
export const COMPOSITION_VIDEO_FREEZE_TOLERANCE_SECONDS = 0.001;

export function resolveVideoFreezeTailSeconds(params: {
  clipDurationSeconds: number;
  sourceDurationSeconds: number;
  sourceOffsetSeconds: number;
}): number | null {
  const sourceWindowSeconds = params.sourceDurationSeconds - params.sourceOffsetSeconds;
  const tailSeconds = params.clipDurationSeconds - sourceWindowSeconds;
  return sourceWindowSeconds > 0
    && tailSeconds > COMPOSITION_VIDEO_FREEZE_TOLERANCE_SECONDS
    && tailSeconds <= COMPOSITION_VIDEO_MAX_FREEZE_SECONDS + COMPOSITION_VIDEO_FREEZE_TOLERANCE_SECONDS
    ? tailSeconds
    : null;
}
