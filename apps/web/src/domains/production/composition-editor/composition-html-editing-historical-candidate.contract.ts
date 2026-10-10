import { z } from "zod";
import { htmlHistoricalPublicationScopeSchema, htmlHistoricalPublicationRequestSchema,
  htmlHistoricalPublicationProvenanceSchema, htmlHistoricalPublicationApprovalSchema } from "./composition-html-editing-historical-publication.contract";

export const htmlHistoricalCandidateReadRequestSchema = htmlHistoricalPublicationScopeSchema.extend({
  actorId: z.string().uuid(), request: htmlHistoricalPublicationRequestSchema,
}).strict();
export const htmlHistoricalCandidateViewSchema = htmlHistoricalCandidateReadRequestSchema.extend({
  scope: z.literal("AUTHORIZED_HISTORICAL_CANDIDATE_NOT_PUBLISHED_OR_RENDERED"),
  provenance: htmlHistoricalPublicationProvenanceSchema,
  approval: htmlHistoricalPublicationApprovalSchema, projectHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine(view => view.provenance.organizationId === view.organizationId
  && view.provenance.compositionId === view.compositionId && view.provenance.draftId === view.draftId
  && view.provenance.candidateId === view.request.candidateId && view.approval.reviewedProjectHash === view.projectHash
  && view.projectHash !== view.provenance.originalProjectHash);
export type HtmlHistoricalCandidateReadRequest = z.infer<typeof htmlHistoricalCandidateReadRequestSchema>;
export type HtmlHistoricalCandidateView = z.infer<typeof htmlHistoricalCandidateViewSchema>;
export function matchesHistoricalHtmlCandidate(view: HtmlHistoricalCandidateView, request: HtmlHistoricalCandidateReadRequest) {
  return view.actorId === request.actorId && view.organizationId === request.organizationId
    && view.compositionId === request.compositionId && view.draftId === request.draftId
    && view.request.candidateId === request.request.candidateId && view.request.candidateSha256 === request.request.candidateSha256;
}
