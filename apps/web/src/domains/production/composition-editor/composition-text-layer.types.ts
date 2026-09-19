import { z } from "zod";

export const COMPOSITION_TEXT_ALIGNMENTS = ["LEFT", "CENTER", "RIGHT"] as const;
export const COMPOSITION_TEXT_VERTICAL_ALIGNMENTS = ["TOP", "MIDDLE", "BOTTOM"] as const;

const finiteNumberSchema = z.number().finite();
const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);
const fontFamilySchema = z.string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[\p{L}\p{N} ._-]+$/u, "La familia tipográfica contiene caracteres no permitidos.");

export const compositionTextLayerStyleSchema = z.object({
  backgroundColor: hexColorSchema.default("#000000"),
  backgroundOpacity: finiteNumberSchema.min(0).max(1).default(0),
  borderRadius: finiteNumberSchema.min(0).max(200).default(0),
  color: hexColorSchema.default("#ffffff"),
  fontAssetId: z.string().uuid().optional(),
  fontFamily: fontFamilySchema.default("Inter"),
  fontSize: finiteNumberSchema.min(8).max(400).default(64),
  fontStyle: z.enum(["NORMAL", "ITALIC"]).default("NORMAL"),
  fontWeight: z.number().int().min(100).max(900).multipleOf(100).default(700),
  horizontalAlign: z.enum(COMPOSITION_TEXT_ALIGNMENTS).default("CENTER"),
  letterSpacing: finiteNumberSchema.min(-20).max(100).default(0),
  lineHeight: finiteNumberSchema.min(0.7).max(3).default(1.1),
  paddingX: finiteNumberSchema.min(0).max(300).default(24),
  paddingY: finiteNumberSchema.min(0).max(300).default(12),
  shadowBlur: finiteNumberSchema.min(0).max(100).default(12),
  shadowColor: hexColorSchema.default("#000000"),
  shadowOpacity: finiteNumberSchema.min(0).max(1).default(0.65),
  strokeColor: hexColorSchema.default("#000000"),
  strokeWidth: finiteNumberSchema.min(0).max(20).default(0),
  textOpacity: finiteNumberSchema.min(0).max(1).default(1),
  verticalAlign: z.enum(COMPOSITION_TEXT_VERTICAL_ALIGNMENTS).default("MIDDLE"),
}).strict();

export const compositionTextLayerStylePatchSchema = compositionTextLayerStyleSchema
  .omit({ fontAssetId: true })
  .partial()
  .extend({ fontAssetId: z.string().uuid().nullable().optional() })
  .refine((style) => Object.keys(style).length > 0, "Debes indicar al menos una propiedad de texto.");

export const compositionNativeTextSourceSchema = z.object({
  style: compositionTextLayerStyleSchema,
  text: z.string().min(1).max(4_000),
  type: z.literal("NATIVE_TEXT"),
}).strict();

export const compositionCaptionCueSchema = z.object({
  endSeconds: finiteNumberSchema.positive().max(86_400),
  id: z.string().regex(/^[a-z][a-z0-9-]{0,127}$/i),
  startSeconds: finiteNumberSchema.min(0).max(86_400),
  text: z.string().trim().min(1).max(1_000),
  words: z.array(z.object({
    endSeconds: finiteNumberSchema.positive().max(86_400),
    id: z.string().regex(/^[a-z][a-z0-9-]{0,127}$/i),
    startSeconds: finiteNumberSchema.min(0).max(86_400),
    text: z.string().trim().min(1).max(200),
  }).strict()).max(20).optional(),
}).strict().superRefine((cue, context) => {
  if (cue.endSeconds <= cue.startSeconds) {
    context.addIssue({ code: "custom", message: "El final de cada caption debe ser posterior a su inicio." });
  }
  const words = cue.words || [];
  const seenWordIds = new Set<string>();
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (seenWordIds.has(word.id)) {
      context.addIssue({ code: "custom", message: `La palabra ${word.id} está duplicada dentro del caption.` });
    }
    seenWordIds.add(word.id);
    if (word.startSeconds < cue.startSeconds || word.endSeconds > cue.endSeconds || word.endSeconds <= word.startSeconds) {
      context.addIssue({ code: "custom", message: `La palabra ${word.id} está fuera de los límites del caption.` });
    }
    const previous = words[index - 1];
    if (previous && word.startSeconds < previous.endSeconds) {
      context.addIssue({ code: "custom", message: "Las palabras de un caption no pueden solaparse." });
    }
  }
});

export const compositionNativeCaptionSourceSchema = z.object({
  cues: z.array(compositionCaptionCueSchema).min(1).max(2_000),
  language: z.string().trim().min(2).max(35).optional(),
  origin: z.enum(["MANUAL", "SRT", "TRANSCRIPT", "VTT"]).default("MANUAL"),
  style: compositionTextLayerStyleSchema,
  type: z.literal("NATIVE_CAPTIONS"),
}).strict().superRefine((source, context) => {
  const ids = new Set<string>();
  const ordered = [...source.cues].sort((left, right) => left.startSeconds - right.startSeconds);
  for (let index = 0; index < ordered.length; index += 1) {
    const cue = ordered[index]!;
    if (ids.has(cue.id)) {
      context.addIssue({ code: "custom", message: `El caption ${cue.id} está duplicado.` });
    }
    ids.add(cue.id);
    const previous = ordered[index - 1];
    if (previous && cue.startSeconds < previous.endSeconds) {
      context.addIssue({ code: "custom", message: "Los captions de una misma capa no pueden solaparse." });
    }
  }
});

export type CompositionCaptionCue = z.infer<typeof compositionCaptionCueSchema>;
export type CompositionTextLayerStyle = z.infer<typeof compositionTextLayerStyleSchema>;

export const DEFAULT_NATIVE_TEXT_STYLE: CompositionTextLayerStyle = compositionTextLayerStyleSchema.parse({
  backgroundOpacity: 0,
  fontSize: 72,
  fontWeight: 700,
});

/** Transparent caption preset: contrast comes from stroke/shadow, not an opaque box. */
export const DEFAULT_TRANSPARENT_CAPTION_STYLE: CompositionTextLayerStyle = compositionTextLayerStyleSchema.parse({
  backgroundOpacity: 0,
  borderRadius: 18,
  fontSize: 58,
  fontWeight: 800,
  paddingX: 28,
  paddingY: 14,
  shadowBlur: 16,
  shadowOpacity: 0.8,
  strokeWidth: 2,
});
