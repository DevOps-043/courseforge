import { z } from "zod";
import type { CompositionEditorDocument } from "./composition-document.types";
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

/** Native resource dependencies, not URLs, permissions or evidence of glyph use. */
export function compositionFontReferenceDetails(document: CompositionEditorDocument): Map<string, CompositionFontReference> {
  const references = new Map<string, CompositionFontReference>();
  for (const clip of document.clips) {
    const source = clip.source;
    const declared = source.type === "DECK_SLIDE" ? source.fontBindings ?? []
      : (source.type === "NATIVE_TEXT" || source.type === "NATIVE_CAPTIONS") && source.style.fontAssetId
        ? [{ fontAssetId: source.style.fontAssetId, fontFamily: source.style.fontFamily }] : [];
    for (const reference of declared) {
      const parsed = compositionFontReferenceSchema.parse(reference);
      const { fontAssetId } = parsed;
      const previous = references.get(fontAssetId);
      if (previous && JSON.stringify(previous) !== JSON.stringify(parsed)) throw new Error("COMPOSITION_FONT_REFERENCE_FAMILY_CONFLICT");
      references.set(fontAssetId, parsed);
      if (references.size > COMPOSITION_FONT_REFERENCE_LIMIT) throw new Error("COMPOSITION_FONT_REFERENCE_LIMIT");
    }
  }
  return references;
}
export function compositionFontReferences(document: CompositionEditorDocument): Map<string, string> {
  return new Map([...compositionFontReferenceDetails(document)].map(([id, reference]) => [id, reference.fontFamily]));
}
