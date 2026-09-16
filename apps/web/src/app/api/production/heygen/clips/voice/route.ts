import {
  canReviewContent,
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  getHeygenClientForOrganization,
  HeygenCredentialResolverError,
} from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import {
  HeygenScenesService,
  HeygenScenesServiceError,
} from "@/domains/production/providers/heygen/heygen-scenes.service";
import { heygenGenerateSceneVoiceRequestSchema } from "@/domains/production/providers/heygen/heygen.validators";
import { HeygenApiError } from "@/domains/production/providers/heygen/heygen.client";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest, type ApiErrorCode } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_HEYGEN_VOICE_CLIP_REQUEST_BYTES = 16 * 1024;

/** Generates or reuses independent voice tracks for persisted scene clips. */
export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.clips.voice", { correlationId: requestId });
  try {
    const parsedRequest = await parseJsonRequest(request, heygenGenerateSceneVoiceRequestSchema, MAX_HEYGEN_VOICE_CLIP_REQUEST_BYTES);
    if (!parsedRequest.success) {
      return apiErrorResponse({
        code: parsedRequest.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsedRequest.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Payload inválido para generar voces por escena.",
        requestId,
        status: parsedRequest.reason === "too_large" ? 413 : 400,
      });
    }
    const payload = parsedRequest.data;
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    if (!(await canReviewContent(user.userId))) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para generar voces por escena.", requestId, status: 403 });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 });

    const authorized = await getAuthorizedMaterialComponentAdmin(payload.componentId);
    if (!authorized) {
      return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Componente no encontrado para esta empresa.", requestId, status: 404 });
    }
    const auth = await getHeygenClientForOrganization({
      allowGlobalFallback: false,
      organizationId: tenant.organizationId,
      supabase: authorized.admin,
    });
    const service = new HeygenScenesService(authorized.admin, auth.client);
    const data = await service.generateSceneVoiceClips({
      clipIds: payload.clipIds,
      componentId: payload.componentId,
      createdBy: user.userId,
      organizationId: tenant.organizationId,
    });

    return apiSuccessResponse({ data }, { requestId });
  } catch (error: unknown) {
    if (error instanceof HeygenScenesServiceError) {
      return apiErrorResponse({ code: mapServiceStatus(error.status), message: error.message, requestId, retryable: error.status === 429 || error.status >= 500, status: error.status });
    }
    if (error instanceof HeygenCredentialResolverError) {
      return apiErrorResponse({ code: error.status === 409 ? API_ERROR_CODE.conflict : API_ERROR_CODE.invalidRequest, details: { providerCode: error.code }, message: error.message, requestId, status: error.status });
    }
    if (error instanceof HeygenApiError) {
      const rateLimited = error.status === 429;
      return apiErrorResponse({
        code: rateLimited ? API_ERROR_CODE.rateLimited : API_ERROR_CODE.providerError,
        details: { providerCode: error.providerCode || null },
        headers: error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined,
        message: rateLimited ? "HeyGen alcanzó temporalmente su límite de solicitudes." : "HeyGen no pudo generar las voces por escena.",
        requestId,
        retryable: rateLimited || error.status >= 500,
        status: rateLimited ? 429 : 502,
      });
    }

    logger.error("production.heygen.clips.voice_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "Error interno al generar las voces por escena.", requestId, retryable: true, status: 500 });
  }
}

function mapServiceStatus(status: number): ApiErrorCode {
  if (status === 403) return API_ERROR_CODE.tenantForbidden;
  if (status === 404) return API_ERROR_CODE.resourceNotFound;
  if (status === 409) return API_ERROR_CODE.conflict;
  if (status === 429) return API_ERROR_CODE.rateLimited;
  if (status >= 500) return API_ERROR_CODE.internalError;
  return API_ERROR_CODE.invalidRequest;
}
