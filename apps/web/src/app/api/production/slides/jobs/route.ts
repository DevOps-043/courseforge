import { z } from "zod";
import {
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
} from "@/lib/server/artifact-action-auth";
import { PRODUCTION_JOB_TYPES } from "@/domains/production/types/production.types";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const querySchema = z.object({
  componentId: z.string().uuid(),
  createdAfter: z.string().datetime().optional(),
  jobId: z.string().uuid().optional(),
});

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.slides.jobs", { correlationId: requestId });
  try {
  const parsed = querySchema.safeParse({
    componentId: new URL(request.url).searchParams.get("componentId"),
    createdAfter: new URL(request.url).searchParams.get("createdAfter") || undefined,
    jobId: new URL(request.url).searchParams.get("jobId") || undefined,
  });
  if (!parsed.success) {
    return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Parámetros inválidos.", requestId, status: 400 });
  }

  const supabase = await createClient();
  if (!(await getAuthenticatedUser(supabase))) {
    return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
  }
  const authorized = await getAuthorizedMaterialComponentAdmin(parsed.data.componentId);
  if (!authorized) {
    return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Componente no encontrado.", requestId, status: 404 });
  }

  let query = authorized.admin
    .from("production_jobs")
    .select("id, status, provider_error, created_at, updated_at")
    .eq("material_component_id", parsed.data.componentId)
    .eq("job_type", PRODUCTION_JOB_TYPES.SLIDE_DECK_GENERATION)
    .order("created_at", { ascending: false })
    .limit(1);
  if (parsed.data.jobId) {
    query = query.eq("id", parsed.data.jobId);
  } else if (parsed.data.createdAfter) {
    query = query.gte("created_at", parsed.data.createdAfter);
  }
  const { data, error } = await query.maybeSingle();
  if (error) {
    logger.error("production.slides.jobs_query_failed", error, { componentId: parsed.data.componentId });
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo consultar el trabajo de slides.", requestId, retryable: true, status: 500 });
  }

  const { data: component } = await authorized.admin
    .from("material_components")
    .select("assets")
    .eq("id", parsed.data.componentId)
    .single();

  return apiSuccessResponse({
    data: {
      assets: component?.assets || {},
      job: data || null,
      status: data?.status || "QUEUED",
    },
  }, { requestId });
  } catch (error) {
    logger.error("production.slides.jobs_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo consultar el trabajo de slides.", requestId, retryable: true, status: 500 });
  }
}
