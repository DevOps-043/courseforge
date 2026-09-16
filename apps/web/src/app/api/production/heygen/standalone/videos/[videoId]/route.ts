import { z } from "zod";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  HeygenApiError,
} from "@/domains/production/providers/heygen/heygen.client";
import {
  getHeygenClientForOrganization,
  HeygenCredentialResolverError,
} from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import { HEYGEN_VIDEO_STATUSES } from "@/domains/production/providers/heygen/heygen.types";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { heygenCredentialErrorResponse, heygenProviderErrorResponse } from "@/lib/server/heygen-route-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

interface RouteContext {
  params: Promise<{ videoId: string }>;
}

const videoIdSchema = z.string().trim().min(1).max(200);

export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.standalone.video", { correlationId: requestId });
  try {
    const { videoId: rawVideoId } = await context.params;
    const videoId = videoIdSchema.parse(rawVideoId);
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    }

    const canReview = await canReviewContent(authenticatedUser.userId);
    if (!canReview) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para consultar videos de HeyGen.", requestId, status: 403 });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no valida o no autorizada.", requestId, status: 403 });
    }

    const heygenAuth = await getHeygenClientForOrganization({
      allowGlobalFallback: false,
      organizationId: tenant.organizationId,
      supabase: getServiceRoleClient(),
    });
    const video = await heygenAuth.client.getVideo(videoId);
    const providerStatus = video.status.toLowerCase();
    const isCompleted = providerStatus === HEYGEN_VIDEO_STATUSES.COMPLETED;
    const isFailed = providerStatus === HEYGEN_VIDEO_STATUSES.FAILED;

    return apiSuccessResponse({
      data: {
        asset:
          isCompleted && video.videoUrl
            ? {
                id: video.videoId,
                publicUrl: video.videoUrl,
                storagePath: `heygen://${video.videoId}`,
              }
            : null,
        jobId: video.videoId,
        providerJobId: video.videoId,
        providerStatus: video.status,
        standalone: true,
        status: isCompleted
          ? "SUCCEEDED"
          : isFailed
            ? "FAILED"
            : "WAITING_PROVIDER",
      },
    }, { requestId });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Video ID invalido para consultar HeyGen.", requestId, status: 400 });
    }

    if (error instanceof HeygenApiError) {
      return heygenProviderErrorResponse({ error, failureMessage: "No se pudo consultar el video standalone en HeyGen.", requestId });
    }

    if (error instanceof HeygenCredentialResolverError) {
      return heygenCredentialErrorResponse(error, requestId);
    }

    logger.error("production.heygen.standalone.video_read_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "Error interno del servidor al consultar HeyGen standalone.", requestId, retryable: true, status: 500 });
  }
}
