import { COMPOSITION_MAX_GROUPS, COMPOSITION_MAX_CLIPS, COMPOSITION_GROUP_MAX_DIRECT_MEMBERS, validateCompositionGroupGraph } from "./composition-group-hierarchy";
import { z } from "zod";
import { buildCaptionEffectPlan } from "./composition-caption-effects-plan";
import { HTML_EDITABLE_COMPOSITION_DOCUMENT_FORMAT, htmlEditingReferencesSchema } from "./html-editing/html-editing-reference.contract";
import { ANIMATED_DECK_APPEARANCES } from "../animated-deck/animated-deck-appearance.service";
import {
  exceedsCompositionTimelineBoundary,
  DEFAULT_COMPOSITION_RENDER_FPS,
} from "./composition-document.types.constants";
import { compositionMotionSchema } from "./composition-motion.types";
import { compositionNarrativeSceneSchema } from "./composition-narrative.types";
import { resolveCompositionAnimationWindow } from "./composition-motion-scheduling.service";
import {
  compositionTransitionsSchema,
  type CompositionTransitions,
} from "./composition-transition.types";
import {
  COMPOSITION_LAYER_MAX,
  COMPOSITION_LAYER_DEPTH_LIMIT,
} from "./composition-layer-depth";
import type { CompositionColorGrading } from "./composition-color-grading.types";
import { compositionClipSchema } from "./composition-clip.contract";
import { editorIdSchema, finiteNumberSchema, boundedSecondsSchema } from "./composition-schema-primitives";
export {
  compositionClipSchema, compositionLayoutSchema, compositionLayoutPatchSchema,
  compositionVisualCropSchema, COMPOSITION_MEDIA_FIT_MODES, getCompositionClipMediaAssetId,
} from "./composition-clip.contract";
export type { CompositionClip, CompositionVisualCrop, CompositionMediaFit } from "./composition-clip.contract";

export const LEGACY_COMPOSITION_DOCUMENT_FORMAT = "courseforge-composition-v1";
export const COMPOSITION_DOCUMENT_FORMAT = "courseforge-composition-v2";
export const NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT = "courseforge-composition-v3";
/** Supports full source media such as a 2–3 minute avatar without truncating it. */
export { COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS, COMPOSITION_TIMELINE_BOUNDARY_EPSILON_SECONDS, exceedsCompositionTimelineBoundary } from "./composition-document.types.constants";
export const COMPOSITION_DURATION_SOURCES = [
  "media",
  "voice",
  "avatar_full",
  "avatar_clips",
  "b_roll",
  "slides",
] as const;
export type CompositionDurationSource = typeof COMPOSITION_DURATION_SOURCES[number];
export const COMPOSITION_TRACK_ROLES = ["DECK", "AVATAR", "VOICE", "MUSIC", "SFX", "BROLL", "VISUAL", "OVERLAY", "TEXT", "CAPTIONS"] as const;
export type CompositionTrackRole = typeof COMPOSITION_TRACK_ROLES[number];
export const DEFAULT_COMPOSITION_DUCKING_SETTINGS = {
  attackSeconds: 0.2,
  duckedVolumeRatio: 0.35,
  enabled: true,
  releaseSeconds: 0.35,
  targetRole: "MUSIC" as const,
  triggerRoles: ["VOICE", "AVATAR"] as const,
};

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

export const compositionAudioMixSchema = z.object({
  masterVolume: finiteNumberSchema.min(0).max(1).optional(),
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

const deckStylesSchema = z.object({
  sourceWidth: z.number().int().positive().max(8192).optional(),
  sourceHeight: z.number().int().positive().max(8192).optional(),
  /** Optional only for composition documents created before deck appearances. */
  appearance: z.enum(ANIMATED_DECK_APPEARANCES).optional(),
  css: z.string().max(200_000),
  fontUrls: z.array(z.string().url()).max(32),
}).strict();

/**
 * Editor-only logical grouping. Groups never become HyperFrames clips or
 * tracks; the render compiler continues to consume the resolved clip list.
 */
export const compositionGroupSchema = z.object({
  timelineMode: z.literal("NESTED").optional(),
  clipIds: z.array(editorIdSchema).max(COMPOSITION_GROUP_MAX_DIRECT_MEMBERS),
  childGroupIds: z.array(editorIdSchema).max(COMPOSITION_MAX_GROUPS).optional(),
  id: editorIdSchema,
  label: z.string().trim().min(1).max(120).optional(),
  order: z.number().int().min(0).max(499),
}).strict().superRefine((group, context) => {
  if (new Set(group.clipIds).size !== group.clipIds.length) {
    context.addIssue({ code: "custom", message: `El grupo ${group.id} contiene clips duplicados.` });
  }
});

export const compositionEditorDocumentSchema = z.object({
  extraLayerDepths: z.array(z.number().int().gt(COMPOSITION_LAYER_MAX).max(COMPOSITION_LAYER_DEPTH_LIMIT))
    .max(COMPOSITION_LAYER_DEPTH_LIMIT - COMPOSITION_LAYER_MAX).optional(),
  sourceInsertionMode: z.enum(["MANUAL", "AUTOMATIC"]).optional(),
  excludedSources: z.array(z.string().min(1).max(200)).max(1000).optional(),
  narrativeScenes: z.array(compositionNarrativeSceneSchema).max(250).optional(),
  audioMix: compositionAudioMixSchema,
  canvas: z.object({
    durationMode: z.enum(["AUTO", "USER_EDITED"]).optional(),
    durationSource: z.enum(COMPOSITION_DURATION_SOURCES).optional(),
    durationSeconds: boundedSecondsSchema.positive(),
    fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]).default(DEFAULT_COMPOSITION_RENDER_FPS),
    height: z.number().int().positive().max(8_192),
    width: z.number().int().positive().max(8_192),
  }).strict(),
  clips: z.array(compositionClipSchema).max(COMPOSITION_MAX_CLIPS),
  deckStyles: deckStylesSchema.nullable(),
  format: z.enum([LEGACY_COMPOSITION_DOCUMENT_FORMAT, COMPOSITION_DOCUMENT_FORMAT, NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT, HTML_EDITABLE_COMPOSITION_DOCUMENT_FORMAT]),
  htmlEditing: htmlEditingReferencesSchema.optional(),
  groups: z.array(compositionGroupSchema).max(COMPOSITION_MAX_GROUPS).optional(),
  groupingVersion: z.literal(2).optional(),
  motion: compositionMotionSchema,
  /** Optional for backward compatibility; new transition edits initialize V1. */
  transitions: compositionTransitionsSchema.optional(),
  tracks: z.array(compositionTrackSchema).max(32),
  variables: z.object({
    accent: z.string().regex(/^#[0-9a-f]{6}$/i),
    subtitle: z.string().max(220),
    title: z.string().min(1).max(100),
  }).strict(),
}).strict().superRefine((document, context) => {
  const extras = document.extraLayerDepths || [];
  if (extras.some((depth, index) => index > 0 && depth <= extras[index - 1])) {
    context.addIssue({ code: "custom", message: "Las capas adicionales deben ser únicas y estar ordenadas." });
  }
  const registeredLayers = new Set(extras);
  if (document.clips.some(clip => clip.layout.zIndex > COMPOSITION_LAYER_MAX && !registeredLayers.has(clip.layout.zIndex))) {
    context.addIssue({ code: "custom", message: "Registra la capa adicional antes de asignarle elementos." });
  }
  try { buildCaptionEffectPlan(document); }
  catch { context.addIssue({ code: "custom", message: "La composición excede el presupuesto de efectos de captions. Reduce las frases animadas o divide la composición." }); }
  if (document.sourceInsertionMode !== "MANUAL" && (!document.clips.length || !document.tracks.length)) {
    context.addIssue({ code: "custom", message: "La composición debe conservar al menos un clip y una pista." });
  }
  const hasNativeText = document.clips.some((clip) => clip.kind === "TEXT" || clip.kind === "CAPTION");
  if (hasNativeText && document.format !== NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT && document.format !== HTML_EDITABLE_COMPOSITION_DOCUMENT_FORMAT) {
    context.addIssue({ code: "custom", message: "Las capas de texto y captions requieren el contrato courseforge-composition-v3." });
  }
  if (document.htmlEditing && document.format !== HTML_EDITABLE_COMPOSITION_DOCUMENT_FORMAT) {
    context.addIssue({ code: "custom", message: "Las revisiones HTML requieren el contrato courseforge-composition-v4." });
  }
  for (const reference of document.htmlEditing?.items || []) {
    const clip = document.clips.find(candidate => candidate.id === reference.clipId);
    if (!clip || clip.kind !== "DECK_SLIDE" || clip.source.type !== "DECK_SLIDE") {
      context.addIssue({ code: "custom", message: "La revisión HTML debe pertenecer a un clip de deck existente." });
    }
  }
  const trackIds = new Set(document.tracks.map((track) => track.id));
  const tracksById = new Map(document.tracks.map((track) => [track.id, track]));
  const clipIds = new Set<string>();
  const hfIds = new Set<string>();
  for (const clip of document.clips) {
    if (!trackIds.has(clip.trackId)) context.addIssue({ code: "custom", message: `El clip ${clip.id} no pertenece a un track válido.` });
    if (exceedsCompositionTimelineBoundary(
      clip.startSeconds + clip.durationSeconds,
      document.canvas.durationSeconds,
    )) {
      const clipEndSeconds = clip.startSeconds + clip.durationSeconds;
      context.addIssue({
        code: "custom",
        message: `El clip ${clip.id} excede la duración del canvas.`,
        params: {
          canvasDurationSeconds: document.canvas.durationSeconds,
          clipEndSeconds,
          clipId: clip.id,
          clipStartSeconds: clip.startSeconds,
          durationSeconds: clip.durationSeconds,
          issueType: "COMPOSITION_TIMELINE_BOUNDARY",
          overflowSeconds: clipEndSeconds - document.canvas.durationSeconds,
        },
      });
    }
    if (clipIds.has(clip.id)) context.addIssue({ code: "custom", message: `El id de clip ${clip.id} está duplicado.` });
    if (hfIds.has(clip.hfId)) context.addIssue({ code: "custom", message: `El id visual ${clip.hfId} está duplicado.` });
    clipIds.add(clip.id);
    hfIds.add(clip.hfId);
    if (clip.playbackRate !== undefined && (
      clip.sceneId !== undefined
      || (tracksById.get(clip.trackId)?.semanticRole !== "BROLL"
        && tracksById.get(clip.trackId)?.semanticRole !== "VISUAL")
    )) {
      context.addIssue({ code: "custom", message: `El clip ${clip.id} con velocidad ajustada debe ser B-roll independiente.` });
    }
    if (clip.playbackRate !== undefined && document.transitions?.items.some((transition) => (
      transition.fromClipId === clip.id || transition.toClipId === clip.id
    ))) {
      context.addIssue({ code: "custom", message: `El clip ${clip.id} con velocidad ajustada no admite transiciones.` });
    }
    if (clip.freezeTailSeconds !== undefined && (
      clip.sceneId !== undefined
      || (tracksById.get(clip.trackId)?.semanticRole !== "BROLL"
        && tracksById.get(clip.trackId)?.semanticRole !== "VISUAL")
      || document.transitions?.items.some((transition) => transition.fromClipId === clip.id || transition.toClipId === clip.id)
    )) {
      context.addIssue({ code: "custom", message: `El clip ${clip.id} congelado debe ser B-roll independiente y sin transiciones.` });
    }
  }
  for (const message of validateCompositionGroupGraph(document.groups ?? [], clipIds, document.groupingVersion)) {
    context.addIssue({ code: "custom", message });
  }
  if (document.groupingVersion !== 2 && document.groups?.some(group => group.timelineMode)) {
    context.addIssue({ code: "custom", message: "La anidación del timeline requiere agrupaciones versión 2." });
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
  const transitionIds = new Set<string>();
  const transitionEditPoints = new Set<string>();
  for (const transition of document.transitions?.items || []) {
    if (transitionIds.has(transition.id)) {
      context.addIssue({ code: "custom", message: `El id de transición ${transition.id} está duplicado.` });
    }
    transitionIds.add(transition.id);
    const fromClip = document.clips.find((clip) => clip.id === transition.fromClipId);
    const toClip = document.clips.find((clip) => clip.id === transition.toClipId);
    if (!fromClip || !toClip) {
      context.addIssue({ code: "custom", message: `La transición ${transition.id} apunta a un clip inexistente.` });
      continue;
    }
    if ((fromClip.kind === "AUDIO" || toClip.kind === "AUDIO") && !(fromClip.kind === "AUDIO" && toClip.kind === "AUDIO"
      && transition.type === "CROSS_DISSOLVE" && transition.audioMode === "CROSSFADE")) {
      context.addIssue({ code: "custom", message: `La transición ${transition.id} requiere dos clips visuales o un crossfade entre dos audios.` });
    }
    const editPointKey = `${transition.fromClipId}:${transition.toClipId}`;
    if (transitionEditPoints.has(editPointKey)) {
      context.addIssue({ code: "custom", message: `Existe más de una transición entre ${fromClip.label} y ${toClip.label}.` });
    }
    transitionEditPoints.add(editPointKey);
  }
});

export type { CompositionColorGrading };
export type CompositionAudioMix = z.infer<typeof compositionAudioMixSchema>;
export type CompositionEditorDocument = z.infer<typeof compositionEditorDocumentSchema>;
export type CompositionGroup = z.infer<typeof compositionGroupSchema>;
export type { CompositionTransitions };
export type CompositionTrack = z.infer<typeof compositionTrackSchema>;
