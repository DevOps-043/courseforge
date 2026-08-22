import { z } from "zod";
import { compositionVisualCropSchema } from "./composition-document.types";
import { compositionPreviewMetricSchema } from "./composition-preview-telemetry";
import { compositionPreviewVisualPatchSchema } from "./composition-preview-visual-patch";

export const COMPOSITION_PREVIEW_PROTOCOL_VERSION = 1 as const;

const protocolVersionSchema = z.literal(COMPOSITION_PREVIEW_PROTOCOL_VERSION).default(COMPOSITION_PREVIEW_PROTOCOL_VERSION);
const hfIdSchema = z.string().trim().min(1).max(160);
const secondsSchema = z.number().finite().min(0).max(86_400);
const layoutSchema = z.object({
  height: z.number().finite().positive().max(16_384),
  width: z.number().finite().positive().max(16_384),
  x: z.number().finite().min(-16_384).max(16_384),
  y: z.number().finite().min(-16_384).max(16_384),
}).strict();

const iframeMessageBase = { protocolVersion: protocolVersionSchema };

export const compositionPreviewIframeMessageSchema = z.discriminatedUnion("type", [
  z.object({ ...iframeMessageBase, duration: secondsSchema, selectedHfId: hfIdSchema.nullable().optional(), type: z.literal("courseforge-composition-ready") }).strict(),
  z.object({ ...iframeMessageBase, seconds: secondsSchema, type: z.literal("courseforge-composition-time") }).strict(),
  z.object({ ...iframeMessageBase, playing: z.boolean(), type: z.literal("courseforge-composition-playback") }).strict(),
  z.object({ ...iframeMessageBase, pendingMediaIds: z.array(hfIdSchema).max(32), state: z.enum(["BUFFERING", "PLAYING", "PREPARING", "READY"]), type: z.literal("courseforge-composition-media-state") }).strict(),
  z.object({ ...iframeMessageBase, metric: compositionPreviewMetricSchema, type: z.literal("courseforge-composition-media-metric") }).strict(),
  z.object({ ...iframeMessageBase, code: z.string().trim().min(1).max(80), mediaId: hfIdSchema, message: z.string().trim().min(1).max(500), type: z.literal("courseforge-composition-media-error") }).strict(),
  z.object({
    ...iframeMessageBase,
    bounds: z.object({ height: z.number().finite(), width: z.number().finite(), x: z.number().finite(), y: z.number().finite() }).strict().optional(),
    hfId: hfIdSchema.nullable(),
    type: z.literal("courseforge-composition-selection"),
  }).strict(),
  z.object({ ...iframeMessageBase, hfId: hfIdSchema, layout: layoutSchema, type: z.literal("courseforge-composition-layout-commit") }).strict(),
  z.object({ ...iframeMessageBase, crop: compositionVisualCropSchema, hfId: hfIdSchema, type: z.literal("courseforge-composition-crop-commit") }).strict(),
  z.object({
    ...iframeMessageBase,
    corrections: z.array(z.object({ hfId: hfIdSchema, layout: layoutSchema }).strict()).max(100),
    type: z.literal("courseforge-composition-aspect-corrections"),
  }).strict(),
  z.object({
    applied: z.boolean(),
    code: z.enum(["APPLIED", "INVALID_PATCH", "RUNTIME_ERROR", "TARGET_NOT_FOUND", "VERSION_MISMATCH"]),
    durationMs: z.number().finite().min(0).max(120_000),
    ...iframeMessageBase,
    sequence: z.number().int().min(1).max(2_147_483_647),
    type: z.literal("courseforge-composition-visual-patch-result"),
  }).strict(),
]);

export const compositionPreviewParentCommandSchema = z.discriminatedUnion("type", [
  z.object({ protocolVersion: protocolVersionSchema, seconds: secondsSchema, type: z.literal("courseforge-composition-seek") }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal("courseforge-composition-play") }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal("courseforge-composition-pause") }).strict(),
  z.object({
    cropEnabled: z.boolean(), editingEnabled: z.boolean(), gridVisible: z.boolean(), protocolVersion: protocolVersionSchema,
    snapEnabled: z.boolean(), type: z.literal("courseforge-composition-editor-settings"),
  }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, scale: z.number().finite().min(0.5).max(2), type: z.literal("courseforge-composition-preview-zoom") }).strict(),
  z.object({ crop: compositionVisualCropSchema, hfId: hfIdSchema, protocolVersion: protocolVersionSchema, type: z.literal("courseforge-composition-preview-crop") }).strict(),
  z.object({ hfId: hfIdSchema.nullable(), protocolVersion: protocolVersionSchema, type: z.literal("courseforge-composition-select") }).strict(),
  z.object({
    baseDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i),
    patch: compositionPreviewVisualPatchSchema,
    protocolVersion: protocolVersionSchema,
    sequence: z.number().int().min(1).max(2_147_483_647),
    type: z.literal("courseforge-composition-visual-patch"),
  }).strict(),
]);

export type CompositionPreviewIframeMessage = z.output<typeof compositionPreviewIframeMessageSchema>;
export type CompositionPreviewVisualPatchResult = Extract<CompositionPreviewIframeMessage, { type: "courseforge-composition-visual-patch-result" }>;
export type CompositionPreviewParentCommandInput = z.input<typeof compositionPreviewParentCommandSchema>;

export function parseCompositionPreviewIframeMessage(candidate: unknown) {
  const parsed = compositionPreviewIframeMessageSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function createCompositionPreviewParentCommand(candidate: CompositionPreviewParentCommandInput) {
  const parsed = compositionPreviewParentCommandSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
