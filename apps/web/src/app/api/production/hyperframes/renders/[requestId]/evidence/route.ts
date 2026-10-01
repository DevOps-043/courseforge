import { z } from "zod";
import { HyperframesRenderEvidenceService } from "@/domains/production/hyperframes/hyperframes-render-evidence.service";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { resolveAuthorizedRenderContext } from "../../_render-route-support";

export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const correlationId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.render.evidence", { correlationId });
  try {
    const renderRequestId = z.string().uuid().parse((await context.params).requestId);
    const authorized = await resolveAuthorizedRenderContext(correlationId);
    if (authorized.response) return authorized.response;
    const evidence = await new HyperframesRenderEvidenceService(authorized.admin).read(authorized.organizationId, renderRequestId);
    if (!evidence) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Render no encontrado.", requestId: correlationId, status: 404 });
    return apiSuccessResponse({ data: evidence }, { headers: { "Cache-Control": "private, no-store" }, requestId: correlationId });
  } catch (error) {
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Identificador inválido.", requestId: correlationId, status: 400 });
    logger.error("production.hyperframes.render.evidence_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo verificar la evidencia del render.", requestId: correlationId, retryable: true, status: 500 });
  }
}
