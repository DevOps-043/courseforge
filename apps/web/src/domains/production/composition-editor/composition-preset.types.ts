import { z } from "zod";
import {
  COMPOSITION_MEDIA_FIT_MODES,
  COMPOSITION_TRACK_ROLES,
} from "./composition-document.types";
import { COMPOSITION_MOTION_PRESET_IDS } from "./composition-motion.types";

export const COMPOSITION_PRESET_SCHEMA_VERSION = 1 as const;
export const COMPOSITION_PRESET_SOURCE_KINDS = ["INSTRUCTIONS", "MANUAL", "SYSTEM"] as const;
export const COMPOSITION_PRESET_TIMING_MODES = ["PRESERVE", "SEQUENCE", "STACK"] as const;

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
  animations: z.array(compositionPresetMotionSchema).max(8).default([]),
  crop: z.object({
    bottomRatio: normalizedRatioSchema,
    leftRatio: normalizedRatioSchema,
    rightRatio: normalizedRatioSchema,
    topRatio: normalizedRatioSchema,
  }).strict().optional(),
  durationWeight: z.number().finite().positive().max(100).default(1),
  hidden: z.boolean().default(false),
  layout: z.object({
    heightRatio: z.number().finite().positive().max(4),
    opacity: z.number().finite().min(0).max(1),
    rotation: z.number().finite().min(-360).max(360),
    widthRatio: z.number().finite().positive().max(4),
    xRatio: z.number().finite().min(-4).max(4),
    yRatio: z.number().finite().min(-4).max(4),
    zIndex: z.number().int().min(-100).max(100),
  }).strict().optional(),
  mediaFit: z.enum(COMPOSITION_MEDIA_FIT_MODES).optional(),
  volume: z.number().finite().min(0).max(1).optional(),
}).strict();

export const compositionPresetSlotRuleSchema = z.object({
  id: editorIdSchema,
  minItems: z.number().int().min(0).max(500).default(0),
  replaceAnimations: z.boolean().default(true),
  selector: z.object({
    kinds: z.array(z.enum(["AUDIO", "DECK_SLIDE", "IMAGE", "VIDEO"])).min(1).max(4),
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
  variants: z.array(compositionPresetVariantSchema).min(1).max(24),
}).strict();

export const compositionDynamicPresetDefinitionSchema = z.object({
  audioMix: z.object({
    ducking: z.object({
      attackSeconds: z.number().finite().min(0).max(5),
      duckedVolumeRatio: z.number().finite().min(0).max(1),
      enabled: z.boolean(),
      releaseSeconds: z.number().finite().min(0).max(5),
    }).strict(),
  }).strict().optional(),
  rules: z.array(compositionPresetSlotRuleSchema).min(1).max(24),
  schemaVersion: z.literal(COMPOSITION_PRESET_SCHEMA_VERSION),
}).strict().superRefine((definition, context) => {
  const ruleIds = new Set<string>();
  const selectors = new Set<string>();
  for (const [index, rule] of definition.rules.entries()) {
    if (ruleIds.has(rule.id)) {
      context.addIssue({ code: "custom", message: `El id de slot ${rule.id} está duplicado.`, path: ["rules", index, "id"] });
    }
    ruleIds.add(rule.id);
    const selectorKey = `${rule.selector.semanticRole}:${[...rule.selector.kinds].sort().join(",")}`;
    if (selectors.has(selectorKey)) {
      context.addIssue({ code: "custom", message: "Dos slots no pueden seleccionar exactamente los mismos clips.", path: ["rules", index, "selector"] });
    }
    selectors.add(selectorKey);
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

