import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PRODUCTION_JOB_STATUSES,
  PRODUCTION_JOB_TYPES,
  PRODUCTION_PROVIDERS,
} from "../types/production.types";
import type { HyperframesCloudClient } from "./hyperframes-cloud.client";
import { decideHyperframesPollingAction } from "./hyperframes-polling.service";
import {
  HyperframesVideoImportService,
  type HyperframesImportedVideo,
} from "./hyperframes-video-import.service";

type HyperframesRenderRequestRow = {
  archive_size_bytes: number;
  composition_revision_id: string;
  id: string;
  poll_attempts: number;
  production_job_id: string;
  provider_render_id: string | null;
  provider_status: string;
};

type HyperframesProductionJobRow = {
  artifact_id: string;
  created_by: string | null;
  id: string;
  material_component_id: string | null;
  organization_id: string | null;
  output_snapshot: Record<string, unknown> | null;
  progress: unknown[] | null;
};

export class HyperframesRenderPollingError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

export interface HyperframesPollResult {
  action: "WAIT" | "COMPLETE" | "FAIL";
  finalVideo?: HyperframesImportedVideo;
  providerStatus: string;
  requestId: string;
}

/**
 * Reconciles one cloud render with Courseforge. It is intentionally invoked by
 * authenticated polling rather than receiving provider callbacks/webhooks.
 */
export class HyperframesRenderPollingService {
  private readonly importer: HyperframesVideoImportService;

  constructor(
    private readonly supabase: SupabaseClient<any, "public", any>,
    private readonly client: HyperframesCloudClient,
  ) {
    this.importer = new HyperframesVideoImportService(supabase);
  }

  async poll(params: {
    organizationId: string;
    requestId: string;
  }): Promise<HyperframesPollResult> {
    const request = await this.getRequest(params);
    const job = await this.getJob({
      jobId: request.production_job_id,
      organizationId: params.organizationId,
    });

    if (!request.provider_render_id) {
      throw new HyperframesRenderPollingError(
        "El render HyperFrames aún no tiene un identificador de HeyGen.",
      );
    }
    if (!job.material_component_id || !job.organization_id) {
      throw new HyperframesRenderPollingError(
        "El job de HyperFrames no tiene el contexto de componente requerido.",
      );
    }

    const render = await this.client.getRender(request.provider_render_id);
    const decision = decideHyperframesPollingAction(render);
    const now = new Date().toISOString();
    const providerStatus = toStoredProviderStatus(decision.providerStatus);

    if (decision.action === "WAIT") {
      await this.updateRequest({
        id: request.id,
        pollAttempts: request.poll_attempts + 1,
        providerError: null,
        providerStatus,
        updatedAt: now,
      });
      await this.updateJobWaiting({
        job,
        progressPercent: decision.progressPercent,
        providerRenderId: render.render_id,
        providerStatus: decision.providerStatus,
        updatedAt: now,
      });
      return {
        action: "WAIT",
        providerStatus: decision.providerStatus,
        requestId: request.id,
      };
    }

    if (decision.action === "FAIL") {
      await this.markFailed({
        errorMessage: decision.errorMessage || "El render de HyperFrames falló.",
        jobId: job.id,
        pollAttempts: request.poll_attempts + 1,
        providerStatus,
        requestId: request.id,
        updatedAt: now,
      });
      return {
        action: "FAIL",
        providerStatus: decision.providerStatus,
        requestId: request.id,
      };
    }

    try {
      const finalVideo = await this.importer.importCompletedRender({
        artifactId: job.artifact_id,
        componentId: job.material_component_id,
        createdBy: job.created_by,
        durationSeconds: render.duration || null,
        jobId: job.id,
        organizationId: job.organization_id,
        renderId: render.render_id,
        requestId: request.id,
        thumbnailUrl: render.thumbnail_url || null,
        videoUrl: render.video_url!,
      });
      await this.updateRequest({
        id: request.id,
        pollAttempts: request.poll_attempts + 1,
        providerError: null,
        providerStatus,
        updatedAt: now,
      });
      await this.updateJobSucceeded({
        finalVideo,
        job,
        providerRenderId: render.render_id,
        providerStatus: decision.providerStatus,
        updatedAt: now,
      });
      return {
        action: "COMPLETE",
        finalVideo,
        providerStatus: decision.providerStatus,
        requestId: request.id,
      };
    } catch (error) {
      const message = toSafeErrorMessage(error);
      await this.markFailed({
        errorMessage: message,
        jobId: job.id,
        pollAttempts: request.poll_attempts + 1,
        providerStatus: "FAILED",
        requestId: request.id,
        updatedAt: now,
      });
      throw new HyperframesRenderPollingError(message, 502);
    }
  }

  private async getRequest(params: { organizationId: string; requestId: string }) {
    const { data, error } = await this.supabase
      .from("hyperframes_render_requests")
      .select("id, production_job_id, composition_revision_id, archive_size_bytes, provider_render_id, provider_status, poll_attempts")
      .eq("id", params.requestId)
      .eq("organization_id", params.organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new HyperframesRenderPollingError("Render HyperFrames no encontrado para esta empresa.", 404);
    }
    return data as HyperframesRenderRequestRow;
  }

  private async getJob(params: { jobId: string; organizationId: string }) {
    const { data, error } = await this.supabase
      .from("production_jobs")
      .select("id, artifact_id, material_component_id, organization_id, created_by, output_snapshot, progress")
      .eq("id", params.jobId)
      .eq("organization_id", params.organizationId)
      .eq("job_type", PRODUCTION_JOB_TYPES.HYPERFRAMES_RENDER)
      .eq("provider", PRODUCTION_PROVIDERS.HYPERFRAMES)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new HyperframesRenderPollingError("Job de HyperFrames no encontrado para esta empresa.", 404);
    }
    return data as HyperframesProductionJobRow;
  }

  private async updateRequest(params: {
    id: string;
    pollAttempts: number;
    providerError: Record<string, unknown> | null;
    providerStatus: string;
    updatedAt: string;
  }) {
    const { error } = await this.supabase
      .from("hyperframes_render_requests")
      .update({
        last_polled_at: params.updatedAt,
        poll_attempts: params.pollAttempts,
        provider_error: params.providerError,
        provider_status: params.providerStatus,
        updated_at: params.updatedAt,
      })
      .eq("id", params.id);
    if (error) throw error;
  }

  private async updateJobWaiting(params: {
    job: HyperframesProductionJobRow;
    progressPercent: number;
    providerRenderId: string;
    providerStatus: string;
    updatedAt: string;
  }) {
    const { error } = await this.supabase
      .from("production_jobs")
      .update({
        output_snapshot: {
          ...(params.job.output_snapshot || {}),
          provider_render_id: params.providerRenderId,
          provider_status: params.providerStatus,
        },
        progress: appendProgress(params.job.progress, params.progressPercent, params.providerStatus, params.updatedAt),
        provider_job_id: params.providerRenderId,
        status: PRODUCTION_JOB_STATUSES.WAITING_PROVIDER,
        updated_at: params.updatedAt,
      })
      .eq("id", params.job.id);
    if (error) throw error;
  }

  private async updateJobSucceeded(params: {
    finalVideo: HyperframesImportedVideo;
    job: HyperframesProductionJobRow;
    providerRenderId: string;
    providerStatus: string;
    updatedAt: string;
  }) {
    const { error } = await this.supabase
      .from("production_jobs")
      .update({
        completed_at: params.updatedAt,
        output_snapshot: {
          ...(params.job.output_snapshot || {}),
          final_video: {
            checksum: params.finalVideo.checksum,
            file_size_bytes: params.finalVideo.fileSizeBytes,
            public_url: params.finalVideo.publicUrl,
            storage_path: params.finalVideo.storagePath,
          },
          provider_render_id: params.providerRenderId,
          provider_status: params.providerStatus,
        },
        progress: appendProgress(params.job.progress, 100, "completed", params.updatedAt),
        provider_job_id: params.providerRenderId,
        status: PRODUCTION_JOB_STATUSES.SUCCEEDED,
        updated_at: params.updatedAt,
      })
      .eq("id", params.job.id);
    if (error) throw error;
  }

  private async markFailed(params: {
    errorMessage: string;
    jobId: string;
    pollAttempts: number;
    providerStatus: string;
    requestId: string;
    updatedAt: string;
  }) {
    const providerError = { message: params.errorMessage, source: "hyperframes_polling" };
    await this.updateRequest({
      id: params.requestId,
      pollAttempts: params.pollAttempts,
      providerError,
      providerStatus: params.providerStatus,
      updatedAt: params.updatedAt,
    });
    const { error } = await this.supabase
      .from("production_jobs")
      .update({
        failed_at: params.updatedAt,
        provider_error: providerError,
        status: PRODUCTION_JOB_STATUSES.FAILED,
        updated_at: params.updatedAt,
      })
      .eq("id", params.jobId);
    if (error) throw error;
  }
}

function appendProgress(
  existing: unknown[] | null,
  percent: number,
  stage: string,
  at: string,
) {
  const entries = Array.isArray(existing) ? existing.slice(-49) : [];
  return [...entries, { at, percent, stage }];
}

function toStoredProviderStatus(status: string) {
  if (status === "queued") return "PENDING";
  if (status === "rendering") return "RUNNING";
  return status.toUpperCase();
}

function toSafeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.slice(0, 500);
  return "No se pudo importar el video final de HyperFrames.";
}
