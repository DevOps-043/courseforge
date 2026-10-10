import { z } from "zod";
import { HTML_EDITING_LIMITS, htmlEditingBindingSchema } from "./html-editing/html-editing.contract";
import { HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES } from "../hyperframes/hyperframes.types";
import { htmlReconstructionResourceSelectionSchema } from "./composition-html-editing-reconstruction-resource-selection.contract";

// Includes the new native document + initial revisions as well as the frozen
// bundle. Do not reuse historical staging's smaller metadata-only payload limit.
export const HTML_RECONSTRUCTION_POLICY = Object.freeze({candidateBytes: HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES, receiptBytes: 4096,
  registrationBytes: 16 * 1024 * 1024, preparationTimeoutMs: 120_000, rpcTimeoutMs: 15_000, maximumConcurrentPreparations: 1});
export const HTML_RECONSTRUCTION_REQUIRED_REVIEWS = ["NEW_CONTENT_VISUAL_AND_ACCESSIBILITY",
  "HISTORICAL_DERIVATION_PROVENANCE", "AUTHORIZED_NEW_CONTENT_CREATION"] as const;
export const htmlReconstructionReviewsSchema = z.tuple([z.literal(HTML_RECONSTRUCTION_REQUIRED_REVIEWS[0]),
  z.literal(HTML_RECONSTRUCTION_REQUIRED_REVIEWS[1]), z.literal(HTML_RECONSTRUCTION_REQUIRED_REVIEWS[2])]);
const hash = z.string().regex(/^[a-f0-9]{64}$/), uuid = z.string().uuid();
export const htmlReconstructionOriginSchema = z.object({scope: z.literal("AUTHORIZED_RECONSTRUCTION_ORIGIN_NOT_EXECUTION_OR_APPROVAL"),
  organizationId: uuid, compositionId: uuid, draftId: uuid, revisionId: uuid, documentId: uuid,
  documentHash: hash, projectHash: hash, bundleSha256: hash}).strict();
export const htmlReconstructionTargetSchema = z.object({compositionId: uuid, documentId: uuid, revisionId: uuid,
  resourceSelection: htmlReconstructionResourceSelectionSchema.optional(),
  slides: z.array(z.object({clipId: z.string().regex(/^[a-z][a-z0-9-]{0,127}$/i),
    templateId: htmlEditingBindingSchema.shape.templateId, templateVersion: htmlEditingBindingSchema.shape.templateVersion}).strict())
    .min(1).max(HTML_EDITING_LIMITS.elements),
}).strict();
export const htmlReconstructionHandoffLocatorSchema = z.object({
  scope: z.literal("RECONSTRUCTION_HANDOFF_LOCATOR_NOT_APPROVAL_OR_CREATION"), candidateId: uuid, organizationId: uuid,
  sourceCompositionId: uuid, sourceDraftId: uuid, targetCompositionId: uuid, targetDocumentId: uuid, targetRevisionId: uuid,
  projectHash: hash, metadataSha256: hash,
}).strict();
export type HtmlReconstructionHandoffLocator = z.infer<typeof htmlReconstructionHandoffLocatorSchema>;
export const htmlReconstructionApprovalSchema = z.object({candidateId: uuid, reviewerId: uuid, evidenceSha256: hash,
  reviewedProjectHash: hash, reviewedMetadataSha256: hash, completedReviews: htmlReconstructionReviewsSchema}).strict();

/** Small durable attestation, not the candidate body, a grant or a create intent. */
export const htmlReconstructionReviewRecordSchema = z.object({
  scope: z.literal("RECONSTRUCTION_REVIEW_RECORD_NOT_CREATION_AUTHORITY"),
  locator: htmlReconstructionHandoffLocatorSchema,
  origin: htmlReconstructionOriginSchema,
  approval: htmlReconstructionApprovalSchema,
}).strict().refine(({locator, origin, approval}) =>
  locator.organizationId === origin.organizationId && locator.sourceCompositionId === origin.compositionId
  && locator.sourceDraftId === origin.draftId && locator.targetCompositionId !== origin.compositionId
  && locator.targetDocumentId !== origin.documentId && locator.targetDocumentId !== origin.draftId
  && locator.targetRevisionId !== origin.revisionId && locator.projectHash !== origin.projectHash
  && approval.candidateId === locator.candidateId && approval.reviewedProjectHash === locator.projectHash
  && approval.reviewedMetadataSha256 === locator.metadataSha256,
"Review must identify independent new content and its exact provenance");
export type HtmlReconstructionReviewRecord = z.infer<typeof htmlReconstructionReviewRecordSchema>;
export const htmlReconstructionReviewReadSchema = z.discriminatedUnion("status", [
  z.object({status: z.literal("NOT_FOUND")}).strict(),
  z.object({status: z.literal("RECORDED"), record: htmlReconstructionReviewRecordSchema, revoked: z.boolean()}).strict(),
]);
export const htmlReconstructionReviewAckSchema = z.object({record: htmlReconstructionReviewRecordSchema,
  created: z.boolean(), revoked: z.boolean()}).strict();

export const htmlReconstructionStagingSchema = z.object({
  scope: z.literal("RECONSTRUCTION_STAGING_NOT_CREATION_OR_PUBLICATION"), operationId: uuid,
  review: htmlReconstructionReviewRecordSchema, candidateSha256: hash,
  archiveSizeBytes: z.number().int().positive().max(HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES),
}).strict();
export type HtmlReconstructionStaging = z.infer<typeof htmlReconstructionStagingSchema>;
export const htmlReconstructionStagingAckSchema = z.object({staging: htmlReconstructionStagingSchema, created: z.boolean()}).strict();
export const htmlReconstructionStagingReadSchema = z.discriminatedUnion("status", [
  z.object({status: z.literal("NOT_FOUND")}).strict(),
  z.object({status: z.enum(["CLAIM_RECORDED_CANDIDATE_UNCONFIRMED", "RECORDED"]), staging: htmlReconstructionStagingSchema}).strict(),
]);
export const htmlReconstructionCreationReceiptSchema = z.object({
  scope: z.literal("RECONSTRUCTION_CREATION_RECEIPT_NOT_PUBLICATION_OR_CURRENT_STATE"),
  staging: htmlReconstructionStagingSchema, documentHash: hash, nativeVersion: z.literal(1),
  activated: z.literal(false), originalDraftChanged: z.literal(false), materialComponentId: z.null(),
}).strict();
export const htmlReconstructionCreationReadSchema = z.discriminatedUnion("status", [
  z.object({status: z.literal("NOT_FOUND")}).strict(),
  z.object({status: z.literal("RECORDED"), receipt: htmlReconstructionCreationReceiptSchema}).strict(),
]);
