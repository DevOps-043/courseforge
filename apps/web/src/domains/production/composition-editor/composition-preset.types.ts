import { compositionVisualMaskSchema } from "./composition-visual-mask";
import { z } from "zod";
import {
  COMPOSITION_MEDIA_FIT_MODES,
  COMPOSITION_TRACK_ROLES,
} from "./composition-document.types";
import { COMPOSITION_MOTION_PRESET_IDS } from "./composition-motion.types";
import { compositionAnimationSchema, compositionMotionKeyframeSchema } from "./composition-motion.types";
import { compositionColorGradingSchema } from "./composition-color-grading.types";
import { compositionTextLayerStyleSchema } from "./composition-text-layer.types";
import { compositionCaptionEffectsSchema } from "./composition-caption-effects.types";
import { COMPOSITION_LAYER_DEPTH_LIMIT } from "./composition-layer-depth";
import { COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS } from "./composition-document.types.constants";

export const LEGACY_COMPOSITION_PRESET_SCHEMA_VERSION = 1 as const;
export const COMPOSITION_PRESET_SCHEMA_VERSION = 2 as const;
export const COMPOSITION_PRESET_SOURCE_KINDS = ["INSTRUCTIONS", "MANUAL", "SYSTEM"] as const;
export const COMPOSITION_PRESET_TIMING_MODES = ["PRESERVE", "SEQUENCE", "STACK", "PATTERN"] as const;

const normalizedRatioSchema = z.number().finite().min(0).max(1);
const editorIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,127}$/i);

export const compositionPresetMotionSchema = z.object({
  cycles: z.number().int().min(1).max(12).default(1),
  durationRatio: z.number().finite().positive().max(1),
  intensity: z.number().finite().min(0.25).max(2).default(1),
  offsetRatio: normalizedRatioSchema.default(0),
  presetId: z.enum(COMPOSITION_MOTION_PRESET_IDS),
}).strict();

export const compositionPresetVariantSchema = z.object({
  colorGrading: compositionColorGradingSchema.nullable().optional(),
  fadeInRatio: normalizedRatioSchema.optional(),
  fadeOutRatio: normalizedRatioSchema.optional(),
  textStyle: compositionTextLayerStyleSchema.omit({ fontAssetId: true }).optional(),
  preserveTargetFont: z.boolean().optional(),
  captionEffects: compositionCaptionEffectsSchema.nullable().optional(),
  startRatio: normalizedRatioSchema.optional(),
  durationRatio: z.number().finite().positive().max(1).optional(),
  // Sin IDs ni fuentes: x/y son desplazamientos relativos al canvas.
  motion: z.array(z.object({
    anchor: z.enum(["CLIP_START", "CLIP_END"]),
    durationRatio: z.number().finite().positive().max(1),
    offsetRatio: normalizedRatioSchema,
    propertyGroup: z.enum(["OPACITY", "POSITION", "ROTATION", "SCALE"]),
    keyframes: z.array(compositionMotionKeyframeSchema).min(2).max(50),
    loopCycleRatio: z.number().finite().positive().max(1000).optional(),
    preset: compositionAnimationSchema.shape.preset,
  }).strict()).max(200).optional(),
  mask: compositionVisualMaskSchema.optional(),
  animations: z.array(compositionPresetMotionSchema).max(8).default([]),
  crop: z.object({
    bottomRatio: normalizedRatioSchema,
    leftRatio: normalizedRatioSchema,
    rightRatio: normalizedRatioSchema,
    topRatio: normalizedRatioSchema,
  }).strict().optional(),
  durationWeight: z.number().finite().positive().max(COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS).default(1),
  hidden: z.boolean().default(false),
  layout: z.object({
    heightRatio: z.number().finite().positive().max(8192),
    opacity: z.number().finite().min(0).max(1),
    rotation: z.number().finite().min(-360).max(360),
    widthRatio: z.number().finite().positive().max(8192),
    xRatio: z.number().finite().min(-8192).max(8192),
    yRatio: z.number().finite().min(-8192).max(8192),
    zIndex: z.number().int().min(-100).max(COMPOSITION_LAYER_DEPTH_LIMIT),
  }).strict().optional(),
  mediaFit: z.enum(COMPOSITION_MEDIA_FIT_MODES).optional(),
  volume: z.number().finite().min(0).max(1).optional(),
}).strict();

export const compositionPresetSlotRuleSchema = z.object({
  id: editorIdSchema,
  minItems: z.number().int().min(0).max(500).default(0),
  replaceAnimations: z.boolean().default(true),
  selector: z.object({
    trackIndex: z.number().int().min(0).max(31).optional(),
    kinds: z.array(z.enum(["AUDIO", "CAPTION", "DECK_SLIDE", "IMAGE", "TEXT", "VIDEO"])).min(1).max(6),
    semanticRole: z.enum(COMPOSITION_TRACK_ROLES),
  }).strict(),
  timing: z.object({
    endRatio: normalizedRatioSchema.default(1),
    mode: z.enum(COMPOSITION_PRESET_TIMING_MODES),
    startRatio: normalizedRatioSchema.default(0),
  }).strict().refine((timing) => timing.endRatio > timing.startRatio, "El rango temporal del slot debe ser positivo."),
  trackSettings: z.object({
    hidden: z.boolean().optional(),
    muted: z.boolean().optional(),
    volume: z.number().finite().min(0).max(1).optional(),
  }).strict().optional(),
  variants: z.array(compositionPresetVariantSchema).min(1).max(500),
}).strict();

export const compositionDynamicPresetDefinitionSchema = z.object({
  audioMix: z.object({
    masterVolume: z.number().finite().min(0).max(1).optional(),
    ducking: z.object({
      attackSeconds: z.number().finite().min(0).max(5),
      duckedVolumeRatio: z.number().finite().min(0).max(1),
      enabled: z.boolean(),
      releaseSeconds: z.number().finite().min(0).max(5),
      targetRole: z.literal("MUSIC").optional(),
      triggerRoles: z.array(z.enum(["VOICE", "AVATAR"])).min(1).max(2).optional(),
    }).strict(),
  }).strict().optional(),
  rules: z.array(compositionPresetSlotRuleSchema).min(1).max(192),
  schemaVersion: z.union([z.literal(LEGACY_COMPOSITION_PRESET_SCHEMA_VERSION), z.literal(COMPOSITION_PRESET_SCHEMA_VERSION)]),
}).strict().superRefine((definition, context) => {
  const ruleIds = new Set<string>();
  const selectors = new Set<string>();
  for (const [index, rule] of definition.rules.entries()) {
    if (ruleIds.has(rule.id)) {
      context.addIssue({ code: "custom", message: `El id de slot ${rule.id} está duplicado.`, path: ["rules", index, "id"] });
    }
    ruleIds.add(rule.id);
    const selectorKey = `${rule.selector.semanticRole}:${rule.selector.trackIndex ?? "all"}:${[...rule.selector.kinds].sort().join(",")}`;
    if (selectors.has(selectorKey)) {
      context.addIssue({ code: "custom", message: "Dos slots no pueden seleccionar exactamente los mismos clips.", path: ["rules", index, "selector"] });
    }
    selectors.add(selectorKey);
    if (rule.timing.mode === "PATTERN" && rule.variants.some(variant => variant.startRatio === undefined || variant.durationRatio === undefined)) {
      context.addIssue({ code: "custom", message: "Cada variante del patrón requiere inicio y duración relativos.", path: ["rules", index, "variants"] });
    }
  }
  if (definition.rules.reduce((total, rule) => total + rule.variants.length, 0) > 500) {
    context.addIssue({ code: "custom", message: "El preset excede el límite de 500 variantes." });
  }
  if (definition.rules.reduce((total, rule) => total + rule.variants.reduce((count, variant) => count + (variant.motion?.length ?? 0) + variant.animations.length, 0), 0) > 200) {
    context.addIssue({ code: "custom", message: "El preset excede el límite de 200 animaciones." });
  }
});

export const compositionPresetCreateRequestSchema = z.object({
  description: z.string().trim().max(500).default(""),
  instruction: z.string().trim().min(3).max(1_500).optional(),
  mode: z.enum(["INSTRUCTIONS", "MANUAL"]),
  name: z.string().trim().min(3).max(120),
}).strict().superRefine((request, context) => {
  if (request.mode === "INSTRUCTIONS" && !request.instruction) {
    context.addIssue({ code: "custom", message: "Describe la plantilla que quieres crear.", path: ["instruction"] });
  }
  if (request.mode === "MANUAL" && request.instruction) {
    context.addIssue({ code: "custom", message: "La extracción manual no acepta instrucciones adicionales.", path: ["instruction"] });
  }
});

export const compositionPresetApplicationRequestSchema = z.object({
  presetId: z.string().trim().min(1).max(160),
}).strict();

export type CompositionDynamicPresetDefinition = z.infer<typeof compositionDynamicPresetDefinitionSchema>;
export type CompositionPresetSlotRule = z.infer<typeof compositionPresetSlotRuleSchema>;
export type CompositionPresetSourceKind = typeof COMPOSITION_PRESET_SOURCE_KINDS[number];
export type CompositionPresetVariant = z.infer<typeof compositionPresetVariantSchema>;

export type CompositionPresetCatalogEntry = {
  createdAt: string | null;
  description: string;
  id: string;
  name: string;
  sourceKind: CompositionPresetSourceKind;
  version: number;
};
