import { z } from "zod";
import { proposeCompositionEdits, CompositionAgentProposalError, compositionAgentProposalInputSchema } from "@/domains/production/composition-editor/composition-agent.service";
import { getCurrentCompositionDocument } from "@/domains/production/composition-editor/composition-document.service";
import { persistCompositionAgentProposal, CompositionAgentProposalStoreError } from "@/domains/production/composition-editor/composition-agent-proposal-store.service";
import { authorizeCompositionAgentRequest, compositionAgentStoreErrorResponse } from "./_route-support";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_COMPOSITION_AGENT_PROPOSAL_REQUEST_BYTES = 8 * 1024;

interface RouteContext { params: Promise<{ draftId: string }>; }

/** Produces an unpersisted, allow-listed proposal for the currently saved document version. */
export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.agent_proposals", { correlationId: requestId });
  try {
    const authorization = await authorizeCompositionAgentRequest(requestId);
    if (authorization.response) return authorization.response;
    const draftId = z.string().uuid().parse((await context.params).draftId);
    const current = await getCurrentCompositionDocument({ draftId, organizationId: authorization.organizationId, supabase: authorization.admin });
    const parsed = await parseJsonRequest(request, compositionAgentProposalInputSchema, MAX_COMPOSITION_AGENT_PROPOSAL_REQUEST_BYTES);
    if (!parsed.success) return apiErrorResponse({ code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, message: parsed.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "La solicitud de asistencia no es válida.", requestId, status: parsed.reason === "too_large" ? 413 : 400 });
    const proposal = await proposeCompositionEdits({
      baseDocumentHash: current.documentHash,
      document: current.document,
      input: parsed.data,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    const { model, recovery, ...envelope } = proposal;
    const persisted = await persistCompositionAgentProposal({
      draftId,
      envelope,
      model,
      organizationId: authorization.organizationId,
      recovery,
      supabase: authorization.admin,
      userId: authorization.userId,
    });
    return apiSuccessResponse({ data: { ...envelope, ...persisted, model, recovery, documentHash: current.documentHash } }, { requestId });
  } catch (error) {
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "La solicitud de asistencia no es válida.", requestId, status: 400 });
    if (error instanceof CompositionAgentProposalError) return apiErrorResponse({ code: error.status === 409 ? API_ERROR_CODE.conflict : error.status === 503 ? API_ERROR_CODE.dependencyUnavailable : API_ERROR_CODE.invalidRequest, details: { reason: error.code }, message: error.message, requestId, retryable: error.retryable, status: error.status });
    if (error instanceof CompositionAgentProposalStoreError) return compositionAgentStoreErrorResponse(error, requestId);
    logger.error("production.hyperframes.agent_proposal_create_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo preparar la propuesta de edición.", requestId, retryable: true, status: 500 });
  }
}
