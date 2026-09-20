import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  HeygenCatalogSyncIncompleteError,
  HeygenCatalogSyncInProgressError,
} from "@/domains/production/providers/heygen/heygen-catalog.service";
import { runHeygenCatalogBackground } from "@/domains/production/providers/heygen/heygen-catalog-background.service";
import { HeygenApiError } from "@/domains/production/providers/heygen/heygen.client";
import { HeygenRepository } from "@/domains/production/providers/heygen/heygen.repository";
import {
  getHeygenClientForOrganization,
  HeygenCredentialResolverError,
} from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import { callBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { signBackgroundPayload } from "@/lib/server/background-payload-signature";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { heygenCredentialErrorResponse, heygenProviderErrorResponse } from "@/lib/server/heygen-route-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.sync", { correlationId: requestId });
  let reservedSync: { organizationId: string; repository: HeygenRepository; syncRunId: string } | null = null;
  try {
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    }

    const canReview = await canReviewContent(authenticatedUser.userId);
    if (!canReview) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para sincronizar HeyGen.", requestId, status: 403 });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no valida o no autorizada.", requestId, status: 403 });
    }

    const admin = getServiceRoleClient();
    await getHeygenClientForOrganization({
      allowGlobalFallback: false,
      organizationId: tenant.organizationId,
      supabase: admin,
    });
    const repository = new HeygenRepository(admin);
    let syncRunId: string;
    try {
      syncRunId = await repository.beginCatalogSync({
        organizationId: tenant.organizationId,
        requestId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new HeygenCatalogSyncInProgressError();
      throw error;
    }
    reservedSync = { organizationId: tenant.organizationId, repository, syncRunId };
    const backgroundRequest = { organizationId: tenant.organizationId, requestId, syncRunId };
    await callBackgroundFunctionJson(
      "heygen-catalog-background",
      signBackgroundPayload(backgroundRequest),
      {
        fallbackError: "No se pudo iniciar la sincronización de HeyGen.",
        localHandlerLoader: async () => ({
          handler: async () => {
            await runHeygenCatalogBackground(backgroundRequest);
            return { statusCode: 200, body: JSON.stringify({ success: true }) };
          },
        }),
      },
    );

    return apiSuccessResponse({
      data: { status: "QUEUED", syncRequestId: requestId },
    }, { requestId, status: 202 });
  } catch (error: unknown) {
    if (reservedSync && !(error instanceof HeygenCatalogSyncIncompleteError)) {
      await reservedSync.repository.markCatalogSyncIncomplete({
        errorMessage: error instanceof Error ? error.message : "No se pudo iniciar el worker de sincronización.",
        organizationId: reservedSync.organizationId,
        status: "FAILED",
        syncRunId: reservedSync.syncRunId,
        syncedAt: new Date().toISOString(),
      }).catch((cleanupError) => logger.error("production.heygen.sync.cleanup_failed", cleanupError));
    }
    if (error instanceof HeygenCatalogSyncIncompleteError || error instanceof HeygenCatalogSyncInProgressError) {
      return apiErrorResponse({
        code: API_ERROR_CODE.conflict,
        message: error.message,
        requestId,
        retryable: true,
        status: 409,
      });
    }
    if (error instanceof HeygenApiError) {
      if (error.status === 401 || error.status === 403) {
        return apiErrorResponse({
          code: API_ERROR_CODE.invalidRequest,
          details: { providerCode: error.providerCode || null },
          message: "La API key de HeyGen requiere permisos avatars:read y voices:read para sincronizar el catálogo.",
          requestId,
          retryable: false,
          status: 400,
        });
      }
      return heygenProviderErrorResponse({ error, failureMessage: "HeyGen no pudo sincronizar el catálogo.", requestId });
    }

    if (error instanceof HeygenCredentialResolverError) {
      return heygenCredentialErrorResponse(error, requestId);
    }

    logger.error("production.heygen.sync.failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "Error interno del servidor al sincronizar HeyGen.", requestId, retryable: true, status: 500 });
  }
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}
