import { getErrorMessage } from "@/lib/errors";
import { callBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { signBackgroundPayload } from "@/lib/server/background-payload-signature";
import {
  canReviewContent,
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { runHeygenAvatarClipsBackground } from "@/domains/production/providers/heygen/heygen-avatar-background.service";
import { HeygenApiError } from "@/domains/production/providers/heygen/heygen.client";
import {
  HeygenScenesService,
  HeygenScenesServiceError,
} from "@/domains/production/providers/heygen/heygen-scenes.service";
import {
  getHeygenClientForOrganization,
  HeygenCredentialResolverError,
} from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import { heygenGenerateClipsRequestSchema } from "@/domains/production/providers/heygen/heygen.validators";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest, type ApiErrorCode } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_HEYGEN_CLIP_GENERATION_REQUEST_BYTES = 1024 * 1024;

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.clips.generate", { correlationId: requestId });
  try {
    const parsedRequest = await parseJsonRequest(request, heygenGenerateClipsRequestSchema, MAX_HEYGEN_CLIP_GENERATION_REQUEST_BYTES);
    if (!parsedRequest.success) {
      return apiErrorResponse({
        code: parsedRequest.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsedRequest.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Payload invalido para generar clips HeyGen.",
        requestId,
        status: parsedRequest.reason === "too_large" ? 413 : 400,
      });
    }
    const payload = parsedRequest.data;
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    }

    const canReview = await canReviewContent(authenticatedUser.userId);
    if (!canReview) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para generar clips con HeyGen.", requestId, status: 403 });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no valida o no autorizada.", requestId, status: 403 });
    }

    const authorizedComponent = await getAuthorizedMaterialComponentAdmin(payload.componentId);
    if (!authorizedComponent) {
      return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Componente no encontrado para esta empresa.", requestId, status: 404 });
    }

    const heygenAuth = await getHeygenClientForOrganization({
      allowGlobalFallback: false,
      organizationId: tenant.organizationId,
      supabase: authorizedComponent.admin,
    });
    const service = new HeygenScenesService(
      authorizedComponent.admin,
      heygenAuth.client,
    );
    if (payload.generationTarget === "avatar") {
      await service.assertAvatarGenerationPreflight({
        clipIds: payload.clipIds,
        clips: payload.clips,
        componentId: payload.componentId,
        engine: payload.engine,
        speed: payload.speed,
      });
    }
    const queued = await service.queueSceneClips({
      clipIds: payload.clipIds,
      clips: payload.clips,
      componentId: payload.componentId,
      generationTarget: payload.generationTarget,
      organizationId: tenant.organizationId,
    });
    const backgroundRequest = {
      createdBy: authenticatedUser.userId,
      organizationId: tenant.organizationId,
      options: {
        ...payload,
        clips: queued.clips,
        requestOrigin: "admin_heygen_studio" as const,
      },
    };

    try {
      await callBackgroundFunctionJson(
        "heygen-avatar-clips-background",
        signBackgroundPayload(backgroundRequest),
        {
          fallbackError: "No se pudo iniciar el worker de avatares.",
          localHandlerLoader: async () => ({
            handler: async () => {
              await runHeygenAvatarClipsBackground(backgroundRequest);
              return { statusCode: 200, body: JSON.stringify({ success: true }) };
            },
          }),
        },
      );
    } catch (dispatchError) {
      const message = getErrorMessage(
        dispatchError,
        "No se pudo iniciar el worker de avatares.",
      );
      await service.markQueuedSceneClipsFailed({
        clipIds: payload.clipIds,
        componentId: payload.componentId,
        errorMessage: message,
        generationTarget: payload.generationTarget,
      });
      throw new HeygenScenesServiceError(message, 503);
    }

    return apiSuccessResponse(
      {
        data: {
          clips: queued.clips,
          jobs: [],
          submissionStatus: "QUEUED",
          voiceClips: queued.voiceClips,
        },
      },
      { requestId, status: 202 },
    );
  } catch (error: unknown) {
    if (error instanceof HeygenScenesServiceError) {
      return apiErrorResponse({
        code: mapServiceStatus(error.status),
        message: error.message,
        requestId,
        retryable: error.status === 429 || error.status >= 500,
        status: error.status,
      });
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
        message: rateLimited ? "HeyGen alcanzó temporalmente su límite de solicitudes." : "No se pudo verificar la disponibilidad de HeyGen antes de generar.",
        requestId,
        retryable: rateLimited || error.status >= 500,
        status: rateLimited ? 429 : 502,
      });
    }

    logger.error("production.heygen.clips.generate_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "Error interno del servidor al generar clips HeyGen.", requestId, retryable: true, status: 500 });
  }
}

function mapServiceStatus(status: number): ApiErrorCode {
  if (status === 403) return API_ERROR_CODE.tenantForbidden;
  if (status === 404) return API_ERROR_CODE.resourceNotFound;
  if (status === 409) return API_ERROR_CODE.conflict;
  if (status === 429) return API_ERROR_CODE.rateLimited;
  if (status === 503) return API_ERROR_CODE.dependencyUnavailable;
  if (status >= 500) return API_ERROR_CODE.internalError;
  return API_ERROR_CODE.invalidRequest;
}
