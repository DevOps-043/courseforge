import { z } from "zod";
import { COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS } from "./composition-document.types.constants";

export const COMPOSITION_MOTION_SCHEMA_VERSION = 1 as const;
export const COMPOSITION_MOTION_MAX_ANIMATIONS = 200;
export const COMPOSITION_MOTION_MAX_KEYFRAMES = 50;

export const COMPOSITION_MOTION_EASES = [
  "none",
  "power1.in",
  "power1.out",
  "power1.inOut",
  "power2.in",
  "power2.out",
  "power2.inOut",
  "power3.in",
  "power3.out",
  "power3.inOut",
  "back.out(1.4)",
] as const;

export const COMPOSITION_MOTION_PRESET_IDS = [
  "FADE_IN",
  "FADE_OUT",
  "SLIDE_IN_LEFT",
  "SLIDE_IN_RIGHT",
  "ZOOM_IN",
  "POP",
] as const;

const editorIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,127}$/i);
const finiteNumberSchema = z.number().finite();

export const compositionMotionValuesSchema = z.object({
  opacity: finiteNumberSchema.min(0).max(1).optional(),
  rotation: finiteNumberSchema.min(-720).max(720).optional(),
  scale: finiteNumberSchema.min(0.01).max(10).optional(),
  x: finiteNumberSchema.min(-16_384).max(16_384).optional(),
  y: finiteNumberSchema.min(-16_384).max(16_384).optional(),
}).strict().refine((values) => Object.keys(values).length > 0, "Un keyframe debe modificar al menos una propiedad.");

export const compositionMotionKeyframeSchema = z.object({
  ease: z.enum(COMPOSITION_MOTION_EASES).optional(),
  offset: finiteNumberSchema.min(0).max(1),
  values: compositionMotionValuesSchema,
}).strict();

export const compositionAnimationSchema = z.object({
  id: editorIdSchema,
  keyframes: z.array(compositionMotionKeyframeSchema).min(2).max(COMPOSITION_MOTION_MAX_KEYFRAMES),
  origin: z.enum(["AGENT", "IMPORTED", "PRESET", "USER"]),
  preset: z.object({
    id: z.enum(COMPOSITION_MOTION_PRESET_IDS),
    version: z.number().int().min(1).max(100),
  }).strict().optional(),
  propertyGroup: z.enum(["OPACITY", "POSITION", "ROTATION", "SCALE"]),
  target: z.object({
    clipId: editorIdSchema,
    part: z.literal("CONTENT").default("CONTENT"),
  }).strict(),
  timing: z.object({
    anchor: z.enum(["CLIP_END", "CLIP_START"]),
    durationSeconds: finiteNumberSchema.positive().max(COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS),
    offsetSeconds: finiteNumberSchema.min(0).max(COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS),
  }).strict(),
}).strict().superRefine((animation, context) => {
  let previousOffset = -1;
  for (const [index, keyframe] of animation.keyframes.entries()) {
    if (keyframe.offset <= previousOffset) {
      context.addIssue({ code: "custom", message: "Los keyframes deben estar ordenados y no pueden compartir offset." });
      break;
    }
    previousOffset = keyframe.offset;
    const keys = Object.keys(keyframe.values);
    const allowed = animation.propertyGroup === "POSITION" ? ["x", "y"]
      : animation.propertyGroup === "SCALE" ? ["scale"]
        : animation.propertyGroup === "ROTATION" ? ["rotation"] : ["opacity"];
    if (keys.some((key) => !allowed.includes(key))) {
      context.addIssue({ code: "custom", path: ["keyframes", index, "values"], message: `El grupo ${animation.propertyGroup} contiene una propiedad incompatible.` });
    }
  }
  if (animation.keyframes[0]?.offset !== 0 || animation.keyframes.at(-1)?.offset !== 1) {
    context.addIssue({ code: "custom", message: "La animación debe comenzar en offset 0 y terminar en offset 1." });
  }
});

export const compositionMotionSchema = z.object({
  animations: z.array(compositionAnimationSchema).max(COMPOSITION_MOTION_MAX_ANIMATIONS).default([]),
  schemaVersion: z.literal(COMPOSITION_MOTION_SCHEMA_VERSION).default(COMPOSITION_MOTION_SCHEMA_VERSION),
}).strict().default({ animations: [], schemaVersion: COMPOSITION_MOTION_SCHEMA_VERSION });

export type CompositionAnimation = z.infer<typeof compositionAnimationSchema>;
export type CompositionMotion = z.infer<typeof compositionMotionSchema>;
export type CompositionMotionPresetId = typeof COMPOSITION_MOTION_PRESET_IDS[number];
