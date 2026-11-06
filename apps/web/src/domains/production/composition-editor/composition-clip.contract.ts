import { z } from "zod";
import { compositionVisualMaskSchema } from "./composition-visual-mask";
import { compositionVolumeEnvelopeSchema } from "./composition-volume-envelope";
import { compositionDeckFontReferencesSchema } from "./composition-font-reference.contract";
import { COMPOSITION_VIDEO_PLAYBACK_RATES, videoRateSourceWindowFits } from "./composition-video-rate";
import { COMPOSITION_VIDEO_FREEZE_TOLERANCE_SECONDS, COMPOSITION_VIDEO_MAX_FREEZE_SECONDS, resolveVideoFreezeTailSeconds } from "./composition-video-freeze";
import { ANIMATED_DECK_APPEARANCES } from "../animated-deck/animated-deck-appearance.service";
import { COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS, COMPOSITION_TIMELINE_BOUNDARY_EPSILON_SECONDS } from "./composition-document.types.constants";
import { COMPOSITION_LAYER_MIN, COMPOSITION_LAYER_DEPTH_LIMIT } from "./composition-layer-depth";
import { compositionColorGradingSchema } from "./composition-color-grading.types";
import { compositionNativeCaptionSourceSchema, compositionNativeTextSourceSchema } from "./composition-text-layer.types";
import { editorIdSchema, finiteNumberSchema, boundedSecondsSchema } from "./composition-schema-primitives";

export const COMPOSITION_MEDIA_FIT_MODES = ["CONTAIN", "COVER"] as const;
export type CompositionMediaFit = typeof COMPOSITION_MEDIA_FIT_MODES[number];
const uuidSchema = z.string().uuid();
const sourceMediaSecondsSchema = finiteNumberSchema.min(0).max(86_400);

const compositionLayoutFieldSchemas = {
  height: finiteNumberSchema.positive().max(8_192),
  opacity: finiteNumberSchema.min(0).max(1),
  rotation: finiteNumberSchema.min(-360).max(360),
  width: finiteNumberSchema.positive().max(8_192),
  x: finiteNumberSchema.min(-8_192).max(8_192),
  y: finiteNumberSchema.min(-8_192).max(8_192),
  zIndex: z.number().int().min(COMPOSITION_LAYER_MIN).max(COMPOSITION_LAYER_DEPTH_LIMIT),
};

export const compositionLayoutSchema = z.object({
  ...compositionLayoutFieldSchemas,
  opacity: compositionLayoutFieldSchemas.opacity.default(1),
  rotation: compositionLayoutFieldSchemas.rotation.default(0),
  zIndex: compositionLayoutFieldSchemas.zIndex.default(0),
}).strict();

/** Patch-specific layout schema; optional fields must never inject document defaults. */
export const compositionLayoutPatchSchema = z.object({
  height: compositionLayoutFieldSchemas.height.optional(),
  opacity: compositionLayoutFieldSchemas.opacity.optional(),
  rotation: compositionLayoutFieldSchemas.rotation.optional(),
  width: compositionLayoutFieldSchemas.width.optional(),
  x: compositionLayoutFieldSchemas.x.optional(),
  y: compositionLayoutFieldSchemas.y.optional(),
  zIndex: compositionLayoutFieldSchemas.zIndex.optional(),
}).strict();

const legacyCompositionVisualCropSchema = z.object({
  focusX: finiteNumberSchema.min(0).max(1),
  focusY: finiteNumberSchema.min(0).max(1),
  zoom: finiteNumberSchema.min(1).max(8),
}).strict();

const insetCompositionVisualCropSchema = z.object({
  bottom: finiteNumberSchema.min(0).max(8_192),
  left: finiteNumberSchema.min(0).max(8_192),
  right: finiteNumberSchema.min(0).max(8_192),
  top: finiteNumberSchema.min(0).max(8_192),
}).strict();

/**
 * New edits use independent pixel insets, matching HyperFrames Studio's
 * `clip-path: inset(...)` crop contract. The legacy focus/zoom variant remains
 * readable so existing draft documents can be migrated non-destructively.
 */
export const compositionVisualCropSchema = z.union([
  insetCompositionVisualCropSchema,
  legacyCompositionVisualCropSchema,
]);

const deckSourceSchema = z.object({
  fontBindings: compositionDeckFontReferencesSchema.optional(),
    htmlAssetId: z.string().uuid().optional(),
    sourceSlideIndex: z.number().int().min(0).max(1000).optional(),
    sourceWidth: z.number().int().positive().max(8192).optional(),
    sourceHeight: z.number().int().positive().max(8192).optional(),
    appearance: z.enum(ANIMATED_DECK_APPEARANCES).optional(),
  slideKey: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  classes: z.string().trim().min(1).max(2_000).default("slide active"),
  html: z.string().min(1).max(100_000),
  slideIndex: z.number().int().min(0).max(1_000),
}).strict();

const productionAssetSourceSchema = z.object({
  /** Result of media probing; absent on documents created before audio detection. */
  hasAudio: z.boolean().optional(),
  /** A Production asset intentionally reserved for the opening of this video. */
  placement: z.literal("INTRO").optional(),
  productionAssetId: uuidSchema,
  sourceHeight: z.number().int().positive().max(16_384).optional(),
  sourceWidth: z.number().int().positive().max(16_384).optional(),
}).strict();

const assemblyBrandAssetSourceSchema = z.object({
  assemblyBrandAssetId: uuidSchema,
  /** Result of media probing; branding videos default to fail-closed when absent. */
  hasAudio: z.boolean().optional(),
  placement: z.enum(["INTRO", "OUTRO"]),
  sourceHeight: z.number().int().positive().max(16_384).optional(),
  sourceWidth: z.number().int().positive().max(16_384).optional(),
}).strict();

/** A reusable, organization-scoped library item; its binary never lives in the document. */
const soundEffectAssetSourceSchema = z.object({
  soundEffectAssetId: uuidSchema,
}).strict();

export const compositionClipSchema = z.object({
  /** Source-anchored gain points survive trim/split without destructive audio edits. */
  volumeEnvelope: compositionVolumeEnvelopeSchema.optional(),
  colorGrading: compositionColorGradingSchema.optional(),
  sceneId: z.string().min(1).max(160).optional(),
  crop: compositionVisualCropSchema.optional(),
  mask: compositionVisualMaskSchema.optional(),
  durationSeconds: boundedSecondsSchema.positive(),
  /** Non-destructive, linear gain ramps applied at the clip boundaries. */
  fadeInSeconds: boundedSecondsSchema.optional(),
  fadeOutSeconds: boundedSecondsSchema.optional(),
  hidden: z.boolean().default(false),
  hfId: editorIdSchema,
  id: editorIdSchema,
  kind: z.enum(["AUDIO", "CAPTION", "DECK_SLIDE", "IMAGE", "TEXT", "VIDEO"]),
  label: z.string().trim().min(1).max(200),
  layout: compositionLayoutSchema,
  /** Controls source fitting independently from layout and explicit crop. */
  mediaFit: z.enum(COMPOSITION_MEDIA_FIT_MODES).optional(),
  source: z.discriminatedUnion("type", [
    assemblyBrandAssetSourceSchema.extend({ type: z.literal("ASSEMBLY_BRAND_ASSET") }),
    deckSourceSchema.extend({ type: z.literal("DECK_SLIDE") }),
    compositionNativeCaptionSourceSchema,
    compositionNativeTextSourceSchema,
    productionAssetSourceSchema.extend({ type: z.literal("PRODUCTION_ASSET") }),
    soundEffectAssetSourceSchema.extend({ type: z.literal("SOUND_EFFECT_ASSET") }),
  ]),
  sourceDurationSeconds: sourceMediaSecondsSchema.positive().optional(),
  sourceOffsetSeconds: sourceMediaSecondsSchema.optional(),
  /** Source seconds consumed per timeline second; only bounded silent video supports this. */
  playbackRate: z.union(COMPOSITION_VIDEO_PLAYBACK_RATES.map((rate) => z.literal(rate))).optional(),
  /** Seconds for which a non-looping silent video holds its final source frame. */
  freezeTailSeconds: z.number().finite().positive().max(COMPOSITION_VIDEO_MAX_FREEZE_SECONDS).optional(),
  startSeconds: boundedSecondsSchema,
  timingSource: z.enum(["ESTIMATED", "USER_EDITED"]),
  trackId: editorIdSchema,
  /** Per-clip source audio multiplier; track volume remains the master gain. */
  volume: finiteNumberSchema.min(0).max(1).optional(),
}).strict().superRefine((clip, context) => {
  if (clip.mask && clip.kind !== "VIDEO" && clip.kind !== "IMAGE" && clip.kind !== "DECK_SLIDE") {
    context.addIssue({ code: "custom", message: "Las máscaras sólo están disponibles para videos, imágenes y diapositivas." });
  }
  if ((clip.fadeInSeconds || 0) + (clip.fadeOutSeconds || 0) > clip.durationSeconds + COMPOSITION_TIMELINE_BOUNDARY_EPSILON_SECONDS) {
    context.addIssue({
      code: "custom",
      message: "La suma de los fades no puede exceder la duración del clip.",
    });
  }
  if (clip.startSeconds + clip.durationSeconds > COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS) {
    context.addIssue({ code: "custom", message: "El clip excede la duración máxima de la composición." });
  }
  if (
    clip.sourceDurationSeconds !== undefined
    && (clip.sourceOffsetSeconds || 0) >= clip.sourceDurationSeconds
  ) {
    context.addIssue({ code: "custom", message: "El inicio del recorte debe quedar dentro de la duración del asset." });
  }
  if (
    clip.kind === "AUDIO"
    && clip.sourceDurationSeconds !== undefined
    && (clip.sourceOffsetSeconds || 0) + clip.durationSeconds > clip.sourceDurationSeconds + 0.001
  ) {
    context.addIssue({ code: "custom", message: "El recorte de audio excede la duración disponible del asset." });
  }
  if (clip.playbackRate !== undefined && (
    clip.kind !== "VIDEO"
    || clip.source.type !== "PRODUCTION_ASSET"
    || clip.source.hasAudio !== false
    || clip.sourceDurationSeconds === undefined
    || !videoRateSourceWindowFits({
      clipDurationSeconds: clip.durationSeconds,
      playbackRate: clip.playbackRate,
      sourceDurationSeconds: clip.sourceDurationSeconds || 0,
      sourceOffsetSeconds: clip.sourceOffsetSeconds || 0,
    })
  )) {
    context.addIssue({ code: "custom", message: "La velocidad requiere video sin audio y un rango de fuente suficiente." });
  }
  const resolvedFreezeTailSeconds = clip.sourceDurationSeconds === undefined ? null : resolveVideoFreezeTailSeconds({
    clipDurationSeconds: clip.durationSeconds,
    sourceDurationSeconds: clip.sourceDurationSeconds,
    sourceOffsetSeconds: clip.sourceOffsetSeconds || 0,
  });
  if (clip.freezeTailSeconds !== undefined && (
    clip.kind !== "VIDEO"
    || clip.source.type !== "PRODUCTION_ASSET"
    || clip.source.hasAudio !== false
    || clip.playbackRate !== undefined
    || clip.sourceDurationSeconds === undefined
    || resolvedFreezeTailSeconds === null
    || Math.abs(resolvedFreezeTailSeconds - clip.freezeTailSeconds) > COMPOSITION_VIDEO_FREEZE_TOLERANCE_SECONDS
  )) {
    context.addIssue({ code: "custom", message: "La congelación requiere el último frame de un video sin audio y una duración de cola válida." });
  }
  if (clip.kind === "DECK_SLIDE" && clip.source.type !== "DECK_SLIDE") {
    context.addIssue({ code: "custom", message: "Un clip de deck debe conservar su fuente HTML." });
  }
  if (clip.kind === "TEXT" && clip.source.type !== "NATIVE_TEXT") {
    context.addIssue({ code: "custom", message: "Una capa de texto debe conservar su fuente de texto nativo." });
  }
  if (clip.kind === "CAPTION" && clip.source.type !== "NATIVE_CAPTIONS") {
    context.addIssue({ code: "custom", message: "Una capa de captions debe conservar su fuente de captions nativos." });
  }
  if (
    clip.kind !== "DECK_SLIDE"
    && clip.kind !== "TEXT"
    && clip.kind !== "CAPTION"
    && clip.source.type !== "PRODUCTION_ASSET"
    && clip.source.type !== "ASSEMBLY_BRAND_ASSET"
    && clip.source.type !== "SOUND_EFFECT_ASSET"
  ) {
    context.addIssue({ code: "custom", message: "Un clip multimedia debe referenciar un asset válido." });
  }
  if (clip.source.type === "NATIVE_TEXT" && clip.kind !== "TEXT") {
    context.addIssue({ code: "custom", message: "La fuente de texto nativo solo puede usarse en una capa TEXT." });
  }
  if (clip.source.type === "NATIVE_CAPTIONS") {
    if (clip.kind !== "CAPTION") {
      context.addIssue({ code: "custom", message: "La fuente de captions solo puede usarse en una capa CAPTION." });
    }
    for (const cue of clip.source.cues) {
      if (cue.endSeconds > clip.durationSeconds + COMPOSITION_TIMELINE_BOUNDARY_EPSILON_SECONDS) {
        context.addIssue({ code: "custom", message: `El caption ${cue.id} excede la duración de su capa.` });
      }
    }
  }
  if (clip.source.type === "ASSEMBLY_BRAND_ASSET" && clip.kind !== "VIDEO") {
    context.addIssue({ code: "custom", message: "Intro y outro deben ser clips de video." });
  }
  if (clip.colorGrading && clip.kind !== "VIDEO" && clip.kind !== "IMAGE") {
    context.addIssue({ code: "custom", message: "La corrección de color solo está disponible para videos e imágenes." });
  }
});

export type CompositionClip = z.infer<typeof compositionClipSchema>;
export type CompositionVisualCrop = z.infer<typeof compositionVisualCropSchema>;

export function getCompositionClipMediaAssetId(clip: CompositionClip) {
  if (clip.source.type === "PRODUCTION_ASSET") return clip.source.productionAssetId;
  if (clip.source.type === "ASSEMBLY_BRAND_ASSET") return clip.source.assemblyBrandAssetId;
  if (clip.source.type === "SOUND_EFFECT_ASSET") return clip.source.soundEffectAssetId;
  return null;
}
