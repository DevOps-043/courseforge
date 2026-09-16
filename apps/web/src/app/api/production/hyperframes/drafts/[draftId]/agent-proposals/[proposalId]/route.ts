import { z } from "zod";
import { dismissStoredCompositionAgentProposal, CompositionAgentProposalStoreError } from "@/domains/production/composition-editor/composition-agent-proposal-store.service";
import { authorizeCompositionAgentRequest, compositionAgentStoreErrorResponse } from "../_route-support";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

interface RouteContext { params: Promise<{ draftId: string; proposalId: string }>; }

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.agent_proposals", { correlationId: requestId });
  try {
    const authorization = await authorizeCompositionAgentRequest(requestId);
    if (authorization.response) return authorization.response;
    const routeParams = await context.params;
    await dismissStoredCompositionAgentProposal({
      draftId: z.string().uuid().parse(routeParams.draftId),
      organizationId: authorization.organizationId,
      proposalId: z.string().uuid().parse(routeParams.proposalId),
      supabase: authorization.admin,
    });
    return apiSuccessResponse({}, { headers: { "Cache-Control": "private, no-store" }, requestId });
  } catch (error) {
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Identificador de propuesta inválido.", requestId, status: 400 });
    if (error instanceof CompositionAgentProposalStoreError) return compositionAgentStoreErrorResponse(error, requestId);
    logger.error("production.hyperframes.agent_proposal_dismiss_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo descartar la propuesta.", requestId, retryable: true, status: 500 });
  }
}
