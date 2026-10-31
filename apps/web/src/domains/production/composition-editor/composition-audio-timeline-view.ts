export const AUDIO_TIMELINE_ZOOM = { minimum: 1, maximum: 128, step: 0.5, pixelsPerFrame: 8, maximumRulerTicks: 2_000 } as const;

/** El zoom cambia sólo la escala de edición, nunca la duración o velocidad. */
export function resolveAudioTimelineZoom(durationSeconds: number, viewportWidth: number, fps: number) {
  if (![durationSeconds, viewportWidth, fps].every(value => Number.isFinite(value) && value > 0)) return AUDIO_TIMELINE_ZOOM.minimum;
  return Math.max(AUDIO_TIMELINE_ZOOM.minimum, Math.min(AUDIO_TIMELINE_ZOOM.maximum,
    Math.ceil(durationSeconds * fps * AUDIO_TIMELINE_ZOOM.pixelsPerFrame / viewportWidth)));
}

export function audioTimelinePointerSeconds(input: { clientX: number; left: number; width: number; startSeconds: number; durationSeconds: number; fps: number }) {
  const ratio = Math.max(0, Math.min(1, (input.clientX - input.left) / Math.max(1, input.width)));
  return Math.round((input.startSeconds + ratio * input.durationSeconds) * input.fps) / input.fps;
}

export function buildAudioTimelineRuler(durationSeconds: number, zoom: number) {
  const duration = Math.max(durationSeconds, 0.05);
  const visibleDuration = duration / Math.max(zoom, 1);
  const majorInterval = Math.max([0.5, 1, 2, 5, 10, 15, 30, 60].find(interval => visibleDuration / interval <= 8) || 60,
    duration * 5 / AUDIO_TIMELINE_ZOOM.maximumRulerTicks);
  const minorInterval = majorInterval >= 2 ? majorInterval / 2 : majorInterval / 5;
  const major: number[] = [], minor: number[] = [];
  for (let time = 0; time <= duration + 0.001; time += minorInterval) {
    const rounded = Math.round(time * 100) / 100;
    if (Math.abs(rounded / majorInterval - Math.round(rounded / majorInterval)) < 0.001) major.push(rounded);
    else minor.push(rounded);
  }
  if (major.at(-1) !== duration) major.push(duration);
  return { major, minor };
}
