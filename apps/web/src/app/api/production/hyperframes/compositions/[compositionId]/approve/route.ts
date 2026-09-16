import { z } from "zod";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

interface RouteContext { params: Promise<{ compositionId: string }>; }

/** Approval is the explicit gate between preview and billable cloud rendering. */
export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.composition.approve", { correlationId: requestId });
  try {
    const compositionId = z.string().uuid().parse((await context.params).compositionId);
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    if (!(await canReviewContent(user.userId))) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para aprobar composiciones de video.", requestId, status: 403 });
    }
    const tenant = await resolveActiveTenantContext();
    if (!tenant) return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 });
    const admin = getServiceRoleClient();
    const { data: composition, error: readError } = await admin
      .from("video_compositions")
      .select("id, active_revision_id, status")
      .eq("id", compositionId)
      .eq("organization_id", tenant.organizationId)
      .maybeSingle();
    if (readError) throw readError;
    if (!composition) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Composición de video no encontrada.", requestId, status: 404 });
    if (composition.status !== "READY_FOR_PREVIEW" || !composition.active_revision_id) {
      return apiErrorResponse({ code: API_ERROR_CODE.conflict, message: "La composición debe tener una revisión lista para preview antes de aprobarse.", requestId, status: 409 });
    }
    const { error: updateError } = await admin
      .from("video_compositions")
      .update({ status: "READY_FOR_RENDER", updated_at: new Date().toISOString() })
      .eq("id", compositionId)
      .eq("organization_id", tenant.organizationId);
    if (updateError) throw updateError;
    return apiSuccessResponse({ data: { compositionId, revisionId: composition.active_revision_id, status: "READY_FOR_RENDER" } }, { requestId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Composition ID inválido.", requestId, status: 400 });
    }
    logger.error("production.hyperframes.composition.approve_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo aprobar la composición de video.", requestId, retryable: true, status: 500 });
  }
}
