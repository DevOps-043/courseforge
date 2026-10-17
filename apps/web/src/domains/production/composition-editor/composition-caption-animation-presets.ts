import { CAPTION_EFFECT_COLORS, compositionCaptionEffectsSchema, type CompositionCaptionEffects } from "./composition-caption-effects.types";

export const CAPTION_ANIMATION_PRESET_IDS = ["EDUCATIONAL", "GUIDED_READING", "SOCIAL"] as const;
export type CaptionAnimationPresetId = typeof CAPTION_ANIMATION_PRESET_IDS[number];

type CaptionAnimationPreset = {
  id: CaptionAnimationPresetId;
  label: string;
  description: string;
  effects: CompositionCaptionEffects;
};

const PRESETS: Record<CaptionAnimationPresetId, CaptionAnimationPreset> = {
  EDUCATIONAL: {
    id: "EDUCATIONAL", label: "Educativo", description: "Frase completa con fundidos breves, sin movimiento ni seguimiento de palabras.",
    effects: { version: 1, entry: "FADE", exit: "FADE", durationSeconds: 0.15, intensity: 0.5,
      karaoke: "NONE", activeColor: CAPTION_EFFECT_COLORS.highlightBackground, inactiveOpacity: 1, pulse: false },
  },
  GUIDED_READING: {
    id: "GUIDED_READING", label: "Lectura guiada", description: "Palabra activa en color; toda la frase permanece visible y estable.",
    effects: { version: 1, entry: "FADE", exit: "FADE", durationSeconds: 0.15, intensity: 0.5,
      karaoke: "COLOR", activeColor: CAPTION_EFFECT_COLORS.highlightBackground, inactiveOpacity: 1, pulse: false },
  },
  SOCIAL: {
    id: "SOCIAL", label: "Social", description: "Fondo resaltado en la palabra activa, sin saltos. Recomendado para frases breves como las generadas desde voz.",
    effects: { version: 1, entry: "FADE", exit: "FADE", durationSeconds: 0.12, intensity: 0.5,
      karaoke: "BACKGROUND", activeColor: CAPTION_EFFECT_COLORS.highlightText,
      activeBackgroundColor: CAPTION_EFFECT_COLORS.highlightBackground, inactiveOpacity: 1, pulse: false },
  },
};

/** Devuelve copias validadas: editar un preset aplicado nunca modifica el catálogo. */
export function listCaptionAnimationPresets(): CaptionAnimationPreset[] {
  return CAPTION_ANIMATION_PRESET_IDS.map(id => ({ ...PRESETS[id], effects: applyCaptionAnimationPreset(id) }));
}

export function applyCaptionAnimationPreset(id: CaptionAnimationPresetId): CompositionCaptionEffects {
  return compositionCaptionEffectsSchema.parse(PRESETS[id].effects);
}

export function identifyCaptionAnimationPreset(effects: CompositionCaptionEffects | undefined): CaptionAnimationPresetId | null {
  if (!effects) return null;
  const actual = JSON.stringify(compositionCaptionEffectsSchema.parse(effects));
  return CAPTION_ANIMATION_PRESET_IDS.find(id => JSON.stringify(applyCaptionAnimationPreset(id)) === actual) || null;
}
