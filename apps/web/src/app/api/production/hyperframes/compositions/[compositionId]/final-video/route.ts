import { z } from "zod";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import {
  resolveActiveTenantContext,
  TenantContextLookupError,
} from "@/lib/server/tenant-context";
import {
  HyperframesFinalVideoDeletionError,
  HyperframesFinalVideoDeletionService,
} from "@/domains/production/hyperframes/hyperframes-final-video-deletion.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

interface RouteContext {
  params: Promise<{ compositionId: string }>;
}

const deleteRequestSchema = z.object({
  assetId: z.string().uuid(),
}).strict();
const MAX_FINAL_VIDEO_DELETE_REQUEST_BYTES = 4 * 1024;

/** Deletes only the current imported final video for this composition's lesson. */
export async function DELETE(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.final_video", { correlationId: requestId });
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    }
    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 });
    }
    if (!(await canReviewContent(user.userId, tenant))) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para eliminar videos finales.", requestId, status: 403 });
    }

    const compositionId = z.string().uuid().parse((await context.params).compositionId);
    const parsed = await parseJsonRequest(request, deleteRequestSchema, MAX_FINAL_VIDEO_DELETE_REQUEST_BYTES);
    if (!parsed.success) {
      return apiErrorResponse({
        code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsed.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "La solicitud para eliminar el video no es válida.",
        requestId,
        status: parsed.reason === "too_large" ? 413 : 400,
      });
    }
    const { assetId } = parsed.data;
    const result = await new HyperframesFinalVideoDeletionService(
      getServiceRoleClient(),
    ).deleteLatestForComposition({
      compositionId,
      expectedAssetId: assetId,
      organizationId: tenant.organizationId,
    });

    return apiSuccessResponse({ data: result }, { requestId });
  } catch (error: unknown) {
    if (error instanceof TenantContextLookupError) {
      return apiErrorResponse({ code: API_ERROR_CODE.dependencyUnavailable, details: { reason: error.code }, message: error.message, requestId, retryable: true, status: 503 });
    }
    if (error instanceof z.ZodError) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "La solicitud para eliminar el video no es válida.", requestId, status: 400 });
    }
    if (error instanceof HyperframesFinalVideoDeletionError) {
      return apiErrorResponse({
        code: error.status === 404 ? API_ERROR_CODE.resourceNotFound : error.status === 409 ? API_ERROR_CODE.conflict : error.status >= 500 ? API_ERROR_CODE.internalError : API_ERROR_CODE.invalidRequest,
        details: { reason: error.code },
        message: error.message,
        requestId,
        status: error.status,
      });
    }
    logger.error("production.hyperframes.final_video_delete_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo eliminar el video final de esta lección.", requestId, retryable: true, status: 500 });
  }
}
