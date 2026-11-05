import { z } from "zod";
import { compositionTextLayerStyleSchema } from "./composition-text-layer.types";
import { googleFontFaceBindingSchema } from "../fonts/google-font-native-face.contract";

export const COMPOSITION_FONT_REFERENCE_LIMIT = 32;
export const compositionFontReferenceSchema = z.object({
  fontAssetId: z.string().uuid(),
  fontFamily: compositionTextLayerStyleSchema.shape.fontFamily.removeDefault(),
  googleFace: googleFontFaceBindingSchema.optional(),
}).strict();
export const compositionDeckFontReferencesSchema = z.array(compositionFontReferenceSchema)
  .min(1).max(COMPOSITION_FONT_REFERENCE_LIMIT)
  .refine(references => new Set(references.map(reference => reference.fontAssetId)).size === references.length,
    "COMPOSITION_FONT_REFERENCE_DUPLICATE");
export type CompositionFontReference = z.infer<typeof compositionFontReferenceSchema>;

