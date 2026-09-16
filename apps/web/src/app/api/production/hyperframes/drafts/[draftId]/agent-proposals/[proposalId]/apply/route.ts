import { z } from "zod";
import { applyStoredCompositionAgentProposal, CompositionAgentProposalStoreError } from "@/domains/production/composition-editor/composition-agent-proposal-store.service";
import { authorizeCompositionAgentRequest, compositionAgentStoreErrorResponse } from "../../_route-support";
import { COMPOSITION_VERSION_FALLBACK_HEADER, resolveCompositionDocumentPrecondition } from "@/domains/production/composition-editor/composition-document-version";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_COMPOSITION_AGENT_APPLY_REQUEST_BYTES = 4 * 1024;

interface RouteContext { params: Promise<{ draftId: string; proposalId: string }>; }

const applyRequestSchema = z.object({ reinforcedConfirmation: z.boolean().default(false) }).strict();

export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.agent_proposals", { correlationId: requestId });
  try {
    const authorization = await authorizeCompositionAgentRequest(requestId);
    if (authorization.response) return authorization.response;
    const routeParams = await context.params;
    const precondition = resolveCompositionDocumentPrecondition({
      fallbackHeader: request.headers.get(COMPOSITION_VERSION_FALLBACK_HEADER),
      ifMatchHeader: request.headers.get("if-match"),
    });
    if (!precondition.ok) {
      return apiErrorResponse({ code: API_ERROR_CODE.conflict, headers: { "Cache-Control": "private, no-store" }, message: "Falta una versión base válida y consistente para la propuesta.", requestId, retryable: true, status: 428 });
    }
    const parsed = await parseJsonRequest(request, applyRequestSchema, MAX_COMPOSITION_AGENT_APPLY_REQUEST_BYTES);
    if (!parsed.success) return apiErrorResponse({ code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, message: parsed.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "La confirmación no es válida.", requestId, status: parsed.reason === "too_large" ? 413 : 400 });
    const body = parsed.data;
    const data = await applyStoredCompositionAgentProposal({
      draftId: z.string().uuid().parse(routeParams.draftId),
      expectedDocumentHash: precondition.documentHash,
      organizationId: authorization.organizationId,
      proposalId: z.string().uuid().parse(routeParams.proposalId),
      reinforcedConfirmation: body.reinforcedConfirmation,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      supabase: authorization.admin,
      userId: authorization.userId,
    });
    return apiSuccessResponse({ data }, { headers: { "Cache-Control": "private, no-store", ETag: `"${data.documentHash}"` }, requestId });
  } catch (error) {
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "La confirmación no es válida.", requestId, status: 400 });
    if (error instanceof CompositionAgentProposalStoreError) return compositionAgentStoreErrorResponse(error, requestId);
    logger.error("production.hyperframes.agent_proposal_apply_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo aplicar la propuesta.", requestId, retryable: true, status: 500 });
  }
}
