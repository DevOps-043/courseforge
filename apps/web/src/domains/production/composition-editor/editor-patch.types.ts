import { z } from "zod";
import {
  COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS,
  compositionClipSchema,
  compositionLayoutSchema,
  compositionTrackSchema,
} from "./composition-document.types";

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
  type: z.literal("clip.template"),
}).strict();

const canvasDurationOperationSchema = z.object({
  durationSeconds: boundedSecondsSchema.positive(),
  type: z.literal("composition.canvas-duration"),
}).strict();

export const compositionEditorPatchOperationSchema = z.discriminatedUnion("type", [
  clipAddOperationSchema,
  canvasDurationOperationSchema,
  clipMoveOperationSchema,
  clipDurationOperationSchema,
  clipLayoutOperationSchema,
  clipRemoveOperationSchema,
  clipTemplateOperationSchema,
  clipVisibilityOperationSchema,
]).and(z.object({ clipId: editorIdSchema }).strict());

export const compositionEditorPatchRequestSchema = z.object({
  operations: z.array(compositionEditorPatchOperationSchema).min(1).max(100),
  source: z.enum(["USER", "AGENT"]).default("USER"),
  summary: z.string().trim().min(3).max(300),
}).strict();

export type CompositionEditorPatchOperation = z.infer<typeof compositionEditorPatchOperationSchema>;
export type CompositionEditorPatchRequest = z.infer<typeof compositionEditorPatchRequestSchema>;
