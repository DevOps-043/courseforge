import { z } from "zod";
import {
  canReviewContent,
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { HeygenApiError } from "@/domains/production/providers/heygen/heygen.client";
import {
  HeygenScenesService,
  HeygenScenesServiceError,
} from "@/domains/production/providers/heygen/heygen-scenes.service";
import {
  getHeygenClientForOrganization,
  HeygenCredentialResolverError,
} from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, type ApiErrorCode } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const componentIdSchema = z.string().uuid();

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.clips.status", { correlationId: requestId });
  try {
    const componentId = componentIdSchema.parse(
      new URL(request.url).searchParams.get("componentId"),
    );
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    }

    const canReview = await canReviewContent(authenticatedUser.userId);
    if (!canReview) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para consultar clips de HeyGen.", requestId, status: 403 });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no valida o no autorizada.", requestId, status: 403 });
    }

    const authorizedComponent = await getAuthorizedMaterialComponentAdmin(componentId);
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
    const result = await service.refreshSceneClipStatuses({
      componentId,
      createdBy: authenticatedUser.userId,
      organizationId: tenant.organizationId,
    });

    return apiSuccessResponse({ data: result }, { requestId });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Component ID invalido para consultar clips HeyGen.", requestId, status: 400 });
    }

    if (error instanceof HeygenScenesServiceError) {
      return apiErrorResponse({ code: mapServiceStatus(error.status), message: error.message, requestId, retryable: error.status === 429 || error.status >= 500, status: error.status });
    }

    if (error instanceof HeygenApiError) {
      const rateLimited = error.status === 429;
      return apiErrorResponse({
        code: rateLimited ? API_ERROR_CODE.rateLimited : API_ERROR_CODE.providerError,
        details: { providerCode: error.providerCode || null },
        headers: error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined,
        message: rateLimited ? "HeyGen alcanzó temporalmente su límite de solicitudes." : "No se pudo consultar el estado de clips en HeyGen.",
        requestId,
        retryable: rateLimited || error.status >= 500,
        status: rateLimited ? 429 : 502,
      });
    }

    if (error instanceof HeygenCredentialResolverError) {
      return apiErrorResponse({ code: error.status === 409 ? API_ERROR_CODE.conflict : API_ERROR_CODE.invalidRequest, details: { providerCode: error.code }, message: error.message, requestId, status: error.status });
    }

    logger.error("production.heygen.clips.status_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "Error interno del servidor al consultar clips HeyGen.", requestId, retryable: true, status: 500 });
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
