import { z } from "zod";
import { htmlSnapshotInspectionReadRequestSchema, type HtmlSnapshotInspectionReadRequest } from "./composition-html-editing-snapshot-inspection.contract";
import { HTML_EDITING_LIMITS } from "./html-editing/html-editing.contract";

export const HTML_SNAPSHOT_REPUBLICATION_REVIEW_POLICY = Object.freeze({ responseBytes: 128 * 1024, timeoutMs: 120_000 });
export const HTML_SNAPSHOT_REPUBLICATION_REQUIRED_REVIEWS = [
  "HISTORICAL_VISUAL_COMPARISON", "CURRENT_CONTENT_AND_ACCESSIBILITY", "AUTHORIZED_REPUBLICATION",
] as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const profile = z.object({ compilerVersion: z.string().min(1).max(96), geometryVersion: z.string().min(1).max(96),
  isolationVersion: z.string().min(1).max(96) }).strict();
const clipId = z.string().min(1).max(96);
export const htmlSnapshotRepublicationReviewSchema = htmlSnapshotInspectionReadRequestSchema.extend({
  scope: z.literal("PREPARED_HISTORICAL_HTML_REVIEW_NOT_APPROVED_OR_PUBLISHED"),
  publicationMode: z.literal("HISTORICAL_REVISION_WITHOUT_ACTIVATION_OR_DRAFT_CHANGE"),
  documentId: z.string().uuid(), documentHash: hash, originalProjectHash: hash, originalBundleSha256: hash,
  originalFormat: z.enum(["courseforge-html-editable-snapshot-bundle-v1", "courseforge-html-editable-snapshot-bundle-v2"]),
  originalCompilationProfile: profile.nullable(), candidateCompilationProfile: profile,
  candidateBundleSha256: hash,
  comparisons: z.array(z.object({ clipId, previousSha256: hash.nullable(), candidateSha256: hash,
    status: z.enum(["NO_PRIOR_OUTPUT_PIN", "OUTPUT_PIN_EQUAL", "OUTPUT_PIN_CHANGED"]),
  }).strict().refine(entry => entry.previousSha256 === null ? entry.status === "NO_PRIOR_OUTPUT_PIN"
    : entry.previousSha256 === entry.candidateSha256 ? entry.status === "OUTPUT_PIN_EQUAL" : entry.status === "OUTPUT_PIN_CHANGED"))
    .min(1).max(HTML_EDITING_LIMITS.elements).refine(entries => new Set(entries.map(entry => entry.clipId)).size === entries.length),
  unmatchedPriorClipIds: z.array(clipId).max(HTML_EDITING_LIMITS.elements).refine(ids => new Set(ids).size === ids.length),
  requiredReviews: z.tuple([z.literal(HTML_SNAPSHOT_REPUBLICATION_REQUIRED_REVIEWS[0]),
    z.literal(HTML_SNAPSHOT_REPUBLICATION_REQUIRED_REVIEWS[1]), z.literal(HTML_SNAPSHOT_REPUBLICATION_REQUIRED_REVIEWS[2])]),
}).strict().refine(review => review.originalFormat === "courseforge-html-editable-snapshot-bundle-v1"
  ? review.originalCompilationProfile === null : review.originalCompilationProfile !== null);
export type HtmlSnapshotRepublicationReview = z.infer<typeof htmlSnapshotRepublicationReviewSchema>;
export function matchesHtmlSnapshotRepublicationReview(review: HtmlSnapshotRepublicationReview, request: HtmlSnapshotInspectionReadRequest) {
  return (Object.keys(request) as Array<keyof HtmlSnapshotInspectionReadRequest>).every(key => review[key] === request[key]);
}
