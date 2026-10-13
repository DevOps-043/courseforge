import { z } from "zod";

export const MAX_VOLUME_ENVELOPE_POINTS = 128;
/** Readers always accept persisted curves; authoring is enabled after the compatible rollout. */
export function areCompositionVolumeEnvelopeEditsEnabled() {
  return process.env.NEXT_PUBLIC_COMPOSITION_VOLUME_ENVELOPE_ENABLED === "true";
}
export const compositionVolumeEnvelopeSchema = z
  .array(
    z
      .object({
        sourceTimeSeconds: z.number().finite().min(0).max(86400),
        gain: z.number().finite().min(0).max(1),
      })
      .strict(),
  )
  .max(MAX_VOLUME_ENVELOPE_POINTS)
  .superRefine((points, context) => {
    for (let index = 1; index < points.length; index += 1)
      if (
        points[index].sourceTimeSeconds <= points[index - 1].sourceTimeSeconds
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "sourceTimeSeconds"],
          message: "Los puntos deben tener tiempos únicos y crecientes.",
        });
      }
  });
export type CompositionVolumeEnvelopePoint = z.infer<
  typeof compositionVolumeEnvelopeSchema
>[number];

/** Linear amplitude, holding the first/last gain outside authored points; empty means unity. */
export function evaluateVolumeEnvelope(
  points: readonly CompositionVolumeEnvelopePoint[],
  sourceTimeSeconds: number,
): number {
  if (!points.length) return 1;
  if (sourceTimeSeconds <= points[0].sourceTimeSeconds) return points[0].gain;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1],
      current = points[index];
    if (sourceTimeSeconds > current.sourceTimeSeconds) continue;
    const progress =
      (sourceTimeSeconds - previous.sourceTimeSeconds) /
      (current.sourceTimeSeconds - previous.sourceTimeSeconds);
    return previous.gain + (current.gain - previous.gain) * progress;
  }
  return points[points.length - 1].gain;
}
