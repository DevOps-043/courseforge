import { z } from "zod";
import {
  canReviewContent,
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { HeygenRepository } from "@/domains/production/providers/heygen/heygen.repository";
import {
  PRODUCTION_ASSET_TYPES,
  PRODUCTION_JOB_STATUSES,
  PRODUCTION_JOB_TYPES,
} from "@/domains/production/types/production.types";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const latestJobQuerySchema = z.object({
  componentId: z.string().uuid(),
});

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.jobs", { correlationId: requestId });
  try {
    const query = latestJobQuerySchema.parse({
      componentId: new URL(request.url).searchParams.get("componentId"),
    });
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    }

    const canReview = await canReviewContent(authenticatedUser.userId);
    if (!canReview) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para consultar jobs de HeyGen.", requestId, status: 403 });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no valida o no autorizada.", requestId, status: 403 });
    }

    const authorizedComponent = await getAuthorizedMaterialComponentAdmin(
      query.componentId,
    );
    if (!authorizedComponent) {
      return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Componente no encontrado para esta empresa.", requestId, status: 404 });
    }

    const repository = new HeygenRepository(authorizedComponent.admin);
    const latestJob = await repository.getLatestHeygenMediaJobForComponent({
      componentId: query.componentId,
      organizationId: tenant.organizationId,
    });

    if (!latestJob) {
      return apiSuccessResponse({
        data: { asset: null, latestJob: null },
      }, { requestId });
    }

    const jobType = typeof latestJob.input_snapshot?.job_type === "string"
      ? latestJob.input_snapshot.job_type
      : null;
    const [asset, voiceAsset] = await Promise.all([
      repository.findAvatarVideoAssetByJob(
        latestJob.id,
        jobType === PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_CLIP
          ? PRODUCTION_ASSET_TYPES.AVATAR_VIDEO_CLIP
          : PRODUCTION_ASSET_TYPES.AVATAR_VIDEO,
      ),
      repository.findVoiceAudioAssetByJob(latestJob.id),
    ]);
    const exposeVoiceAsset = jobType !== PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_CLIP
      || latestJob.status === PRODUCTION_JOB_STATUSES.SUCCEEDED;

    return apiSuccessResponse({
      data: {
        asset: asset
          ? {
              id: asset.id,
              publicUrl: asset.public_url || null,
              storagePath: asset.storage_path || null,
            }
          : null,
        voiceAsset: exposeVoiceAsset && voiceAsset?.public_url && voiceAsset.storage_path
          ? {
              durationSeconds:
                voiceAsset.duration_seconds ||
                (voiceAsset.duration_milliseconds
                  ? voiceAsset.duration_milliseconds / 1_000
                  : null),
              id: voiceAsset.id,
              metadata: voiceAsset.metadata || {},
              publicUrl: voiceAsset.public_url,
              storagePath: voiceAsset.storage_path,
            }
          : null,
        latestJob: {
          createdAt: latestJob.created_at || null,
          jobId: latestJob.id,
          outputSnapshot: latestJob.output_snapshot || {},
          providerJobId: latestJob.provider_job_id
            || (typeof latestJob.output_snapshot?.provider_request_id === "string"
              ? latestJob.output_snapshot.provider_request_id
              : null),
          providerError: latestJob.provider_error || null,
          jobType,
          providerModel: latestJob.provider_model || null,
          status: latestJob.status,
          updatedAt: latestJob.updated_at || null,
        },
      },
    }, { requestId });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Parametros invalidos para consultar jobs de HeyGen.", requestId, status: 400 });
    }

    logger.error("production.heygen.jobs.read_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "Error interno del servidor al consultar jobs de HeyGen.", requestId, retryable: true, status: 500 });
  }
}
