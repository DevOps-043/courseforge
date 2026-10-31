import { z } from "zod";

export const COMPOSITION_REFERENCE_GUIDE_LIMIT = 32;
export const COMPOSITION_REFERENCE_GUIDE_COLOR = "#22d3ee";
export const compositionReferenceGuideSchema = z.object({
  id: z.string().uuid(),
  axis: z.enum(["x", "y"]),
  ratio: z.number().finite().min(0).max(1),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
}).strict();
export const compositionReferenceGuidesSchema = z.object({
  visible: z.boolean(),
  guides: z.array(compositionReferenceGuideSchema).max(COMPOSITION_REFERENCE_GUIDE_LIMIT),
}).strict().refine(state => new Set(state.guides.map(guide => guide.id)).size === state.guides.length);
export type CompositionReferenceGuide = z.infer<typeof compositionReferenceGuideSchema>;
export type CompositionReferenceGuides = z.infer<typeof compositionReferenceGuidesSchema>;

export function compositionReferenceGuidesStorageKey(draftId: string) {
  return `courseforge:reference-guides:v1:${draftId}`;
}

export function readCompositionReferenceGuides(storage: Pick<Storage, "getItem">, draftId: string): CompositionReferenceGuides {
  const serialized = storage.getItem(compositionReferenceGuidesStorageKey(draftId));
  if (!serialized) return { visible: true, guides: [] };
  if (serialized.length > 8_192) throw new Error("Las guías locales exceden el límite permitido.");
  return compositionReferenceGuidesSchema.parse(JSON.parse(serialized));
}

export function writeCompositionReferenceGuides(storage: Pick<Storage, "setItem">, draftId: string, state: CompositionReferenceGuides) {
  storage.setItem(compositionReferenceGuidesStorageKey(draftId), JSON.stringify(compositionReferenceGuidesSchema.parse(state)));
}
