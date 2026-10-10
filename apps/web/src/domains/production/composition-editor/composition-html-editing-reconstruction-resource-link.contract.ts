import { z } from "zod";
import { htmlReconstructionOpeningRequestSchema, htmlReconstructionOpeningEnabled } from "./composition-html-editing-reconstruction-opening.contract";
import { htmlReconstructionLibraryAssetSchema } from "./composition-html-editing-reconstruction-library.contract";

const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), version = z.number().int().positive().max(2_147_483_647);
export const HTML_RECONSTRUCTION_RESOURCE_LINK_POLICY = Object.freeze({maximumUrlBytes: 2048, maximumRequestBytes: 1024,
  responseBytes: 8192, journalBytes: 8192, timeoutMs: 15_000, bodyTimeoutMs: 5000, windowSeconds: 60,
  organizationRequests: 100, actorRequests: 20, maximumRateResponseBytes: 4096});
export const htmlReconstructionResourceLookupQuerySchema = z.object({compositionId: uuid, assetId: uuid}).strict();
export const htmlReconstructionResourceLookupRequestSchema = z.object({actorId: uuid, organizationId: uuid, draftId: uuid,
  query: htmlReconstructionResourceLookupQuerySchema}).strict();
export type HtmlReconstructionResourceLookupRequest = z.infer<typeof htmlReconstructionResourceLookupRequestSchema>;
export const htmlReconstructionResourceCandidateSchema = z.object({scope: z.literal("CURRENT_TENANT_RESOURCE_CANDIDATE_NOT_LINK_OR_APPROVAL"),
  organizationId: uuid, compositionId: uuid, draftId: uuid, currentDocumentHash: hash, currentVersion: version,
  resourceIdentitySha256: hash, asset: htmlReconstructionLibraryAssetSchema, alreadyLinked: z.boolean(),
}).strict();
export type HtmlReconstructionResourceCandidate = z.infer<typeof htmlReconstructionResourceCandidateSchema>;
export const htmlReconstructionResourceLinkRequestSchema = z.object({assetId: uuid, resourceIdentitySha256: hash,
  expectedDocumentHash: hash, expectedVersion: version, confirmedResourceOnly: z.literal(true)}).strict();
export const htmlReconstructionResourceLinkHttpSchema = htmlReconstructionResourceLinkRequestSchema.extend({compositionId: uuid}).strict();
export const htmlReconstructionResourceLinkCommandSchema = htmlReconstructionOpeningRequestSchema.extend({operationId: uuid,
  request: htmlReconstructionResourceLinkRequestSchema}).strict();
export type HtmlReconstructionResourceLinkCommand = z.infer<typeof htmlReconstructionResourceLinkCommandSchema>;
export const htmlReconstructionResourceLinkReceiptSchema = z.object({scope: z.literal("RESOURCE_LINK_RECEIPT_NOT_CURRENT_GRANT_OR_PUBLICATION"),
  command: htmlReconstructionResourceLinkCommandSchema, requestSha256: hash, resourceLinked: z.boolean(),
  rejectionReason: z.enum(["BASE_CHANGED", "RESOURCE_CHANGED", "LIMIT"]).nullable(),
  nativeDocumentChanged: z.literal(false), originalDraftChanged: z.literal(false)}).strict().refine(
    receipt => receipt.resourceLinked === (receipt.rejectionReason === null), "Resultado de enlace incoherente");
export type HtmlReconstructionResourceLinkReceipt = z.infer<typeof htmlReconstructionResourceLinkReceiptSchema>;
export const htmlReconstructionResourceLinkReadSchema = z.discriminatedUnion("status", [
  z.object({status: z.literal("NOT_FOUND")}).strict(),
  z.object({status: z.literal("RECORDED"), receipt: htmlReconstructionResourceLinkReceiptSchema}).strict(),
]);
export function htmlReconstructionResourceLinkPreimage(input: HtmlReconstructionResourceLinkCommand) {
  const command = htmlReconstructionResourceLinkCommandSchema.parse(input), request = command.request;
  return ["courseforge-html-reconstruction-resource-link-v1", command.organizationId, command.actorId, command.compositionId,
    command.draftId, command.operationId, request.assetId, request.resourceIdentitySha256, request.expectedDocumentHash,
    String(request.expectedVersion), "true"].join("\n");
}
export function matchesHtmlReconstructionResourceLinkReceipt(receipt: HtmlReconstructionResourceLinkReceipt, command: HtmlReconstructionResourceLinkCommand,
  requestSha256: string) {
  return receipt.requestSha256 === requestSha256 && htmlReconstructionResourceLinkPreimage(receipt.command) === htmlReconstructionResourceLinkPreimage(command);
}
export function htmlReconstructionResourceLinkEnabled(environment: Record<string, string | undefined>) {
  return htmlReconstructionOpeningEnabled(environment) && environment.COMPOSITION_HTML_RECONSTRUCTION_RESOURCE_LINK_ENABLED === "true"
    && environment.COMPOSITION_HTML_EDITING_MUTATIONS_ENABLED === "true";
}
