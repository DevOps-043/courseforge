import {
  evaluateVolumeEnvelope,
  type CompositionVolumeEnvelopePoint,
} from "./composition-volume-envelope";

/** Include authored knots exactly: uniform sampling can hide a short attenuation. */
export function buildVolumeEnvelopePath(
  points: readonly CompositionVolumeEnvelopePoint[],
  startSeconds: number,
  durationSeconds: number,
  width: number,
) {
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    !Number.isFinite(width) ||
    width <= 0
  )
    return "";
  const ordered = [...points].sort(
    (left, right) => left.sourceTimeSeconds - right.sourceTimeSeconds,
  );
  const end = startSeconds + durationSeconds;
  const times = [
    ...new Set([
      startSeconds,
      ...ordered
        .map((point) => point.sourceTimeSeconds)
        .filter((time) => time > startSeconds && time < end),
      end,
    ]),
  ].sort((left, right) => left - right);
  return times
    .map(
      (time, index) =>
        `${index ? "L" : "M"}${((time - startSeconds) / durationSeconds) * width} ${100 * (1 - evaluateVolumeEnvelope(ordered, time))}`,
    )
    .join("");
}
