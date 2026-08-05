const MEDIA_DURATION_PRECISION = 1_000;

export function normalizeMeasuredDurationSeconds(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.max(
    1 / MEDIA_DURATION_PRECISION,
    Math.floor(seconds * MEDIA_DURATION_PRECISION) / MEDIA_DURATION_PRECISION,
  );
}

export function durationSecondsToFrames(seconds: number, fps: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(fps) || fps <= 0) {
    return 1;
  }
  return Math.max(1, Math.floor(seconds * fps));
}
