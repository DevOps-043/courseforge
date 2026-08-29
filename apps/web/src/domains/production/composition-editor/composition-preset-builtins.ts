import {
  COMPOSITION_PRESET_SCHEMA_VERSION,
  compositionDynamicPresetDefinitionSchema,
  type CompositionPresetCatalogEntry,
  type CompositionDynamicPresetDefinition,
} from "./composition-preset.types";

export type BuiltInCompositionPreset = CompositionPresetCatalogEntry & {
  definition: CompositionDynamicPresetDefinition;
};

const FULL_CANVAS = { heightRatio: 1, opacity: 1, rotation: 0, widthRatio: 1, xRatio: 0, yRatio: 0, zIndex: 0 };
const PRESENTER_CORNER = { heightRatio: 0.34, opacity: 1, rotation: 0, widthRatio: 0.24, xRatio: 0.73, yRatio: 0.62, zIndex: 20 };
const DECK_INSET = { heightRatio: 0.5, opacity: 1, rotation: 0, widthRatio: 0.46, xRatio: 0.51, yRatio: 0.25, zIndex: 20 };

export const BUILT_IN_COMPOSITION_PRESETS: readonly BuiltInCompositionPreset[] = [
  builtIn({
    description: "Diapositivas a pantalla completa con el presentador en la esquina inferior derecha.",
    id: "system-presenter-corner",
    name: "Presentador + diapositivas",
    rules: [
      rule("deck", "DECK", ["DECK_SLIDE"], "SEQUENCE", FULL_CANVAS, [{ presetId: "FADE_IN", durationRatio: 0.12 }], 1),
      rule("avatar", "AVATAR", ["VIDEO"], "PRESERVE", PRESENTER_CORNER, [{ presetId: "FADE_IN", durationRatio: 0.08 }]),
      rule("broll", "BROLL", ["IMAGE", "VIDEO"], "PRESERVE", { ...FULL_CANVAS, zIndex: 10 }, [{ presetId: "FADE_IN", durationRatio: 0.08 }]),
    ],
  }),
  builtIn({
    description: "Prioriza al presentador y muestra las diapositivas como apoyo visual lateral.",
    id: "system-presenter-focus",
    name: "Presentador protagonista",
    rules: [
      rule("avatar", "AVATAR", ["VIDEO"], "PRESERVE", FULL_CANVAS, [{ presetId: "FADE_IN", durationRatio: 0.08 }], 1),
      rule("deck", "DECK", ["DECK_SLIDE"], "SEQUENCE", DECK_INSET, [{ presetId: "SLIDE_IN_RIGHT", durationRatio: 0.12 }]),
      rule("broll", "BROLL", ["IMAGE", "VIDEO"], "PRESERVE", DECK_INSET, [{ presetId: "FADE_IN", durationRatio: 0.08 }]),
    ],
  }),
  builtIn({
    description: "Mantiene el contenido visual a pantalla completa con transiciones discretas y sin exigir avatar.",
    id: "system-visual-story",
    name: "Historia visual",
    rules: [
      rule("deck", "DECK", ["DECK_SLIDE"], "SEQUENCE", { ...FULL_CANVAS, zIndex: 0 }, [{ presetId: "FADE_IN", durationRatio: 0.1 }]),
      rule("broll", "BROLL", ["IMAGE", "VIDEO"], "PRESERVE", { ...FULL_CANVAS, zIndex: 10 }, [{ presetId: "ZOOM_IN", durationRatio: 0.15 }]),
      rule("visual", "VISUAL", ["IMAGE", "VIDEO"], "PRESERVE", { ...FULL_CANVAS, zIndex: 10 }, [{ presetId: "FADE_IN", durationRatio: 0.1 }]),
    ],
  }),
] as const;

export function findBuiltInCompositionPreset(id: string) {
  return BUILT_IN_COMPOSITION_PRESETS.find((preset) => preset.id === id) || null;
}

function builtIn(params: { description: string; id: string; name: string; rules: unknown[] }): BuiltInCompositionPreset {
  return {
    createdAt: null,
    definition: compositionDynamicPresetDefinitionSchema.parse({
      audioMix: { ducking: { attackSeconds: 0.2, duckedVolumeRatio: 0.35, enabled: true, releaseSeconds: 0.35 } },
      rules: params.rules,
      schemaVersion: COMPOSITION_PRESET_SCHEMA_VERSION,
    }),
    description: params.description,
    id: params.id,
    name: params.name,
    sourceKind: "SYSTEM",
    version: 1,
  };
}

function rule(
  id: string,
  semanticRole: "AVATAR" | "BROLL" | "DECK" | "VISUAL",
  kinds: Array<"DECK_SLIDE" | "IMAGE" | "VIDEO">,
  timingMode: "PRESERVE" | "SEQUENCE",
  layout: typeof FULL_CANVAS,
  animations: Array<{ durationRatio: number; presetId: "FADE_IN" | "SLIDE_IN_RIGHT" | "ZOOM_IN" }>,
  minItems = 0,
) {
  return {
    id: `slot-${id}`,
    minItems,
    replaceAnimations: true,
    selector: { kinds, semanticRole },
    timing: { endRatio: 1, mode: timingMode, startRatio: 0 },
    variants: [{ animations: animations.map((animation) => ({ ...animation, cycles: 1, intensity: 1, offsetRatio: 0 })), durationWeight: 1, hidden: false, layout }],
  };
}

