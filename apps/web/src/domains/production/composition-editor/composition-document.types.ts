import { z } from "zod";
import { ANIMATED_DECK_APPEARANCES } from "../animated-deck/animated-deck-appearance.service";
import {
  COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS,
  DEFAULT_COMPOSITION_RENDER_FPS,
} from "./composition-document.types.constants";
import { compositionMotionSchema } from "./composition-motion.types";
import { resolveCompositionAnimationWindow } from "./composition-motion-scheduling.service";
import {
  COMPOSITION_LAYER_MAX,
  COMPOSITION_LAYER_MIN,
} from "./composition-layer-depth";

export const LEGACY_COMPOSITION_DOCUMENT_FORMAT = "courseforge-composition-v1";
export const COMPOSITION_DOCUMENT_FORMAT = "courseforge-composition-v2";
/** Supports full source media such as a 2–3 minute avatar without truncating it. */
export { COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS } from "./composition-document.types.constants";
export const COMPOSITION_DURATION_SOURCES = [
  "voice",
  "avatar_full",
  "avatar_clips",
  "b_roll",
  "slides",
] as const;
export type CompositionDurationSource = typeof COMPOSITION_DURATION_SOURCES[number];
export const COMPOSITION_TRACK_ROLES = ["DECK", "AVATAR", "VOICE", "MUSIC", "BROLL", "VISUAL", "OVERLAY"] as const;
export type CompositionTrackRole = typeof COMPOSITION_TRACK_ROLES[number];
export const COMPOSITION_MEDIA_FIT_MODES = ["CONTAIN", "COVER"] as const;
export type CompositionMediaFit = typeof COMPOSITION_MEDIA_FIT_MODES[number];
export const DEFAULT_COMPOSITION_DUCKING_SETTINGS = {
  attackSeconds: 0.2,
  duckedVolumeRatio: 0.35,
  enabled: true,
  releaseSeconds: 0.35,
  targetRole: "MUSIC" as const,
  triggerRoles: ["VOICE", "AVATAR"] as const,
};

const editorIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,127}$/i);
const uuidSchema = z.string().uuid();
const finiteNumberSchema = z.number().finite();
const boundedSecondsSchema = finiteNumberSchema.min(0).max(COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS);
const sourceMediaSecondsSchema = finiteNumberSchema.min(0).max(86_400);

export const compositionTrackSchema = z.object({
  hidden: z.boolean().optional(),
  id: editorIdSchema,
  kind: z.enum(["AUDIO", "DECK", "OVERLAY", "VISUAL"]),
  label: z.string().trim().min(1).max(120),
  locked: z.boolean().default(false),
  muted: z.boolean().optional(),
  order: z.number().int().min(0).max(99),
  semanticRole: z.enum(COMPOSITION_TRACK_ROLES).optional(),
  volume: finiteNumberSchema.min(0).max(1).optional(),
}).strict();

const compositionLayoutFieldSchemas = {
  height: finiteNumberSchema.positive().max(8_192),
  opacity: finiteNumberSchema.min(0).max(1),
  rotation: finiteNumberSchema.min(-360).max(360),
  width: finiteNumberSchema.positive().max(8_192),
  x: finiteNumberSchema.min(-8_192).max(8_192),
  y: finiteNumberSchema.min(-8_192).max(8_192),
  zIndex: z.number().int().min(COMPOSITION_LAYER_MIN).max(COMPOSITION_LAYER_MAX),
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

export const compositionAudioMixSchema = z.object({
  ducking: z.object({
    attackSeconds: finiteNumberSchema.min(0).max(5).default(DEFAULT_COMPOSITION_DUCKING_SETTINGS.attackSeconds),
    duckedVolumeRatio: finiteNumberSchema.min(0).max(1).default(DEFAULT_COMPOSITION_DUCKING_SETTINGS.duckedVolumeRatio),
    enabled: z.boolean().default(DEFAULT_COMPOSITION_DUCKING_SETTINGS.enabled),
    releaseSeconds: finiteNumberSchema.min(0).max(5).default(DEFAULT_COMPOSITION_DUCKING_SETTINGS.releaseSeconds),
    targetRole: z.literal("MUSIC").default(DEFAULT_COMPOSITION_DUCKING_SETTINGS.targetRole),
    triggerRoles: z.array(z.enum(["VOICE", "AVATAR"])).min(1).max(2).default([...DEFAULT_COMPOSITION_DUCKING_SETTINGS.triggerRoles]),
  }).strict().default({ ...DEFAULT_COMPOSITION_DUCKING_SETTINGS, triggerRoles: [...DEFAULT_COMPOSITION_DUCKING_SETTINGS.triggerRoles] }),
}).strict().default({
  ducking: { ...DEFAULT_COMPOSITION_DUCKING_SETTINGS, triggerRoles: [...DEFAULT_COMPOSITION_DUCKING_SETTINGS.triggerRoles] },
});

const deckSourceSchema = z.object({
  classes: z.string().trim().min(1).max(2_000).default("slide active"),
  html: z.string().min(1).max(100_000),
  slideIndex: z.number().int().min(0).max(1_000),
}).strict();

const deckStylesSchema = z.object({
  /** Optional only for composition documents created before deck appearances. */
  appearance: z.enum(ANIMATED_DECK_APPEARANCES).optional(),
  css: z.string().max(200_000),
  fontUrls: z.array(z.string().url()).max(32),
}).strict();

const productionAssetSourceSchema = z.object({
  /** Result of media probing; absent on documents created before audio detection. */
  hasAudio: z.boolean().optional(),
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

export const compositionClipSchema = z.object({
  crop: compositionVisualCropSchema.optional(),
  durationSeconds: boundedSecondsSchema.positive(),
  hidden: z.boolean().default(false),
  hfId: editorIdSchema,
  id: editorIdSchema,
  kind: z.enum(["AUDIO", "DECK_SLIDE", "IMAGE", "VIDEO"]),
  label: z.string().trim().min(1).max(200),
  layout: compositionLayoutSchema,
  /** Controls source fitting independently from layout and explicit crop. */
  mediaFit: z.enum(COMPOSITION_MEDIA_FIT_MODES).optional(),
  source: z.discriminatedUnion("type", [
    assemblyBrandAssetSourceSchema.extend({ type: z.literal("ASSEMBLY_BRAND_ASSET") }),
    deckSourceSchema.extend({ type: z.literal("DECK_SLIDE") }),
    productionAssetSourceSchema.extend({ type: z.literal("PRODUCTION_ASSET") }),
  ]),
  sourceDurationSeconds: sourceMediaSecondsSchema.positive().optional(),
  sourceOffsetSeconds: sourceMediaSecondsSchema.optional(),
  startSeconds: boundedSecondsSchema,
  timingSource: z.enum(["ESTIMATED", "USER_EDITED"]),
  trackId: editorIdSchema,
  /** Per-clip source audio multiplier; track volume remains the master gain. */
  volume: finiteNumberSchema.min(0).max(1).optional(),
}).strict().superRefine((clip, context) => {
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
  if (clip.kind === "DECK_SLIDE" && clip.source.type !== "DECK_SLIDE") {
    context.addIssue({ code: "custom", message: "Un clip de deck debe conservar su fuente HTML." });
  }
  if (clip.kind !== "DECK_SLIDE" && clip.source.type !== "PRODUCTION_ASSET" && clip.source.type !== "ASSEMBLY_BRAND_ASSET") {
    context.addIssue({ code: "custom", message: "Un clip multimedia debe referenciar un asset válido." });
  }
  if (clip.source.type === "ASSEMBLY_BRAND_ASSET" && clip.kind !== "VIDEO") {
    context.addIssue({ code: "custom", message: "Intro y outro deben ser clips de video." });
  }
});

export const compositionEditorDocumentSchema = z.object({
  audioMix: compositionAudioMixSchema,
  canvas: z.object({
    durationMode: z.enum(["AUTO", "USER_EDITED"]).optional(),
    durationSource: z.enum(COMPOSITION_DURATION_SOURCES).optional(),
    durationSeconds: boundedSecondsSchema.positive(),
    fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]).default(DEFAULT_COMPOSITION_RENDER_FPS),
    height: z.number().int().positive().max(8_192),
    width: z.number().int().positive().max(8_192),
  }).strict(),
  clips: z.array(compositionClipSchema).min(1).max(500),
  deckStyles: deckStylesSchema.nullable(),
  format: z.enum([LEGACY_COMPOSITION_DOCUMENT_FORMAT, COMPOSITION_DOCUMENT_FORMAT]),
  motion: compositionMotionSchema,
  tracks: z.array(compositionTrackSchema).min(1).max(32),
  variables: z.object({
    accent: z.string().regex(/^#[0-9a-f]{6}$/i),
    subtitle: z.string().max(220),
    title: z.string().min(1).max(100),
  }).strict(),
}).strict().superRefine((document, context) => {
  const trackIds = new Set(document.tracks.map((track) => track.id));
  const clipIds = new Set<string>();
  const hfIds = new Set<string>();
  for (const clip of document.clips) {
    if (!trackIds.has(clip.trackId)) context.addIssue({ code: "custom", message: `El clip ${clip.id} no pertenece a un track válido.` });
    if (clip.startSeconds + clip.durationSeconds > document.canvas.durationSeconds) {
      context.addIssue({ code: "custom", message: `El clip ${clip.id} excede la duración del canvas.` });
    }
    if (clipIds.has(clip.id)) context.addIssue({ code: "custom", message: `El id de clip ${clip.id} está duplicado.` });
    if (hfIds.has(clip.hfId)) context.addIssue({ code: "custom", message: `El id visual ${clip.hfId} está duplicado.` });
    clipIds.add(clip.id);
    hfIds.add(clip.hfId);
  }
  const animationIds = new Set<string>();
  const animationsByTargetAndGroup = new Map<string, Array<{ end: number; id: string; start: number }>>();
  for (const animation of document.motion.animations) {
    if (animationIds.has(animation.id)) context.addIssue({ code: "custom", message: `El id de animación ${animation.id} está duplicado.` });
    animationIds.add(animation.id);
    const clip = document.clips.find((candidate) => candidate.id === animation.target.clipId);
    if (!clip) {
      context.addIssue({ code: "custom", message: `La animación ${animation.id} apunta a un clip inexistente.` });
      continue;
    }
    const animationWindow = resolveCompositionAnimationWindow(animation, clip.durationSeconds);
    const relativeStart = animationWindow.start;
    const relativeEnd = animationWindow.end;
    if (relativeStart < -0.001 || relativeEnd > clip.durationSeconds + 0.001) {
      context.addIssue({ code: "custom", message: `La animación ${animation.id} excede la duración de ${clip.label}.` });
    }
    const groupKey = `${clip.id}:${animation.propertyGroup}`;
    const siblings = animationsByTargetAndGroup.get(groupKey) || [];
    if (siblings.some((sibling) => relativeStart < sibling.end - 0.001 && relativeEnd > sibling.start + 0.001)) {
      context.addIssue({ code: "custom", message: `La animación ${animation.id} se solapa con otra del mismo grupo de propiedades.` });
    }
    siblings.push({ end: relativeEnd, id: animation.id, start: relativeStart });
    animationsByTargetAndGroup.set(groupKey, siblings);
  }
});

export type CompositionClip = z.infer<typeof compositionClipSchema>;
export type CompositionVisualCrop = z.infer<typeof compositionVisualCropSchema>;
export type CompositionAudioMix = z.infer<typeof compositionAudioMixSchema>;
export type CompositionEditorDocument = z.infer<typeof compositionEditorDocumentSchema>;
export type CompositionTrack = z.infer<typeof compositionTrackSchema>;

export function getCompositionClipMediaAssetId(clip: CompositionClip) {
  if (clip.source.type === "PRODUCTION_ASSET") return clip.source.productionAssetId;
  if (clip.source.type === "ASSEMBLY_BRAND_ASSET") return clip.source.assemblyBrandAssetId;
  return null;
}
