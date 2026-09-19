import { z } from "zod";
import { COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS } from "./composition-document.types.constants";

export const COMPOSITION_TRANSITION_SCHEMA_VERSION = 1 as const;
export const COMPOSITION_TRANSITION_MAX_ITEMS = 499;
export const COMPOSITION_TRANSITION_MAX_DURATION_SECONDS = 2;

export const COMPOSITION_TRANSITION_TYPES = [
  "CROSS_DISSOLVE",
  "DIP_TO_COLOR",
  "PUSH",
  "SOFT_WIPE",
  "BLUR_DISSOLVE",
] as const;

export const COMPOSITION_TRANSITION_ALIGNMENTS = [
  "CENTER_AT_CUT",
  "START_AT_CUT",
  "END_AT_CUT",
] as const;

export const COMPOSITION_TRANSITION_EASES = [
  "power1.inOut",
  "power2.inOut",
  "sine.inOut",
] as const;

export const COMPOSITION_TRANSITION_DIRECTIONS = [
  "LEFT",
  "RIGHT",
  "UP",
  "DOWN",
] as const;

const editorIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,127}$/i);
const durationSecondsSchema = z.number().finite().positive()
  .max(Math.min(COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS, COMPOSITION_TRANSITION_MAX_DURATION_SECONDS));

export const compositionTransitionParametersSchema = z.object({
  blurPixels: z.number().finite().min(0).max(40).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  direction: z.enum(COMPOSITION_TRANSITION_DIRECTIONS).optional(),
}).strict();

export const compositionTransitionSchema = z.object({
  alignment: z.enum(COMPOSITION_TRANSITION_ALIGNMENTS),
  audioMode: z.enum(["CUT", "CROSSFADE"]),
  durationSeconds: durationSecondsSchema,
  easing: z.enum(COMPOSITION_TRANSITION_EASES),
  fromClipId: editorIdSchema,
  id: editorIdSchema,
  origin: z.enum(["AGENT", "IMPORTED", "USER"]),
  parameters: compositionTransitionParametersSchema.optional(),
  toClipId: editorIdSchema,
  type: z.enum(COMPOSITION_TRANSITION_TYPES),
}).strict().superRefine((transition, context) => {
  if (transition.fromClipId === transition.toClipId) {
    context.addIssue({ code: "custom", message: "Una transición requiere dos clips diferentes." });
  }
  if (transition.type === "DIP_TO_COLOR" && !transition.parameters?.color) {
    context.addIssue({ code: "custom", message: "Dip to color requiere un color de transición." });
  }
  if (
    (transition.type === "PUSH" || transition.type === "SOFT_WIPE")
    && !transition.parameters?.direction
  ) {
    context.addIssue({ code: "custom", message: `${transition.type} requiere una dirección.` });
  }
  if (transition.type === "BLUR_DISSOLVE" && transition.parameters?.blurPixels === undefined) {
    context.addIssue({ code: "custom", message: "Blur dissolve requiere una intensidad de desenfoque." });
  }
});

export const compositionTransitionsSchema = z.object({
  items: z.array(compositionTransitionSchema).max(COMPOSITION_TRANSITION_MAX_ITEMS).default([]),
  schemaVersion: z.literal(COMPOSITION_TRANSITION_SCHEMA_VERSION).default(COMPOSITION_TRANSITION_SCHEMA_VERSION),
}).strict();

export type CompositionTransition = z.infer<typeof compositionTransitionSchema>;
export type CompositionTransitions = z.infer<typeof compositionTransitionsSchema>;
export type CompositionTransitionAlignment = typeof COMPOSITION_TRANSITION_ALIGNMENTS[number];
export type CompositionTransitionType = typeof COMPOSITION_TRANSITION_TYPES[number];

