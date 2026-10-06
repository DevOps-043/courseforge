import { z } from "zod";
import { HTML_EDITING_LIMITS } from "./html-editing.contract";

export const HTML_EDITABLE_COMPOSITION_DOCUMENT_FORMAT = "courseforge-composition-v4";
const stableId = z.string().min(1).max(96).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const htmlEditingReferenceSchema = z.object({
  clipId: stableId, revisionVersion: z.number().int().min(1).max(1_000_000), revisionSha256: sha256,
  templateId: stableId, templateVersion: z.number().int().min(1).max(1_000_000), sourceSha256: sha256, manifestSha256: sha256,
}).strict();
export const htmlEditingReferencesSchema = z.object({
  format: z.literal("courseforge-html-editable-references-v1"),
  items: z.array(htmlEditingReferenceSchema).min(1).max(HTML_EDITING_LIMITS.elements)
    .refine(items => new Set(items.map(item => item.clipId)).size === items.length),
}).strict();
export type HtmlEditingReference = z.infer<typeof htmlEditingReferenceSchema>;
