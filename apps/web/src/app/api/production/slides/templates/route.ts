import { getSlideTemplatePackagesAction } from "@/domains/production/slides/slide-template-library.actions";
import { authorizationUnavailableResponse } from "@/lib/server/authorization-unavailable-response";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

/** Browser-safe endpoint for the review panel; avoids a Server Action POST from a client-only flow. */
export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.slides.templates", { correlationId: requestId });
  try {
    const result = await getSlideTemplatePackagesAction();
    const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
    if (result.success) {
      return apiSuccessResponse({ slideTemplates: result.slideTemplates || [] }, { headers, requestId });
    }
    if (result.error === "Unauthorized") {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, headers, message: "No autorizado.", requestId, status: 401 });
    }
    if (result.errorCode === API_ERROR_CODE.tenantForbidden) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, headers, message: "Empresa no autorizada.", requestId, status: 403 });
    }
    if (result.errorCode === API_ERROR_CODE.dependencyUnavailable) {
      return apiErrorResponse({ code: API_ERROR_CODE.dependencyUnavailable, headers, message: "No se pudieron verificar temporalmente tus permisos. Intenta de nuevo.", requestId, retryable: true, status: 503 });
    }
    logger.error("production.slides.templates_load_failed", new Error("Slide template library returned an unsuccessful result."));
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, headers, message: "No se pudieron cargar las plantillas de slides.", requestId, retryable: true, status: 500 });
  } catch (error) {
    const unavailable = authorizationUnavailableResponse(error, requestId);
    if (unavailable) return unavailable;
    logger.error("production.slides.templates_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, headers: { "Cache-Control": "private, no-store" }, message: "No se pudieron cargar las plantillas de slides.", requestId, retryable: true, status: 500 });
  }
}
