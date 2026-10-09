import { z } from "zod";
import { htmlEditingBindingSchema } from "./html-editing/html-editing.contract";

export const HTML_LEGACY_ADOPTION_POLICY = Object.freeze({
  pilotBytes: 2 * 1024 * 1024, candidateBytes: 4 * 1024 * 1024,
  receiptBytes: 4096, journalBytes: 8192, responseBytes: 16 * 1024 * 1024, rpcTimeoutMs: 15_000,
});
const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const htmlLegacyAdoptionScopeSchema = htmlEditingBindingSchema.pick({ organizationId: true, documentId: true, clipId: true });
export const htmlLegacyAdoptionRequestSchema = z.object({
  candidateId: uuid, provenanceSha256: hash, expectedDocumentHash: hash,
}).strict();
export const htmlLegacyAdoptionCommandSchema = htmlLegacyAdoptionScopeSchema.extend({
  actorId: uuid, operationId: uuid, request: htmlLegacyAdoptionRequestSchema,
}).strict();
export const htmlLegacyAdoptionCandidateSchema = htmlLegacyAdoptionScopeSchema.extend({
  candidateId: uuid, revisionId: uuid, expectedDocumentHash: hash,
  originalSourceSha256: hash, candidateSourceSha256: hash, provenanceSha256: hash,
  templateId: htmlEditingBindingSchema.shape.templateId,
  templateVersion: htmlEditingBindingSchema.shape.templateVersion,
  encodedPilot: z.string().max(HTML_LEGACY_ADOPTION_POLICY.pilotBytes),
  approval: z.object({ reviewerId: uuid, evidenceSha256: hash,
    completedReviews: z.tuple([z.literal("VISUAL_COMPARISON"), z.literal("MANIFEST_AND_ACCESSIBILITY"), z.literal("AUTHORIZED_INSTALLATION")]),
  }).strict(),
}).strict();
export const htmlLegacyAdoptionReceiptSchema = z.object({
  scope: z.literal("HTML_LEGACY_ADOPTION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED"),
  owner: z.object({ actorId: uuid, organizationId: uuid, draftId: uuid }).strict(),
  clipId: htmlEditingBindingSchema.shape.clipId, operationId: uuid, requestSha256: hash,
  request: htmlLegacyAdoptionRequestSchema,
  acknowledgment: z.object({ status: z.literal("CONFIRMED"), compositionDocumentHash: hash,
    compositionDocumentVersion: z.number().int().positive(), revisionVersion: z.literal(1), revisionSha256: hash,
  }).strict(),
}).strict().refine(receipt => receipt.acknowledgment.compositionDocumentHash !== receipt.request.expectedDocumentHash);
export const htmlLegacyAdoptionReadSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("NOT_FOUND") }).strict(),
  z.object({ status: z.literal("RECORDED"), receipt: htmlLegacyAdoptionReceiptSchema }).strict(),
]);
export type HtmlLegacyAdoptionCommand = z.infer<typeof htmlLegacyAdoptionCommandSchema>;
export type HtmlLegacyAdoptionRequest = z.infer<typeof htmlLegacyAdoptionRequestSchema>;
export type HtmlLegacyAdoptionCandidate = z.infer<typeof htmlLegacyAdoptionCandidateSchema>;
export type HtmlLegacyAdoptionReceipt = z.infer<typeof htmlLegacyAdoptionReceiptSchema>;
