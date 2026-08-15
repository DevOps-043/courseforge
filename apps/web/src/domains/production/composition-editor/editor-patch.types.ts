import { z } from "zod";
import {
  COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS,
  COMPOSITION_DURATION_SOURCES,
  compositionClipSchema,
  compositionLayoutSchema,
  compositionTrackSchema,
} from "./composition-document.types";
import { COMPOSITION_MOTION_EASES, COMPOSITION_MOTION_PRESET_IDS, compositionMotionValuesSchema } from "./composition-motion.types";

const editorIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,127}$/i);
const boundedSecondsSchema = z.number().finite().min(0).max(COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS);

const clipMoveOperationSchema = z.object({
  startSeconds: boundedSecondsSchema,
  trackId: editorIdSchema.optional(),
  type: z.literal("clip.move"),
}).strict();

const clipDurationOperationSchema = z.object({
  durationSeconds: boundedSecondsSchema.positive(),
  type: z.literal("clip.duration"),
}).strict();

const clipTrimOperationSchema = z.object({
  durationSeconds: boundedSecondsSchema.positive(),
  sourceOffsetSeconds: z.number().finite().min(0).max(86_400),
  startSeconds: boundedSecondsSchema,
  type: z.literal("clip.trim"),
}).strict();

const clipLayoutOperationSchema = z.object({
  layout: compositionLayoutSchema.partial().refine(
    (layout) => Object.keys(layout).length > 0,
    "Debes indicar al menos una propiedad de layout.",
  ),
  type: z.literal("clip.layout"),
}).strict();

const clipVisibilityOperationSchema = z.object({
  hidden: z.boolean(),
  type: z.literal("clip.visibility"),
}).strict();

/** Only alters the editable document; source assets remain linked and intact. */
const clipAddOperationSchema = z.object({
  clip: compositionClipSchema,
  track: compositionTrackSchema.optional(),
  type: z.literal("clip.add"),
}).strict();

/** Removes only the timeline clip, never the source asset or its storage object. */
const clipRemoveOperationSchema = z.object({
  type: z.literal("clip.remove"),
}).strict();

const clipTemplateOperationSchema = z.object({
  durationSeconds: boundedSecondsSchema.positive(),
  layout: compositionLayoutSchema,
  startSeconds: boundedSecondsSchema,
  timingSource: z.enum(["ESTIMATED", "USER_EDITED"]).optional(),
  type: z.literal("clip.template"),
}).strict();

/** Recalculates generated timing without changing layout or any other clip state. */
const clipEstimatedTimingOperationSchema = z.object({
  durationSeconds: boundedSecondsSchema.positive(),
  startSeconds: boundedSecondsSchema,
  type: z.literal("clip.estimated-timing"),
}).strict();

const canvasDurationOperationSchema = z.object({
  durationMode: z.enum(["AUTO", "USER_EDITED"]).optional(),
  durationSeconds: boundedSecondsSchema.positive(),
  durationSource: z.enum(COMPOSITION_DURATION_SOURCES).optional(),
  type: z.literal("composition.canvas-duration"),
}).strict();

const trackUpdateOperationSchema = z.object({
  settings: z.object({
    hidden: z.boolean().optional(),
    locked: z.boolean().optional(),
    muted: z.boolean().optional(),
    volume: z.number().finite().min(0).max(1).optional(),
  }).strict().refine((settings) => Object.keys(settings).length > 0, "Debes indicar al menos un ajuste de capa."),
  trackId: editorIdSchema,
  type: z.literal("track.update"),
}).strict();

const audioMixUpdateOperationSchema = z.object({
  settings: z.object({
    attackSeconds: z.number().finite().min(0).max(5).optional(),
    duckedVolumeRatio: z.number().finite().min(0).max(1).optional(),
    enabled: z.boolean().optional(),
    releaseSeconds: z.number().finite().min(0).max(5).optional(),
  }).strict().refine((settings) => Object.keys(settings).length > 0, "Debes indicar al menos un ajuste de mezcla."),
  type: z.literal("audio-mix.update"),
}).strict();

const animationAddPresetOperationSchema = z.object({
  animationId: editorIdSchema,
  clipId: editorIdSchema,
  durationSeconds: boundedSecondsSchema.positive().max(2),
  presetId: z.enum(COMPOSITION_MOTION_PRESET_IDS),
  type: z.literal("animation.add-preset"),
}).strict();

const animationRemoveOperationSchema = z.object({
  animationId: editorIdSchema,
  type: z.literal("animation.remove"),
}).strict();

const animationUpdateTimingOperationSchema = z.object({
  animationId: editorIdSchema,
  timing: z.object({
    anchor: z.enum(["CLIP_END", "CLIP_START"]).optional(),
    durationSeconds: boundedSecondsSchema.positive().optional(),
    offsetSeconds: boundedSecondsSchema.optional(),
  }).strict().refine((timing) => Object.keys(timing).length > 0, "Debes indicar al menos un ajuste de tiempo."),
  type: z.literal("animation.update-timing"),
}).strict();

const animationUpdateKeyframeOperationSchema = z.object({
  animationId: editorIdSchema,
  ease: z.enum(COMPOSITION_MOTION_EASES).nullable().optional(),
  keyframeIndex: z.number().int().min(0).max(49),
  values: compositionMotionValuesSchema.optional(),
  type: z.literal("animation.update-keyframe"),
}).strict().refine((operation) => operation.values !== undefined || operation.ease !== undefined, "Debes modificar valores o easing.");

const clipPatchOperationSchema = z.discriminatedUnion("type", [
  clipAddOperationSchema,
  canvasDurationOperationSchema,
  clipMoveOperationSchema,
  clipDurationOperationSchema,
  clipEstimatedTimingOperationSchema,
  clipLayoutOperationSchema,
  clipRemoveOperationSchema,
  clipTemplateOperationSchema,
  clipTrimOperationSchema,
  clipVisibilityOperationSchema,
]).and(z.object({ clipId: editorIdSchema }).strict());

export const compositionEditorPatchOperationSchema = z.union([
  audioMixUpdateOperationSchema,
  animationAddPresetOperationSchema,
  animationRemoveOperationSchema,
  animationUpdateKeyframeOperationSchema,
  animationUpdateTimingOperationSchema,
  clipPatchOperationSchema,
  trackUpdateOperationSchema,
]);

export const compositionEditorPatchRequestSchema = z.object({
  operations: z.array(compositionEditorPatchOperationSchema).min(1).max(100),
  source: z.enum(["USER", "AGENT"]).default("USER"),
  summary: z.string().trim().min(3).max(300),
}).strict();

export type CompositionEditorPatchOperation = z.infer<typeof compositionEditorPatchOperationSchema>;
export type CompositionEditorPatchRequest = z.infer<typeof compositionEditorPatchRequestSchema>;
