import { z } from "zod";
import { HTML_EDITING_LIMITS, htmlEditableManifestSchema } from "./html-editing/html-editing.contract";
import { htmlLegacyAdoptionCandidateSchema, htmlLegacyAdoptionRequestSchema, htmlLegacyAdoptionScopeSchema } from "./composition-html-editing-legacy-adoption.contract";

export const HTML_LEGACY_REVIEW_POLICY = Object.freeze({ responseBytes: 4 * 1024 * 1024, envelopeBytes: 1024 });
export const htmlLegacyReviewQuerySchema = htmlLegacyAdoptionRequestSchema.pick({ expectedDocumentHash: true });
export const htmlLegacyReviewCommandSchema = htmlLegacyAdoptionScopeSchema.extend({
  actorId: z.string().uuid(), candidateId: z.string().uuid(), expectedDocumentHash: htmlLegacyReviewQuerySchema.shape.expectedDocumentHash,
}).strict();
const source = z.string().max(HTML_EDITING_LIMITS.sourceBytes).refine(value => new TextEncoder().encode(value).byteLength <= HTML_EDITING_LIMITS.sourceBytes);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const field = htmlEditableManifestSchema.shape.elements.element;
export const htmlLegacyReviewViewSchema = htmlLegacyAdoptionScopeSchema.extend({
  scope: z.literal("REVIEWED_HTML_CANDIDATE_NOT_COMMITTED_OR_RENDERED"), actorId: z.string().uuid(),
  request: htmlLegacyAdoptionRequestSchema,
  templateId: htmlLegacyAdoptionCandidateSchema.shape.templateId, templateVersion: htmlLegacyAdoptionCandidateSchema.shape.templateVersion,
  evidenceSha256: sha256, completedReviews: htmlLegacyAdoptionCandidateSchema.shape.approval.shape.completedReviews,
  originalSourceSha256: sha256, candidateSourceSha256: sha256, proposedDocumentHash: sha256,
  originalSource: source, candidateSource: source,
  fields: z.array(z.object({ elementId: field.options[0].shape.elementId, kind: z.enum(["TEXT", "IMAGE", "THEME", "RANGE_TOKEN", "ATTRIBUTE", "VISIBILITY", "SLOTS", "CHART"]),
    label: field.options[0].shape.label }).strict()).min(1).max(HTML_EDITING_LIMITS.elements)
    .refine(fields => new Set(fields.map(item => item.elementId)).size === fields.length),
}).strict().refine(view => view.proposedDocumentHash !== view.request.expectedDocumentHash);
export type HtmlLegacyReviewCommand = z.infer<typeof htmlLegacyReviewCommandSchema>;
export type HtmlLegacyReviewView = z.infer<typeof htmlLegacyReviewViewSchema>;

/** Complete contiguous text delta, not a visual comparison or rendered HTML.
 * Prefix/suffix trimming is linear and bounded by the source contract. */
export function describeHtmlLegacySourceChange(original: string, candidate: string) {
  if (!source.safeParse(original).success || !source.safeParse(candidate).success) throw new Error("HTML_LEGACY_REVIEW_SOURCE_UNAVAILABLE");
  let start = 0, suffix = 0;
  while (start < original.length && start < candidate.length && original[start] === candidate[start]) start++;
  const splitsSurrogate = (value: string, offset: number) => /[\uD800-\uDBFF]/u.test(value[offset - 1] ?? "")
    && /[\uDC00-\uDFFF]/u.test(value[offset] ?? "");
  if (splitsSurrogate(original, start) || splitsSurrogate(candidate, start)) start--;
  while (suffix < original.length - start && suffix < candidate.length - start
    && original[original.length - suffix - 1] === candidate[candidate.length - suffix - 1]) suffix++;
  if (splitsSurrogate(original, original.length - suffix) || splitsSurrogate(candidate, candidate.length - suffix)) suffix--;
  return { unchangedPrefix: original.slice(0, start), removed: original.slice(start, original.length - suffix),
    added: candidate.slice(start, candidate.length - suffix), unchangedSuffix: original.slice(original.length - suffix) };
}
