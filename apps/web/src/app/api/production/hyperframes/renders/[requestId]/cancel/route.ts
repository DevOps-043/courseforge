import { z } from "zod";
import { HyperframesRenderDiagnosticsService } from "@/domains/production/hyperframes/hyperframes-render-diagnostics.service";
import { resolveAuthorizedRenderContext } from "../../_render-route-support";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.render.cancel", { correlationId: requestId });
  try {
    const renderRequestId = z.string().uuid().parse((await context.params).requestId);
    const auth = await resolveAuthorizedRenderContext(requestId);
    if (auth.response) return auth.response;
    const status = await new HyperframesRenderDiagnosticsService(auth.admin).cancel(auth.organizationId, renderRequestId);
    if (!status) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Render no encontrado.", requestId, status: 404 });
    if (status !== "CANCELLED") return apiErrorResponse({ code: API_ERROR_CODE.conflict, extensions: { status }, message: "El proceso ya terminó. Actualiza su estado.", requestId, status: 409 });
    return apiSuccessResponse({ status, message: "Proceso cancelado en Courseforge. HeyGen puede continuar el cómputo ya aceptado." }, { requestId });
  } catch (error) {
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Identificador inválido.", requestId, status: 400 });
    logger.error("production.hyperframes.render.cancel_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo cancelar el proceso. Actualiza el estado antes de reintentar.", requestId, retryable: true, status: 500 });
  }
}
