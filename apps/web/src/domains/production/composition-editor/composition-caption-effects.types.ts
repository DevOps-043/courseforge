import { z } from "zod";

export const CAPTION_EFFECT_LIMITS = { maxEmphasisRanges: 100, maxRuntimeTargets: 4_000, maxDurationSeconds: 2 } as const;
export const CAPTION_EFFECT_METRICS = { legacyInactiveOpacity: 0.55, slideDistancePixels: 24, popScaleReduction: 0.2, pulseScaleIncrease: 0.08 } as const;
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const settings = {
  entry: z.enum(["NONE", "FADE", "SLIDE_UP", "POP"]),
  exit: z.enum(["NONE", "FADE"]),
  durationSeconds: z.number().finite().min(0.05).max(CAPTION_EFFECT_LIMITS.maxDurationSeconds),
  intensity: z.number().finite().min(0.25).max(2),
  karaoke: z.enum(["LEGACY", "NONE", "OPACITY", "COLOR"]),
  activeColor: color,
  inactiveOpacity: z.number().finite().min(0).max(1),
  pulse: z.boolean(),
};
export const compositionCaptionEffectSettingsSchema = z.object(settings).strict();
export const compositionCaptionEffectsSchema = compositionCaptionEffectSettingsSchema.extend({ version: z.literal(1) }).strict();
export const compositionCaptionEffectsOverrideSchema = compositionCaptionEffectSettingsSchema.partial().strict();
export const compositionCaptionEmphasisSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  color: color.optional(),
  backgroundColor: color.optional(),
}).strict().refine((range) => range.end > range.start && (range.color !== undefined || range.backgroundColor !== undefined), "Selecciona texto y un color de énfasis.");
export type CompositionCaptionEffectSettings = z.infer<typeof compositionCaptionEffectSettingsSchema>;
export type CompositionCaptionEffects = z.infer<typeof compositionCaptionEffectsSchema>;
export type CompositionCaptionEmphasis = z.infer<typeof compositionCaptionEmphasisSchema>;
export const DEFAULT_CAPTION_EFFECTS: CompositionCaptionEffects = {
  version: 1, entry: "NONE", exit: "NONE", durationSeconds: 0.25, intensity: 1,
  karaoke: "LEGACY", activeColor: "#facc15", inactiveOpacity: 0.55, pulse: false,
};

/** Turning off authoring never disables reading or rendering persisted effects. */
export function areCaptionEffectsEnabled() {
  return process.env.NEXT_PUBLIC_CAPTION_EFFECTS_ENABLED !== "false";
}
