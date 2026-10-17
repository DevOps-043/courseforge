import { z } from "zod";
import { compositionVisualCropSchema } from "./composition-document.types";
import { compositionColorGradingSchema } from "./composition-color-grading.types";
import { compositionPreviewMetricSchema } from "./composition-preview-telemetry";
import { compositionPreviewVisualPatchSchema } from "./composition-preview-visual-patch";
import { COMPOSITION_PREVIEW_MAX_GENERATION } from "./composition-preview-comparison";
import { COMPOSITION_EDITOR_SHORTCUTS } from "./composition-editor-shortcut";

export const COMPOSITION_PREVIEW_PROTOCOL_VERSION = 1 as const;
export const COMPOSITION_PREVIEW_SELECTION_ORIGINS = ["PARENT", "PREVIEW"] as const;
export type CompositionPreviewSelectionOrigin = typeof COMPOSITION_PREVIEW_SELECTION_ORIGINS[number];

const protocolVersionSchema = z.literal(COMPOSITION_PREVIEW_PROTOCOL_VERSION).default(COMPOSITION_PREVIEW_PROTOCOL_VERSION);
const selectionOriginSchema = z.enum(COMPOSITION_PREVIEW_SELECTION_ORIGINS).default("PREVIEW");
const hfIdSchema = z.string().trim().min(1).max(160);
const secondsSchema = z.number().finite().min(0).max(86_400);
const previewGenerationSchema = z.number().int().min(0).max(COMPOSITION_PREVIEW_MAX_GENERATION);
const layoutSchema = z.object({
  height: z.number().finite().positive().max(16_384),
  width: z.number().finite().positive().max(16_384),
  x: z.number().finite().min(-16_384).max(16_384),
  y: z.number().finite().min(-16_384).max(16_384),
}).strict();

const iframeMessageBase = { previewGeneration: previewGenerationSchema.nullable().optional(), protocolVersion: protocolVersionSchema };
export const compositionPreviewLoadErrorCodeSchema = z.enum(["AUTH_REQUIRED", "ACCESS_DENIED", "COMPILATION_FAILED", "DEPENDENCY_FAILED", "DOCUMENT_UNAVAILABLE", "UNKNOWN"]);
export type CompositionPreviewLoadErrorCode = z.infer<typeof compositionPreviewLoadErrorCodeSchema>;

export const compositionPreviewIframeMessageSchema = z.discriminatedUnion("type", [
  z.object({ ...iframeMessageBase, previewGeneration: previewGenerationSchema, command: z.enum(COMPOSITION_EDITOR_SHORTCUTS), type: z.literal("courseforge-composition-shortcut") }).strict(),
  z.object({ ...iframeMessageBase, documentHash: z.string().regex(/^[a-f0-9]{64}$/i).nullable().optional(), duration: secondsSchema, selectedHfId: hfIdSchema.nullable().optional(), type: z.literal("courseforge-composition-ready") }).strict(),
  z.object({ ...iframeMessageBase, code: compositionPreviewLoadErrorCodeSchema, documentHash: z.string().regex(/^[a-f0-9]{64}$/i), previewGeneration: previewGenerationSchema, type: z.literal("courseforge-composition-load-error") }).strict(),
  z.object({ ...iframeMessageBase, seconds: secondsSchema, type: z.literal("courseforge-composition-time") }).strict(),
  z.object({ ...iframeMessageBase, playing: z.boolean(), type: z.literal("courseforge-composition-playback") }).strict(),
  z.object({
    ...iframeMessageBase,
    type: z.literal("courseforge-composition-audio-meter"),
    state: z.enum(["WAITING", "ACTIVE", "BLOCKED", "UNAVAILABLE", "PAUSED"]),
    reason: z.enum(["GESTURE_REQUIRED", "SOURCE_LIMIT", "CORS_REQUIRED", "UNSUPPORTED", "ANALYSIS_FAILED", "NO_AUDIO"]).nullable(),
    channels: z.array(z.object({
      clipping: z.boolean(),
      peakDbfs: z.number().finite().min(-120).max(24).nullable(),
      rmsDbfs: z.number().finite().min(-120).max(24).nullable(),
    }).strict()).max(2),
  }).strict(),
  z.object({ ...iframeMessageBase, pendingMediaIds: z.array(hfIdSchema).max(32), state: z.enum(["BUFFERING", "PLAYING", "PREPARING", "READY"]), type: z.literal("courseforge-composition-media-state") }).strict(),
  z.object({ ...iframeMessageBase, metric: compositionPreviewMetricSchema, type: z.literal("courseforge-composition-media-metric") }).strict(),
  z.object({ ...iframeMessageBase, code: z.string().trim().min(1).max(80), mediaId: hfIdSchema, message: z.string().trim().min(1).max(500), type: z.literal("courseforge-composition-media-error") }).strict(),
  z.object({
    ...iframeMessageBase,
    hfId: hfIdSchema,
    message: z.string().trim().min(1).max(500),
    state: z.enum(["active", "fallback", "inactive", "missing", "pending", "unavailable"]),
    type: z.literal("courseforge-composition-color-grading-status"),
  }).strict(),
  z.object({
    ...iframeMessageBase,
    bounds: z.object({ height: z.number().finite(), width: z.number().finite(), x: z.number().finite(), y: z.number().finite() }).strict().optional(),
    hfId: hfIdSchema.nullable(),
    hfIds: z.array(hfIdSchema).max(100).optional(),
    origin: selectionOriginSchema,
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
]).refine((message) => message.type !== "courseforge-composition-audio-meter"
  || (message.state === "ACTIVE" ? message.channels.length === 2 : message.channels.length === 0));

export const compositionPreviewParentCommandSchema = z.discriminatedUnion("type", [
  z.object({ protocolVersion: protocolVersionSchema, hfId: hfIdSchema.nullable(), type: z.literal("courseforge-composition-restore-focus") }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, seconds: secondsSchema, type: z.literal("courseforge-composition-seek") }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal("courseforge-composition-play") }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal("courseforge-composition-pause") }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal("courseforge-composition-reset-audio-meter") }).strict(),
  z.object({
    cropEnabled: z.boolean(), editingEnabled: z.boolean(), gridVisible: z.boolean(), protocolVersion: protocolVersionSchema,
    snapEnabled: z.boolean(), type: z.literal("courseforge-composition-editor-settings"),
  }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, scale: z.number().finite().min(0.5).max(2), type: z.literal("courseforge-composition-preview-zoom") }).strict(),
  z.object({ crop: compositionVisualCropSchema, hfId: hfIdSchema, protocolVersion: protocolVersionSchema, type: z.literal("courseforge-composition-preview-crop") }).strict(),
  z.object({ colorGrading: compositionColorGradingSchema.nullable(), hfId: hfIdSchema, protocolVersion: protocolVersionSchema, type: z.literal("courseforge-composition-preview-color-grading") }).strict(),
  z.object({ hfId: hfIdSchema.nullable(), hfIds: z.array(hfIdSchema).max(100).optional(), protocolVersion: protocolVersionSchema, type: z.literal("courseforge-composition-select") }).strict(),
  z.object({
    baseDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i),
    patch: compositionPreviewVisualPatchSchema,
    protocolVersion: protocolVersionSchema,
    sequence: z.number().int().min(1).max(2_147_483_647),
    type: z.literal("courseforge-composition-visual-patch"),
  }).strict(),
]);

export type CompositionPreviewIframeMessage = z.output<typeof compositionPreviewIframeMessageSchema>;
export type CompositionAudioMeterMessage = Extract<CompositionPreviewIframeMessage, { type: "courseforge-composition-audio-meter" }>;
export type CompositionPreviewVisualPatchResult = Extract<CompositionPreviewIframeMessage, { type: "courseforge-composition-visual-patch-result" }>;
export type CompositionColorGradingRuntimeStatus = Pick<Extract<CompositionPreviewIframeMessage, { type: "courseforge-composition-color-grading-status" }>, "message" | "state">;
export type CompositionPreviewParentCommandInput = z.input<typeof compositionPreviewParentCommandSchema>;

export function parseCompositionPreviewIframeMessage(candidate: unknown) {
  const parsed = compositionPreviewIframeMessageSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function createCompositionPreviewParentCommand(candidate: CompositionPreviewParentCommandInput) {
  const parsed = compositionPreviewParentCommandSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
