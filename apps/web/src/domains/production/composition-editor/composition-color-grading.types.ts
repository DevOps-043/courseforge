import { z } from "zod";

export const COMPOSITION_COLOR_GRADING_LIMITS = {
  contrast: { max: 1, min: -1 },
  exposure: { max: 2, min: -2 },
  saturation: { max: 1, min: -1 },
} as const;

const compositionColorGradingAdjustSchema = z.strictObject({
  contrast: z.number().finite().min(COMPOSITION_COLOR_GRADING_LIMITS.contrast.min).max(COMPOSITION_COLOR_GRADING_LIMITS.contrast.max),
  exposure: z.number().finite().min(COMPOSITION_COLOR_GRADING_LIMITS.exposure.min).max(COMPOSITION_COLOR_GRADING_LIMITS.exposure.max),
  saturation: z.number().finite().min(COMPOSITION_COLOR_GRADING_LIMITS.saturation.min).max(COMPOSITION_COLOR_GRADING_LIMITS.saturation.max),
});

export const compositionColorGradingSchema = z.strictObject({
  adjust: compositionColorGradingAdjustSchema,
});

export type CompositionColorGrading = z.infer<typeof compositionColorGradingSchema>;

export function normalizeCompositionColorGrading(
  colorGrading: CompositionColorGrading | null | undefined,
): CompositionColorGrading | undefined {
  if (!colorGrading) return undefined;
  const adjust = {
    contrast: normalizeZero(colorGrading.adjust.contrast),
    exposure: normalizeZero(colorGrading.adjust.exposure),
    saturation: normalizeZero(colorGrading.adjust.saturation),
  };
  if (adjust.contrast === 0 && adjust.exposure === 0 && adjust.saturation === 0) {
    return undefined;
  }
  return { adjust };
}

function normalizeZero(value: number) {
  return value === 0 ? 0 : value;
}
