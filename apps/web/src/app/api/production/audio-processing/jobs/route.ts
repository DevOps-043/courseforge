import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getAuthorizedMaterialComponentAdmin } from "@/lib/server/artifact-action-auth";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { resolveProductionComponentContext } from "@/domains/production/jobs/production-jobs.service";
import {
  AudioProcessingJobError,
  createAudioProcessingJob,
  createAudioProcessingJobRequestSchema,
} from "@/domains/production/audio-processing/audio-processing-job.service";
import { PRODUCTION_JOB_TYPES, PRODUCTION_PROVIDERS } from "@/domains/production/types/production.types";
import { createClient } from "@/utils/supabase/server";

const MAX_REQUEST_BYTES = 8 * 1024;
const querySchema = z.object({ componentId: z.string().uuid(), jobId: z.string().uuid().optional(), sourceAssetId: z.string().uuid() });

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.audio_processing.jobs", { correlationId: requestId });
  try {
    const parsed = await parseJsonRequest(request, createAudioProcessingJobRequestSchema, MAX_REQUEST_BYTES);
    if (!parsed.success) return apiErrorResponse({ code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, message: "Solicitud de audio inválida.", requestId, status: parsed.reason === "too_large" ? 413 : 400 });

    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    const tenant = await resolveActiveTenantContext();
    if (!tenant || !(await canReviewContent(user.userId, tenant))) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para procesar audio.", requestId, status: 403 });
    }

    const authorized = await getAuthorizedMaterialComponentAdmin(parsed.data.componentId);
    if (!authorized) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Componente no encontrado.", requestId, status: 404 });
    const context = await resolveProductionComponentContext({ componentId: parsed.data.componentId, supabase: authorized.admin });
    const job = await createAudioProcessingJob({ componentContext: context, createdBy: user.userId, sourceAssetId: parsed.data.sourceAssetId, supabase: authorized.admin });
    return apiSuccessResponse({ data: { jobId: job.id, profileId: parsed.data.profileId, reused: job.status !== "PENDING", status: job.status } }, { requestId, status: 202 });
  } catch (error) {
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Solicitud de audio inválida.", requestId, status: 400 });
    if (error instanceof AudioProcessingJobError) {
      const status = error.code === "AUDIO_SOURCE_NOT_FOUND" ? 404 : error.code === "AUDIO_SOURCE_TOO_LARGE" ? 413 : error.code === "AUDIO_TENANT_UNRESOLVED" ? 409 : 400;
      return apiErrorResponse({ code: status === 404 ? API_ERROR_CODE.resourceNotFound : status === 409 ? API_ERROR_CODE.conflict : status === 413 ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, message: error.message, requestId, status });
    }
    logger.error("production.audio_processing.create_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo encolar el procesamiento de audio.", requestId, retryable: true, status: 500 });
  }
}

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.audio_processing.jobs", { correlationId: requestId });
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ componentId: url.searchParams.get("componentId"), jobId: url.searchParams.get("jobId") || undefined, sourceAssetId: url.searchParams.get("sourceAssetId") });
    if (!parsed.success) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Parámetros inválidos.", requestId, status: 400 });
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    const tenant = await resolveActiveTenantContext();
    if (!tenant || !(await canReviewContent(user.userId, tenant))) return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para consultar trabajos de audio.", requestId, status: 403 });
    const authorized = await getAuthorizedMaterialComponentAdmin(parsed.data.componentId);
    if (!authorized) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Componente no encontrado.", requestId, status: 404 });
    let query = authorized.admin.from("production_jobs").select("id, status, provider_error, created_at, updated_at, output_snapshot").eq("material_component_id", parsed.data.componentId).eq("job_type", PRODUCTION_JOB_TYPES.AUDIO_PROCESSING).eq("provider", PRODUCTION_PROVIDERS.FFMPEG).contains("input_snapshot", { source: { assetId: parsed.data.sourceAssetId } }).order("created_at", { ascending: false }).limit(1);
    if (parsed.data.jobId) query = query.eq("id", parsed.data.jobId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    const outputAssetId = data?.output_snapshot && typeof data.output_snapshot === "object"
      ? (data.output_snapshot as { asset_id?: unknown }).asset_id
      : null;
    let processedAudio: { assetId: string; publicUrl: string | null } | null = null;
    if (typeof outputAssetId === "string") {
      const { data: asset, error: assetError } = await authorized.admin
        .from("production_assets")
        .select("id, public_url")
        .eq("id", outputAssetId)
        .eq("organization_id", tenant.organizationId)
        .eq("material_component_id", parsed.data.componentId)
        .eq("asset_type", "PROCESSED_AUDIO")
        .maybeSingle();
      if (assetError) throw assetError;
      if (asset) processedAudio = { assetId: asset.id, publicUrl: asset.public_url };
    }
    return apiSuccessResponse({ data: { job: data || null, processedAudio, status: data?.status || "NOT_REQUESTED" } }, { requestId });
  } catch (error) {
    logger.error("production.audio_processing.query_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo consultar el trabajo de audio.", requestId, retryable: true, status: 500 });
  }
}
