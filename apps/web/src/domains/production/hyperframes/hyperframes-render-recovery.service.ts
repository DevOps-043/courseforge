import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PRODUCTION_JOB_STATUSES,
  PRODUCTION_JOB_TYPES,
  PRODUCTION_PROVIDERS,
} from "../types/production.types";
import {
  HyperframesFinalVideoService,
  type HyperframesDurableFinalVideo,
} from "./hyperframes-final-video.service";

interface RecoverableProductionJob {
  id: string;
  status: string;
}

interface RecoverableRenderRequestRow {
  composition_revision_id: string;
  id: string;
  import_status: string;
  provider_render_id: string | null;
  provider_status: string;
}

export interface RecoverableHyperframesRender {
  compositionRevisionId: string;
  id: string;
  providerRenderId: string | null;
  providerStatus: string;
  importStatus: string;
}

export interface HyperframesCompositionRenderState {
  activeRender: RecoverableHyperframesRender | null;
  completedVideo: HyperframesDurableFinalVideo | null;
  latestRender: RecoverableHyperframesRender | null;
}

/**
 * Reads the latest attempt and the latest imported asset independently. A
 * failed attempt must never hide a previously imported, publishable video.
 * Every lookup is scoped to the active organization before service-role data
 * is returned to an authenticated route.
 */
export class HyperframesRenderRecoveryService {
  constructor(
    private readonly supabase: SupabaseClient<any, "public", any>,
  ) {}

  async findById(params: {
    organizationId: string;
    requestId: string;
  }): Promise<RecoverableHyperframesRender | null> {
    const { data, error } = await this.supabase
      .from("hyperframes_render_requests")
      .select(
        "id, composition_revision_id, import_status, provider_render_id, provider_status",
      )
      .eq("id", params.requestId)
      .eq("organization_id", params.organizationId)
      .maybeSingle();
    if (error) throw error;
    return toRecoverableRender(data as RecoverableRenderRequestRow | null);
  }

  async findLatestForComposition(params: {
    compositionId: string;
    organizationId: string;
  }): Promise<HyperframesCompositionRenderState | null> {
    const { data: composition, error: compositionError } = await this.supabase
      .from("video_compositions")
      .select("material_component_id")
      .eq("id", params.compositionId)
      .eq("organization_id", params.organizationId)
      .maybeSingle();
    if (compositionError) throw compositionError;

    const componentId = (composition as {
      material_component_id?: string | null;
    } | null)?.material_component_id;
    if (!componentId) return null;

    const { data: job, error: jobError } = await this.supabase
      .from("production_jobs")
      .select("id, status")
      .eq("organization_id", params.organizationId)
      .eq("material_component_id", componentId)
      .eq("job_type", PRODUCTION_JOB_TYPES.HYPERFRAMES_RENDER)
      .eq("provider", PRODUCTION_PROVIDERS.HYPERFRAMES)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (jobError) throw jobError;

    const latestJob = job as RecoverableProductionJob | null;
    let latestRender: RecoverableHyperframesRender | null = null;
    if (latestJob?.id) {
      const { data: request, error: requestError } = await this.supabase
        .from("hyperframes_render_requests")
        .select(
          "id, composition_revision_id, import_status, provider_render_id, provider_status",
        )
        .eq("organization_id", params.organizationId)
        .eq("production_job_id", latestJob.id)
        .maybeSingle();
      if (requestError) throw requestError;
      latestRender = toRecoverableRender(
        request as RecoverableRenderRequestRow | null,
      );
    }

    const activeStatuses = new Set<string>([
      PRODUCTION_JOB_STATUSES.PENDING,
      PRODUCTION_JOB_STATUSES.WAITING_PROVIDER,
      PRODUCTION_JOB_STATUSES.RUNNING,
      PRODUCTION_JOB_STATUSES.RETRY_SCHEDULED,
    ]);
    const completedVideo = await new HyperframesFinalVideoService(this.supabase)
      .findLatestForComponent({
        componentId,
        organizationId: params.organizationId,
      });

    return {
      activeRender: latestJob && activeStatuses.has(latestJob.status)
        ? latestRender
        : null,
      completedVideo,
      latestRender,
    };
  }
}

function toRecoverableRender(
  row: RecoverableRenderRequestRow | null,
): RecoverableHyperframesRender | null {
  if (!row) return null;
  return {
    compositionRevisionId: row.composition_revision_id,
    id: row.id,
    providerRenderId: row.provider_render_id,
    providerStatus: row.provider_status,
    importStatus: row.import_status,
  };
}
