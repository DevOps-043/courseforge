import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PRODUCTION_JOB_STATUSES,
  PRODUCTION_JOB_TYPES,
  PRODUCTION_PROVIDERS,
} from "../types/production.types";

interface RecoverableProductionJob {
  id: string;
}

interface RecoverableRenderRequestRow {
  id: string;
  import_status: string;
  provider_render_id: string | null;
  provider_status: string;
}

export interface RecoverableHyperframesRender {
  id: string;
  providerRenderId: string | null;
  providerStatus: string;
  importStatus: string;
}

/**
 * Finds durable provider work that still needs browser-driven reconciliation.
 * Every lookup is scoped to the active organization before service-role data is
 * returned to an authenticated route.
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
      .select("id, import_status, provider_render_id, provider_status")
      .eq("id", params.requestId)
      .eq("organization_id", params.organizationId)
      .maybeSingle();
    if (error) throw error;
    return toRecoverableRender(data as RecoverableRenderRequestRow | null);
  }

  async findLatestForComposition(params: {
    compositionId: string;
    organizationId: string;
  }): Promise<RecoverableHyperframesRender | null> {
    const { data: composition, error: compositionError } = await this.supabase
      .from("video_compositions")
      .select("material_component_id")
      .eq("id", params.compositionId)
      .eq("organization_id", params.organizationId)
      .maybeSingle();
    if (compositionError) throw compositionError;

    const componentId = (composition as { material_component_id?: string | null } | null)
      ?.material_component_id;
    if (!componentId) return null;

    const { data: job, error: jobError } = await this.supabase
      .from("production_jobs")
      .select("id")
      .eq("organization_id", params.organizationId)
      .eq("material_component_id", componentId)
      .eq("job_type", PRODUCTION_JOB_TYPES.HYPERFRAMES_RENDER)
      .eq("provider", PRODUCTION_PROVIDERS.HYPERFRAMES)
      .in("status", [
        PRODUCTION_JOB_STATUSES.PENDING,
        PRODUCTION_JOB_STATUSES.WAITING_PROVIDER,
        PRODUCTION_JOB_STATUSES.RUNNING,
        PRODUCTION_JOB_STATUSES.RETRY_SCHEDULED,
      ])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (jobError) throw jobError;
    if (!(job as RecoverableProductionJob | null)?.id) return null;

    const { data: request, error: requestError } = await this.supabase
      .from("hyperframes_render_requests")
      .select("id, import_status, provider_render_id, provider_status")
      .eq("organization_id", params.organizationId)
      .eq("production_job_id", (job as RecoverableProductionJob).id)
      .maybeSingle();
    if (requestError) throw requestError;

    return toRecoverableRender(request as RecoverableRenderRequestRow | null);
  }
}

function toRecoverableRender(
  row: RecoverableRenderRequestRow | null,
): RecoverableHyperframesRender | null {
  if (!row) return null;
  return {
    id: row.id,
    providerRenderId: row.provider_render_id,
    providerStatus: row.provider_status,
    importStatus: row.import_status,
  };
}
