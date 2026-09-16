import { z } from "zod";
import { HyperframesRenderDiagnosticsService } from "@/domains/production/hyperframes/hyperframes-render-diagnostics.service";
import { resolveAuthorizedRenderContext } from "../../_render-route-support";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.render.diagnostics", { correlationId: requestId });
  try {
    const renderRequestId = z.string().uuid().parse((await context.params).requestId);
    const auth = await resolveAuthorizedRenderContext(requestId);
    if (auth.response) return auth.response;
    const data = await new HyperframesRenderDiagnosticsService(auth.admin).read(auth.organizationId, renderRequestId);
    if (!data) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, headers: { "Cache-Control": "private, no-store" }, message: "Render no encontrado.", requestId, status: 404 });
    return apiSuccessResponse({ data }, { headers: { "Cache-Control": "private, no-store" }, requestId });
  } catch (error) {
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Identificador inválido.", requestId, status: 400 });
    logger.error("production.hyperframes.render.diagnostics_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo leer el diagnóstico del render. Comprueba la conexión y la migración de diagnósticos.", requestId, retryable: true, status: 500 });
  }
}
