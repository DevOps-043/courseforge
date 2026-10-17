export const COMPOSITION_VIDEO_PLAYBACK_RATES = [0.5, 1, 1.5, 2] as const;

export function videoRateSourceWindowFits(params: {
  clipDurationSeconds: number;
  playbackRate: number;
  sourceDurationSeconds: number;
  sourceOffsetSeconds: number;
}): boolean {
  return params.sourceOffsetSeconds + params.clipDurationSeconds * params.playbackRate
    <= params.sourceDurationSeconds + 0.001;
}
