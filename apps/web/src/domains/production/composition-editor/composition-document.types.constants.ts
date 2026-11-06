export const COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS = 600;
export const DEFAULT_COMPOSITION_RENDER_FPS = 25;

/**
 * Timeline times are persisted at millisecond precision. A much smaller
 * tolerance absorbs IEEE-754 representation noise without accepting a real
 * user-visible overrun.
 */
export const COMPOSITION_TIMELINE_BOUNDARY_EPSILON_SECONDS = 0.000001;

export function exceedsCompositionTimelineBoundary(
  endSeconds: number,
  boundarySeconds: number,
) {
  return endSeconds > boundarySeconds + COMPOSITION_TIMELINE_BOUNDARY_EPSILON_SECONDS;
}
