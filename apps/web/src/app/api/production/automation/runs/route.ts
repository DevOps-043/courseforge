import { z } from "zod";
import {
  canReviewContent,
  getAuthenticatedUser,
  getAuthorizedArtifactAdminForTenant,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  ProductionAutomationRunError,
  ProductionAutomationRunService,
} from "@/domains/production/automation/production-automation-run.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const createRunSchema = z.object({ artifactId: z.string().uuid() }).strict();
const MAX_CREATE_RUN_REQUEST_BYTES = 8 * 1024;

/** Returns an active run so the review can resume after a client interruption. */
export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.automation.runs", { correlationId: requestId });
  try {
    const artifactId = new URL(request.url).searchParams.get("artifactId");
    if (!artifactId || !z.string().uuid().safeParse(artifactId).success) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "artifactId inválido.", requestId, status: 400 });
    }
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    const tenant = await resolveActiveTenantContext();
    if (!tenant || !(await canReviewContent(user.userId, tenant))) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para consultar producción.", requestId, status: 403 });
    }
    const { data, error } = await getServiceRoleClient()
      .from("production_runs")
      .select("id")
      .eq("artifact_id", artifactId)
      .eq("organization_id", tenant.organizationId)
      .in("status", ["PLANNING", "GENERATING", "PARTIALLY_READY", "NEEDS_ATTENTION"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return apiSuccessResponse({ data: data || null }, { requestId, headers: { "Cache-Control": "private, no-store" } });
  } catch (error: unknown) {
    logger.error("production.automation.runs.lookup_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo consultar la automatización.", requestId, retryable: true, status: 500 });
  }
}

/** Creates or refreshes an asset-generation run. It never renders a video. */
export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.automation.runs", { correlationId: requestId });
  try {
    const parsedRequest = await parseJsonRequest(request, createRunSchema, MAX_CREATE_RUN_REQUEST_BYTES);
    if (!parsedRequest.success) {
      return apiErrorResponse({
        code: parsedRequest.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsedRequest.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Payload inválido para automatizar producción.",
        requestId,
        status: parsedRequest.reason === "too_large" ? 413 : 400,
      });
    }
    const input = parsedRequest.data;
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });

    const tenant = await resolveActiveTenantContext();
    if (!tenant || !(await canReviewContent(user.userId, tenant))) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para automatizar producción.", requestId, status: 403 });
    }
    const authorized = await getAuthorizedArtifactAdminForTenant(input.artifactId, tenant);
    if (!authorized || authorized.artifact.organization_id !== tenant.organizationId) {
      return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Curso no encontrado para esta empresa.", requestId, status: 404 });
    }

    const service = new ProductionAutomationRunService(authorized.admin);
    const result = await service.createRun({
      artifactId: input.artifactId,
      createdBy: user.userId,
      organizationId: tenant.organizationId,
    });
    return apiSuccessResponse({ data: result }, { requestId, status: 202 });
  } catch (error: unknown) {
    if (error instanceof ProductionAutomationRunError) {
      return apiErrorResponse({
        code: error.status === 404 ? API_ERROR_CODE.resourceNotFound : error.status === 409 ? API_ERROR_CODE.conflict : API_ERROR_CODE.invalidRequest,
        message: error.message,
        requestId,
        status: error.status,
      });
    }
    logger.error("production.automation.runs.create_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo iniciar la automatización.", requestId, retryable: true, status: 500 });
  }
}
