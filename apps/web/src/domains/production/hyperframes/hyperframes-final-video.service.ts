import type { SupabaseClient } from "@supabase/supabase-js";
import type { MaterialAssets } from "../../materials/types/materials.types";
import {
  PRODUCTION_ASSET_TYPES,
  PRODUCTION_QA_STATUSES,
  PRODUCTION_PROVIDERS,
} from "../types/production.types";

interface DurableFinalVideoRow {
  created_at: string;
  duration_seconds: number | null;
  id: string;
  material_component_id: string;
  production_job_id: string | null;
  public_url: string;
  storage_path: string | null;
}

interface RenderRevisionRow {
  composition_revision_id: string;
  production_job_id: string;
}

export interface HyperframesDurableFinalVideo {
  assetId: string;
  compositionRevisionId: string | null;
  createdAt: string;
  durationSeconds: number | null;
  productionJobId: string | null;
  publicUrl: string;
  storagePath: string | null;
}

/**
 * Reads imported HyperFrames videos from the append-only production ledger.
 * `material_components.assets` remains a UI projection and must not be the only
 * source used by recovery or publication flows.
 */
export class HyperframesFinalVideoService {
  constructor(
    private readonly supabase: SupabaseClient<any, "public", any>,
  ) {}

  async findLatestForComponent(params: {
    componentId: string;
    organizationId: string;
  }): Promise<HyperframesDurableFinalVideo | null> {
    const videos = await this.findLatestByComponentIds({
      componentIds: [params.componentId],
      organizationId: params.organizationId,
    });
    return videos.get(params.componentId) || null;
  }

  async findLatestByComponentIds(params: {
    componentIds: string[];
    organizationId: string;
  }): Promise<Map<string, HyperframesDurableFinalVideo>> {
    const componentIds = [...new Set(params.componentIds.filter(Boolean))];
    if (componentIds.length === 0) return new Map();

    const { data, error } = await this.supabase
      .from("production_assets")
      .select(
        "id, material_component_id, production_job_id, public_url, storage_path, duration_seconds, created_at",
      )
      .eq("organization_id", params.organizationId)
      .eq("asset_type", PRODUCTION_ASSET_TYPES.FINAL_VIDEO)
      .eq("provider", PRODUCTION_PROVIDERS.HYPERFRAMES)
      .neq("qa_status", PRODUCTION_QA_STATUSES.ARCHIVED)
      .in("material_component_id", componentIds)
      .not("public_url", "is", null)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const latestRows = new Map<string, DurableFinalVideoRow>();
    for (const row of (data || []) as DurableFinalVideoRow[]) {
      if (!latestRows.has(row.material_component_id)) {
        latestRows.set(row.material_component_id, row);
      }
    }

    const productionJobIds = [...new Set(
      [...latestRows.values()]
        .map((row) => row.production_job_id)
        .filter((id): id is string => Boolean(id)),
    )];
    const revisionByJobId = new Map<string, string>();
    if (productionJobIds.length > 0) {
      const { data: requests, error: requestsError } = await this.supabase
        .from("hyperframes_render_requests")
        .select("production_job_id, composition_revision_id")
        .eq("organization_id", params.organizationId)
        .in("production_job_id", productionJobIds);
      if (requestsError) throw requestsError;
      for (const request of (requests || []) as RenderRevisionRow[]) {
        revisionByJobId.set(
          request.production_job_id,
          request.composition_revision_id,
        );
      }
    }

    return new Map(
      [...latestRows.entries()].map(([componentId, row]) => [
        componentId,
        {
          assetId: row.id,
          compositionRevisionId: row.production_job_id
            ? revisionByJobId.get(row.production_job_id) || null
            : null,
          createdAt: row.created_at,
          durationSeconds: row.duration_seconds,
          productionJobId: row.production_job_id,
          publicUrl: row.public_url,
          storagePath: row.storage_path,
        },
      ]),
    );
  }
}

/**
 * Rehydrates only HyperFrames-managed final-video fields. User-provided manual
 * links remain authoritative and are never replaced by a provider asset.
 */
export function mergeDurableFinalVideoIntoAssets(
  currentAssets: MaterialAssets | null | undefined,
  video: HyperframesDurableFinalVideo | null | undefined,
): MaterialAssets {
  const assets = { ...(currentAssets || {}) } as MaterialAssets;
  if (!video) return assets;

  const hasManualFinalVideo = Boolean(assets.final_video_url)
    && assets.final_video_source !== "hyperframes_cloud"
    && assets.final_video_asset_provider !== PRODUCTION_PROVIDERS.HYPERFRAMES;
  if (hasManualFinalVideo) return assets;

  return {
    ...assets,
    final_video_asset_provider: PRODUCTION_PROVIDERS.HYPERFRAMES,
    final_video_source: "hyperframes_cloud",
    final_video_storage_path: video.storagePath || undefined,
    final_video_url: video.publicUrl,
    production_status: "COMPLETED",
    video_duration: video.durationSeconds || undefined,
  };
}
