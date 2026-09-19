import {
  compositionTextLayerStyleSchema,
  type CompositionTextLayerStyle,
} from "./composition-text-layer.types";

export const COMPOSITION_CAPTION_PRESET_IDS = ["TRANSPARENT", "SOLID", "MINIMAL"] as const;
export type CompositionCaptionPresetId = typeof COMPOSITION_CAPTION_PRESET_IDS[number];

export type CompositionCaptionPresetDefinition = {
  description: string;
  id: CompositionCaptionPresetId;
  label: string;
  overrides: Partial<CompositionTextLayerStyle>;
};

const PRESET_DEFINITIONS: Record<CompositionCaptionPresetId, CompositionCaptionPresetDefinition> = {
  MINIMAL: {
    description: "Texto ligero con sombra y stroke discreto.",
    id: "MINIMAL",
    label: "Minimal",
    overrides: {
      backgroundOpacity: 0,
      borderRadius: 0,
      fontSize: 52,
      fontWeight: 700,
      paddingX: 8,
      paddingY: 4,
      shadowBlur: 10,
      shadowOpacity: 0.75,
      strokeWidth: 1,
    },
  },
  SOLID: {
    description: "Caja semitransparente para fondos con poco contraste.",
    id: "SOLID",
    label: "Caja sólida",
    overrides: {
      backgroundOpacity: 0.78,
      borderRadius: 18,
      fontSize: 58,
      fontWeight: 800,
      paddingX: 30,
      paddingY: 16,
      shadowBlur: 10,
      shadowOpacity: 0.45,
      strokeWidth: 0,
    },
  },
  TRANSPARENT: {
    description: "Preset de referencia: contraste por stroke y sombra, sin caja opaca.",
    id: "TRANSPARENT",
    label: "Transparente",
    overrides: {
      backgroundOpacity: 0,
      borderRadius: 18,
      fontSize: 58,
      fontWeight: 800,
      paddingX: 28,
      paddingY: 14,
      shadowBlur: 16,
      shadowOpacity: 0.8,
      strokeWidth: 2,
    },
  },
};

export function listCompositionCaptionPresets() {
  return COMPOSITION_CAPTION_PRESET_IDS.map((id) => PRESET_DEFINITIONS[id]);
}

export function applyCompositionCaptionPreset(
  style: CompositionTextLayerStyle,
  presetId: CompositionCaptionPresetId,
) {
  return compositionTextLayerStyleSchema.parse({
    ...style,
    ...PRESET_DEFINITIONS[presetId].overrides,
  });
}
