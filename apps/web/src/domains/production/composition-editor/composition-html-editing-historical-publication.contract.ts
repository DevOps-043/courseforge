import { z } from "zod";
import { HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES } from "../hyperframes/hyperframes.types";
import { HTML_SNAPSHOT_REPUBLICATION_REQUIRED_REVIEWS } from "./composition-html-editing-snapshot-republication-review.contract";

export const HTML_HISTORICAL_PUBLICATION_POLICY = Object.freeze({
  candidateBytes: 16 * 1024 * 1024, receiptBytes: 4096, rpcTimeoutMs: 15_000, stagingTimeoutMs: 120_000,
  provenancePath: "historical-html-republication.json",
  preparationTimeoutMs: 120_000, maximumConcurrentPreparations: 1,
});
export const HTML_HISTORICAL_PUBLICATION_MODE = "HISTORICAL_REVISION_WITHOUT_ACTIVATION_OR_DRAFT_CHANGE" as const;
const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const htmlHistoricalPublicationScopeSchema = z.object({ organizationId: uuid, compositionId: uuid, draftId: uuid }).strict();
export const htmlHistoricalPublicationProvenanceSchema = htmlHistoricalPublicationScopeSchema.extend({
  candidateId: uuid, originalRevisionId: uuid, originalProjectHash: hash, originalBundleSha256: hash,
  documentId: uuid, documentHash: hash, candidateBundleSha256: hash,
  publicationMode: z.literal(HTML_HISTORICAL_PUBLICATION_MODE),
}).strict();
export const htmlHistoricalPublicationApprovalSchema = z.object({ reviewerId: uuid,
  evidenceSha256: hash, reviewedProjectHash: hash,
  completedReviews: z.tuple([z.literal(HTML_SNAPSHOT_REPUBLICATION_REQUIRED_REVIEWS[0]),
    z.literal(HTML_SNAPSHOT_REPUBLICATION_REQUIRED_REVIEWS[1]), z.literal(HTML_SNAPSHOT_REPUBLICATION_REQUIRED_REVIEWS[2])]),
}).strict();
export const htmlHistoricalPublicationArchiveSchema = z.object({ projectHash: hash,
  sizeBytes: z.number().int().positive().max(HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES),
  storageBucket: z.literal("production-assets"), storagePath: z.string().max(1024),
}).strict();
export const htmlHistoricalPublicationRequestSchema = z.object({ candidateId: uuid, candidateSha256: hash }).strict();
/** Persist before the first Storage/DB write. Contains no executable source,
 * credentials, archive bytes or claim that staging/publication succeeded. */
export const htmlHistoricalStagingLocatorSchema = htmlHistoricalPublicationScopeSchema.extend({
  scope: z.literal("HISTORICAL_STAGING_LOCATOR_NOT_APPROVAL_OR_PUBLICATION"),
  reviewerId: uuid, candidateId: uuid, candidateSha256: hash, projectHash: hash,
  evidenceSha256: hash,
}).strict();
export const htmlHistoricalStagingReadSchema = z.discriminatedUnion("status", [
  z.object({status: z.literal("NOT_FOUND")}).strict(),
  z.object({status: z.literal("LOCATOR_RECORDED_STAGING_UNCONFIRMED"), locator: htmlHistoricalStagingLocatorSchema,
    scope: z.literal("HISTORICAL_STAGING_METADATA_NOT_COMMIT_AUTHORITY")}).strict(),
  z.object({status: z.literal("RECORDED"), locator: htmlHistoricalStagingLocatorSchema,
    revoked: z.boolean(), scope: z.literal("HISTORICAL_STAGING_METADATA_NOT_COMMIT_AUTHORITY")}).strict(),
]);
export type HtmlHistoricalStagingLocator = z.infer<typeof htmlHistoricalStagingLocatorSchema>;
export const htmlHistoricalStagingJournalAckSchema = z.object({
  locator: htmlHistoricalStagingLocatorSchema, created: z.boolean(),
}).strict();
export type HtmlHistoricalStagingJournalAck = z.infer<typeof htmlHistoricalStagingJournalAckSchema>;
export const htmlHistoricalPublicationCommandSchema = htmlHistoricalPublicationScopeSchema.extend({
  actorId: uuid, operationId: uuid, request: htmlHistoricalPublicationRequestSchema,
}).strict();
export const htmlHistoricalPublicationReceiptSchema = htmlHistoricalPublicationCommandSchema.extend({
  scope: z.literal("HISTORICAL_PUBLICATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED"),
  requestSha256: hash, originalRevisionId: uuid, originalProjectHash: hash, projectHash: hash,
  revisionId: uuid, revisionNumber: z.number().int().positive(),
  activeRevisionIdAtCommit: uuid.nullable(), currentDraftHashAtCommit: hash.nullable(),
  activated: z.literal(false), draftChanged: z.literal(false),
}).strict().refine(receipt => receipt.revisionId !== receipt.originalRevisionId
  && receipt.projectHash !== receipt.originalProjectHash && receipt.revisionId !== receipt.activeRevisionIdAtCommit);
export const htmlHistoricalPublicationReadSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("NOT_FOUND") }).strict(),
  z.object({ status: z.literal("RECORDED"), receipt: htmlHistoricalPublicationReceiptSchema }).strict(),
]);
export type HtmlHistoricalPublicationCommand = z.infer<typeof htmlHistoricalPublicationCommandSchema>;
export type HtmlHistoricalPublicationReceipt = z.infer<typeof htmlHistoricalPublicationReceiptSchema>;
export type HtmlHistoricalPublicationProvenance = z.infer<typeof htmlHistoricalPublicationProvenanceSchema>;
