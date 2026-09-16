import { callBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { signBackgroundPayload } from "@/lib/server/background-payload-signature";
import {
  canReviewContent,
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { HeygenApiError } from "@/domains/production/providers/heygen/heygen.client";
import { runHeygenAvatarVideoBackground } from "@/domains/production/providers/heygen/heygen-video-background.service";
import {
  getHeygenClientForOrganization,
  HeygenCredentialResolverError,
} from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import {
  buildResolutionRejectionHint,
  HeygenRequestValidationError,
} from "@/domains/production/providers/heygen/heygen-request-constraints";
import { heygenGenerateVideoRequestSchema } from "@/domains/production/providers/heygen/heygen.validators";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { heygenCredentialErrorResponse, heygenProviderErrorResponse, heygenServiceErrorResponse } from "@/lib/server/heygen-route-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_HEYGEN_VIDEO_REQUEST_BYTES = 128 * 1024;

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.videos", { correlationId: requestId });
  let requestedResolution: "720p" | "1080p" | "4k" = "1080p";
  try {
    const parsedRequest = await parseJsonRequest(request, heygenGenerateVideoRequestSchema, MAX_HEYGEN_VIDEO_REQUEST_BYTES);
    if (!parsedRequest.success) {
      return apiErrorResponse({
        code: parsedRequest.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsedRequest.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Payload invalido para generar video HeyGen.",
        requestId,
        status: parsedRequest.reason === "too_large" ? 413 : 400,
      });
    }
    const payload = parsedRequest.data;
    requestedResolution = payload.resolution;
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    }

    const canReview = await canReviewContent(authenticatedUser.userId);
    if (!canReview) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para generar videos con HeyGen.", requestId, status: 403 });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no valida o no autorizada.", requestId, status: 403 });
    }

    const authorizedComponent = await getAuthorizedMaterialComponentAdmin(
      payload.componentId,
    );
    if (!authorizedComponent) {
      return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Componente no encontrado para esta empresa.", requestId, status: 404 });
    }

    await getHeygenClientForOrganization({
      allowGlobalFallback: false,
      organizationId: tenant.organizationId,
      supabase: authorizedComponent.admin,
    });
    const backgroundRequest = {
      createdBy: authenticatedUser.userId,
      organizationId: tenant.organizationId,
      options: payload,
    };

    await callBackgroundFunctionJson(
      "heygen-avatar-video-background",
      signBackgroundPayload(backgroundRequest),
      {
        fallbackError: "No se pudo iniciar el worker de avatar.",
        localHandlerLoader: async () => ({
          handler: async () => {
            await runHeygenAvatarVideoBackground(backgroundRequest);
            return { statusCode: 200, body: JSON.stringify({ success: true }) };
          },
        }),
      },
    );

    return apiSuccessResponse(
      {
        data: {
          componentId: payload.componentId,
          providerJobId: null,
          status: "QUEUED",
          submissionStatus: "QUEUED",
        },
      },
      { requestId, status: 202 },
    );
  } catch (error: unknown) {
    if (error instanceof HeygenRequestValidationError) {
      return heygenServiceErrorResponse(error, requestId);
    }

    if (error instanceof HeygenApiError) {
      return heygenProviderErrorResponse({
        error,
        failureMessage: "HeyGen no pudo generar el video solicitado.",
        hint: buildResolutionRejectionHint(requestedResolution, error),
        requestId,
      });
    }

    if (error instanceof HeygenCredentialResolverError) {
      return heygenCredentialErrorResponse(error, requestId);
    }

    logger.error("production.heygen.videos.generate_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "Error interno del servidor al generar video HeyGen.", requestId, retryable: true, status: 500 });
  }
}
