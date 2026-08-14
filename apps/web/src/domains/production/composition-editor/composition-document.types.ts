import { z } from "zod";

export const COMPOSITION_DOCUMENT_FORMAT = "courseforge-composition-v1";
/** Supports full source media such as a 2–3 minute avatar without truncating it. */
export const COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS = 600;

const editorIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,127}$/i);
const uuidSchema = z.string().uuid();
const finiteNumberSchema = z.number().finite();
const boundedSecondsSchema = finiteNumberSchema.min(0).max(COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS);

export const compositionTrackSchema = z.object({
  id: editorIdSchema,
  kind: z.enum(["AUDIO", "DECK", "OVERLAY", "VISUAL"]),
  label: z.string().trim().min(1).max(120),
  locked: z.boolean().default(false),
  order: z.number().int().min(0).max(99),
}).strict();

export const compositionLayoutSchema = z.object({
  height: finiteNumberSchema.positive().max(8_192),
  opacity: finiteNumberSchema.min(0).max(1).default(1),
  rotation: finiteNumberSchema.min(-360).max(360).default(0),
  width: finiteNumberSchema.positive().max(8_192),
  x: finiteNumberSchema.min(-8_192).max(8_192),
  y: finiteNumberSchema.min(-8_192).max(8_192),
  zIndex: z.number().int().min(-100).max(100).default(0),
}).strict();

const deckSourceSchema = z.object({
  classes: z.string().trim().min(1).max(2_000).default("slide active"),
  html: z.string().min(1).max(100_000),
  slideIndex: z.number().int().min(0).max(1_000),
}).strict();

const deckStylesSchema = z.object({
  css: z.string().max(200_000),
  fontUrls: z.array(z.string().url()).max(32),
}).strict();

const productionAssetSourceSchema = z.object({
  productionAssetId: uuidSchema,
}).strict();

export const compositionClipSchema = z.object({
  durationSeconds: boundedSecondsSchema.positive(),
  hidden: z.boolean().default(false),
  hfId: editorIdSchema,
  id: editorIdSchema,
  kind: z.enum(["AUDIO", "DECK_SLIDE", "IMAGE", "VIDEO"]),
  label: z.string().trim().min(1).max(200),
  layout: compositionLayoutSchema,
  source: z.discriminatedUnion("type", [
    deckSourceSchema.extend({ type: z.literal("DECK_SLIDE") }),
    productionAssetSourceSchema.extend({ type: z.literal("PRODUCTION_ASSET") }),
  ]),
  startSeconds: boundedSecondsSchema,
  timingSource: z.enum(["ESTIMATED", "USER_EDITED"]),
  trackId: editorIdSchema,
}).strict().superRefine((clip, context) => {
  if (clip.startSeconds + clip.durationSeconds > COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS) {
    context.addIssue({ code: "custom", message: "El clip excede la duración máxima de la composición." });
  }
  if (clip.kind === "DECK_SLIDE" && clip.source.type !== "DECK_SLIDE") {
    context.addIssue({ code: "custom", message: "Un clip de deck debe conservar su fuente HTML." });
  }
  if (clip.kind !== "DECK_SLIDE" && clip.source.type !== "PRODUCTION_ASSET") {
    context.addIssue({ code: "custom", message: "Un clip multimedia debe referenciar un asset de Producción." });
  }
});

export const compositionEditorDocumentSchema = z.object({
  canvas: z.object({
    durationSeconds: boundedSecondsSchema.positive(),
    fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).default(30),
    height: z.number().int().positive().max(8_192),
    width: z.number().int().positive().max(8_192),
  }).strict(),
  clips: z.array(compositionClipSchema).min(1).max(500),
  deckStyles: deckStylesSchema.nullable(),
  format: z.literal(COMPOSITION_DOCUMENT_FORMAT),
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
});

export type CompositionClip = z.infer<typeof compositionClipSchema>;
export type CompositionEditorDocument = z.infer<typeof compositionEditorDocumentSchema>;
export type CompositionTrack = z.infer<typeof compositionTrackSchema>;
