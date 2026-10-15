import type { CompositionVolumePoint } from "./composition-audio-mix.service";

/** Evaluates the canonical piecewise-linear gain used by preview, render and reference audio. */
export function resolvePlaybackVolume(
  points: readonly CompositionVolumePoint[],
  time: number,
  baselineVolume: number,
) {
  const first = points[0];
  if (!first) return baselineVolume;
  if (time <= first.timeSeconds) return first.volume;
  const last = points.at(-1)!;
  if (time >= last.timeSeconds) return last.volume;
  let lower = 1;
  let upper = points.length - 1;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (points[middle]!.timeSeconds < time) lower = middle + 1;
    else upper = middle;
  }
  const previous = points[lower - 1]!;
  const next = points[lower]!;
  const duration = next.timeSeconds - previous.timeSeconds;
  return duration <= 0
    ? next.volume
    : previous.volume +
        ((next.volume - previous.volume) * (time - previous.timeSeconds)) /
          duration;
}
