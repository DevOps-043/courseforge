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
  provider_render_id: string | null;
  provider_status: string;
}

export interface RecoverableHyperframesRender {
  id: string;
  providerRenderId: string;
  providerStatus: string;
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
      .eq("status", PRODUCTION_JOB_STATUSES.WAITING_PROVIDER)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (jobError) throw jobError;
    if (!(job as RecoverableProductionJob | null)?.id) return null;

    const { data: request, error: requestError } = await this.supabase
      .from("hyperframes_render_requests")
      .select("id, provider_render_id, provider_status")
      .eq("organization_id", params.organizationId)
      .eq("production_job_id", (job as RecoverableProductionJob).id)
      .maybeSingle();
    if (requestError) throw requestError;

    const recoverable = request as RecoverableRenderRequestRow | null;
    if (!recoverable?.provider_render_id) return null;

    return {
      id: recoverable.id,
      providerRenderId: recoverable.provider_render_id,
      providerStatus: recoverable.provider_status,
    };
  }
}
