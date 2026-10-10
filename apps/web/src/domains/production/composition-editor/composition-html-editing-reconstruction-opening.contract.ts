import { z } from "zod";

const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const HTML_RECONSTRUCTION_OPENING_POLICY = Object.freeze({maximumUrlBytes: 2048, timeoutMs: 15_000,
  windowSeconds: 60, organizationRequests: 300, actorRequests: 30, maximumRateResponseBytes: 4096, responseBytes: 4096});
export const htmlReconstructionOpeningRequestSchema = z.object({actorId: uuid, organizationId: uuid, compositionId: uuid, draftId: uuid}).strict();
export type HtmlReconstructionOpeningRequest = z.infer<typeof htmlReconstructionOpeningRequestSchema>;
/** Current authorized metadata, not receipt, document content, approval or a grant.
 * The editor must fetch the current saved document with its normal exact reader. */
export const htmlReconstructionOpeningSchema = z.object({scope: z.literal("AUTHORIZED_RECONSTRUCTION_OPENING_NOT_DOCUMENT_OR_PUBLICATION"),
  organizationId: uuid, compositionId: uuid, draftId: uuid, candidateId: uuid, operationId: uuid,
  seedRevisionId: uuid, seedDocumentHash: hash, currentDocumentHash: hash, currentVersion: z.number().int().positive().max(2_147_483_647),
  materialComponentId: z.null(), activeRevisionId: uuid.nullable(),
}).strict();
export type HtmlReconstructionOpening = z.infer<typeof htmlReconstructionOpeningSchema>;
/** Navigational hint only. The destination reauthorizes current access; a path
 * generated from a receipt is never an edit/publication permission. */
export function buildHtmlReconstructionEditorPath(input: {compositionId: string; draftId: string}) {
  const identity = z.object({compositionId: uuid, draftId: uuid}).strict().parse(input);
  return `/admin/assembly/reconstruction/${identity.draftId}?${new URLSearchParams({compositionId: identity.compositionId})}`;
}
export function matchesHtmlReconstructionOpening(result: HtmlReconstructionOpening, request: HtmlReconstructionOpeningRequest) {
  return result.organizationId === request.organizationId && result.compositionId === request.compositionId && result.draftId === request.draftId;
}
export function htmlReconstructionOpeningEnabled(environment: Record<string, string | undefined>) {
  return environment.COMPOSITION_HTML_RECONSTRUCTION_OPENING_ENABLED === "true"
    && environment.COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED === "true";
}
