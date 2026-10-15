import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getAuthorizedMaterialComponentAdmin } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { createClient } from "@/utils/supabase/server";
import { AudioWaveformReadError, readAudioWaveformPreview } from "@/domains/production/audio-processing/audio-waveform-read.service";
import { createWaveformAnalysisJob, WaveformSourceError, WAVEFORM_ANALYSIS_PROFILE_ID } from "@/domains/production/audio-processing/audio-waveform-job.service";
import { resolveProductionComponentContext } from "@/domains/production/jobs/production-jobs.service";

interface RouteContext { params: Promise<{ assetId: string }>; }

export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.audio.waveform", { correlationId: requestId });
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    const tenant = await resolveActiveTenantContext();
    if (!tenant || !(await canReviewContent(user.userId, tenant))) return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no autorizada.", requestId, status: 403 });
    const assetId = z.string().uuid().parse((await context.params).assetId);
    const componentId = z.string().uuid().parse(new URL(request.url).searchParams.get("componentId"));
    const authorized = await getAuthorizedMaterialComponentAdmin(componentId);
    if (!authorized) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Componente no encontrado.", requestId, status: 404 });
    const query = new URL(request.url).searchParams;
    const jobId = query.get("jobId");
    if (jobId) {
      const { data: job, error } = await authorized.admin.from("production_jobs").select("status, output_snapshot")
        .eq("id", z.string().uuid().parse(jobId)).eq("organization_id", tenant.organizationId)
        .eq("material_component_id", componentId).eq("job_type", "AUDIO_PROCESSING").eq("provider", "ffmpeg")
        .contains("input_snapshot", { profile: { id: WAVEFORM_ANALYSIS_PROFILE_ID }, source: { assetId } }).maybeSingle();
      if (error) throw error;
      if (!job) throw new AudioWaveformReadError(404, "Análisis no encontrado.");
      if (job.status !== "SUCCEEDED" || job.output_snapshot?.status === "NO_AUDIO") {
        return apiSuccessResponse({ data: null, status: job.status === "SUCCEEDED" ? "NO_AUDIO" : job.status },
          { requestId, headers: { "Cache-Control": "private, no-store" } });
      }
    }
    const window = z.object({ startSeconds: z.coerce.number().finite().min(0).max(86400).optional(),
      endSeconds: z.coerce.number().finite().positive().max(86400).optional(),
      widthPixels: z.coerce.number().int().min(1).max(4096).optional() }).parse({
        startSeconds: query.get("start") ?? undefined, endSeconds: query.get("end") ?? undefined, widthPixels: query.get("width") ?? undefined,
      });
    const waveform = await readAudioWaveformPreview({
      assetId,
      componentId,
      organizationId: tenant.organizationId,
      supabase: authorized.admin,
      ...window,
    });
    return apiSuccessResponse({ data: waveform }, {
      headers: { "Cache-Control": "private, no-store" },
      requestId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Identificador inválido.", requestId, status: 400 });
    }
    if (error instanceof AudioWaveformReadError) {
      return apiErrorResponse({
        code: error.status === 404 ? API_ERROR_CODE.resourceNotFound : API_ERROR_CODE.invalidRequest,
        message: error.message,
        requestId,
        status: error.status,
      });
    }
    logger.error("production.audio.waveform.read_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo consultar la waveform.", requestId, retryable: true, status: 500 });
  }
}

const analysisRequestSchema = z.object({ componentId: z.string().uuid(), retryFailed: z.boolean().default(false) }).strict();

export async function POST(request: Request, route: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.audio.waveform", { correlationId: requestId });
  try {
    const parsed = await parseJsonRequest(request, analysisRequestSchema, 4096);
    if (!parsed.success) return apiErrorResponse({ code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, message: "Solicitud inválida.", requestId, status: parsed.reason === "too_large" ? 413 : 400 });
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    const tenant = await resolveActiveTenantContext();
    if (!tenant || !(await canReviewContent(user.userId, tenant))) return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "Sin permisos para analizar audio.", requestId, status: 403 });
    const authorized = await getAuthorizedMaterialComponentAdmin(parsed.data.componentId);
    if (!authorized) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Componente no encontrado.", requestId, status: 404 });
    const context = await resolveProductionComponentContext({ componentId: parsed.data.componentId, supabase: authorized.admin });
    if (context.organizationId !== tenant.organizationId) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Componente no encontrado.", requestId, status: 404 });
    const job = await createWaveformAnalysisJob({ componentContext: context, createdBy: user.userId,
      assetId: z.string().uuid().parse((await route.params).assetId), retryFailed: parsed.data.retryFailed, supabase: authorized.admin });
    logger.info("production.audio.waveform.queued", { jobId: job.id });
    return apiSuccessResponse({ data: { jobId: job.id, status: job.status } }, { requestId, status: 202 });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof WaveformSourceError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: error instanceof WaveformSourceError ? error.message : "Identificador inválido.", requestId, status: 422 });
    logger.error("production.audio.waveform.queue_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo iniciar el análisis.", requestId, status: 500 });
  }
}
