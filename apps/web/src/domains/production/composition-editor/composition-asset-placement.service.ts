const MINIMUM_INSERTION_DURATION_SECONDS = 0.05;

export interface CompositionAssetInsertionTiming {
  durationSeconds: number;
  overlapsExistingClips: boolean;
  startSeconds: number;
}

interface ResolveCompositionAssetInsertionTimingParams {
  canvasDurationSeconds: number;
  extendCanvasForSequentialAsset?: boolean;
  isSequential: boolean;
  occupiedUntilSeconds: number;
  playheadSeconds: number;
  preferredDurationSeconds: number;
}

/**
 * Appends sequential assets while the track still has room. Once the end of
 * the track is occupied, it inserts at the playhead and lets the timeline lane
 * layout represent the overlap instead of rejecting the asset.
 */
export function resolveCompositionAssetInsertionTiming({
  canvasDurationSeconds,
  extendCanvasForSequentialAsset = false,
  isSequential,
  occupiedUntilSeconds,
  playheadSeconds,
  preferredDurationSeconds,
}: ResolveCompositionAssetInsertionTimingParams): CompositionAssetInsertionTiming {
  const canvasDuration = Math.max(MINIMUM_INSERTION_DURATION_SECONDS, canvasDurationSeconds);
  const preferredDuration = Math.max(MINIMUM_INSERTION_DURATION_SECONDS, preferredDurationSeconds);
  const boundedPreferredDuration = Math.min(preferredDuration, canvasDuration);

  if (!isSequential) {
    return {
      durationSeconds: boundedPreferredDuration,
      overlapsExistingClips: false,
      startSeconds: 0,
    };
  }

  if (extendCanvasForSequentialAsset) {
    return {
      durationSeconds: preferredDuration,
      overlapsExistingClips: false,
      startSeconds: canvasDuration,
    };
  }

  const appendStart = Math.max(0, occupiedUntilSeconds);
  const appendDuration = Math.min(preferredDuration, canvasDuration - appendStart);
  if (appendDuration >= MINIMUM_INSERTION_DURATION_SECONDS) {
    return {
      durationSeconds: appendDuration,
      overlapsExistingClips: false,
      startSeconds: appendStart,
    };
  }

  const latestStart = Math.max(0, canvasDuration - boundedPreferredDuration);
  return {
    durationSeconds: boundedPreferredDuration,
    overlapsExistingClips: true,
    startSeconds: Math.max(0, Math.min(playheadSeconds, latestStart)),
  };
}
