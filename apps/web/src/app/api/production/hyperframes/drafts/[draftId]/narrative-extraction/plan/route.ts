import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext, TenantContextLookupError } from "@/lib/server/tenant-context";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { CompositionDocumentError } from "@/domains/production/composition-editor/composition-document.service";
import { narrativeExtractionQuerySchema, NARRATIVE_EXTRACTION_QUERY_MAX_BYTES, queryNarrativeVoiceExtraction } from "@/domains/production/composition-editor/composition-narrative-extraction-query";
import { createNarrativeExtractionReadRepository } from "@/domains/production/composition-editor/composition-narrative-extraction.repository";
import { NARRATIVE_EXTRACTION_QUERY_TIMEOUT_MS } from "@/domains/production/composition-editor/composition-narrative-extraction-contract";
import { consumeNarrativeExtractionRateLimit } from "@/domains/production/composition-editor/composition-narrative-extraction-rate-limit";

/** POST keeps selections out of URLs. Only the security rate counter changes, never the composition. */
export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.narrative_extraction.plan", { correlationId: requestId });
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const user = await getAuthenticatedUser(await createClient());
    if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401, headers });
    const tenant = await resolveActiveTenantContext();
    if (!tenant) return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no autorizada.", requestId, status: 403, headers });
    if (!(await canReviewContent(user.userId, tenant))) return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para editar videos.", requestId, status: 403, headers });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(NARRATIVE_EXTRACTION_QUERY_TIMEOUT_MS)]);
    const admin = getServiceRoleClient();
    const rateLimit = await consumeNarrativeExtractionRateLimit({ organizationId: tenant.organizationId, userId: user.userId,
      consume: (policy) => admin.rpc("consume_api_rate_limit", policy).abortSignal(signal) });
    if (rateLimit.status === "UNAVAILABLE") {
      logger.warn("production.hyperframes.narrative_extraction.rate_limit_unavailable");
      return apiErrorResponse({ code: API_ERROR_CODE.dependencyUnavailable, message: "No se pudo verificar el límite de consultas.", requestId, retryable: true, status: 503, headers });
    }
    if (rateLimit.status === "LIMITED") return apiErrorResponse({ code: API_ERROR_CODE.rateLimited,
      message: "Demasiadas consultas. Espera antes de volver a intentar.", requestId, retryable: true, status: 429,
      headers: { ...headers, "Retry-After": String(rateLimit.retryAfterSeconds) } });
    const draftId = z.string().uuid().parse((await context.params).draftId);
    const parsed = await parseJsonRequest(request, narrativeExtractionQuerySchema, NARRATIVE_EXTRACTION_QUERY_MAX_BYTES);
    if (!parsed.success) return apiErrorResponse({ code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
      message: "La selección de extracción no es válida.", requestId, status: parsed.reason === "too_large" ? 413 : 400, headers });
    const result = await queryNarrativeVoiceExtraction({ draftId, organizationId: tenant.organizationId,
      selection: parsed.data, repository: createNarrativeExtractionReadRepository(admin, signal) });
    if (!result.ok) {
      const status = result.reason === "DRAFT_NOT_FOUND" ? 404 : result.reason === "STALE_DOCUMENT" ? 409 : 422;
      return apiErrorResponse({ code: status === 404 ? API_ERROR_CODE.resourceNotFound : status === 409 ? API_ERROR_CODE.conflict : API_ERROR_CODE.invalidRequest,
        message: "No se puede preparar la extracción con la selección actual.", details: { reason: result.reason }, requestId,
        retryable: status === 409, status, headers });
    }
    return apiSuccessResponse({ data: result.summary }, { requestId, headers });
  } catch (error) {
    if (error instanceof TenantContextLookupError) return apiErrorResponse({ code: API_ERROR_CODE.dependencyUnavailable, message: "No se pudo verificar la empresa activa.", requestId, retryable: true, status: 503, headers });
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "La solicitud de extracción no es válida.", requestId, status: 400, headers });
    if (error instanceof CompositionDocumentError && error.status === 404) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Documento no disponible.", requestId, status: 404, headers });
    logger.error("production.hyperframes.narrative_extraction.plan_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo consultar la extracción.", requestId, retryable: true, status: 500, headers });
  }
}
