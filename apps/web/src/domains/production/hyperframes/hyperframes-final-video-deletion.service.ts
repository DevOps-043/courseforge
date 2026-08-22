import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PRODUCTION_ASSET_TYPES,
  PRODUCTION_JOB_STATUSES,
  PRODUCTION_JOB_TYPES,
  PRODUCTION_PROVIDERS,
  PRODUCTION_QA_STATUSES,
} from "../types/production.types";

const FINAL_VIDEO_BUCKET = "production-videos";

type FinalVideoRow = {
  id: string;
  public_url: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
};

export class HyperframesFinalVideoDeletionError extends Error {
  constructor(
    message: string,
    readonly status = 409,
    readonly code = "HYPERFRAMES_FINAL_VIDEO_DELETE_FAILED",
  ) {
    super(message);
  }
}

/**
 * Removes the current HyperFrames final-video file for one composition only.
 * Ledger rows are archived rather than destroyed so render history remains
 * auditable, while recovery/publication stop treating older files as current.
 */
export class HyperframesFinalVideoDeletionService {
  constructor(
    private readonly supabase: SupabaseClient<any, "public", any>,
  ) {}

  async deleteLatestForComposition(params: {
    compositionId: string;
    expectedAssetId: string;
    organizationId: string;
  }) {
    const { data: composition, error: compositionError } = await this.supabase
      .from("video_compositions")
      .select("artifact_id, material_component_id")
      .eq("id", params.compositionId)
      .eq("organization_id", params.organizationId)
      .maybeSingle();
    if (compositionError) throw compositionError;
    if (!composition?.material_component_id || !composition.artifact_id) {
      throw new HyperframesFinalVideoDeletionError(
        "La composición no está vinculada a una lección editable.",
        404,
        "HYPERFRAMES_COMPOSITION_COMPONENT_NOT_FOUND",
      );
    }

    const componentId = String(composition.material_component_id);
    const artifactId = String(composition.artifact_id);
    await this.assertNoActiveRender({
      componentId,
      organizationId: params.organizationId,
    });

    const { data: latest, error: latestError } = await this.supabase
      .from("production_assets")
      .select("id, public_url, storage_bucket, storage_path")
      .eq("organization_id", params.organizationId)
      .eq("material_component_id", componentId)
      .eq("asset_type", PRODUCTION_ASSET_TYPES.FINAL_VIDEO)
      .eq("provider", PRODUCTION_PROVIDERS.HYPERFRAMES)
      .neq("qa_status", PRODUCTION_QA_STATUSES.ARCHIVED)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw latestError;
    if (!latest) {
      throw new HyperframesFinalVideoDeletionError(
        "Esta lección ya no tiene un video final de HyperFrames para eliminar.",
        404,
        "HYPERFRAMES_FINAL_VIDEO_NOT_FOUND",
      );
    }

    const video = latest as FinalVideoRow;
    if (video.id !== params.expectedAssetId) {
      throw new HyperframesFinalVideoDeletionError(
        "El video final cambió desde que abriste el editor. Actualiza antes de eliminarlo.",
        409,
        "HYPERFRAMES_FINAL_VIDEO_CHANGED",
      );
    }

    const { data: component, error: componentError } = await this.supabase
      .from("material_components")
      .select("assets")
      .eq("id", componentId)
      .maybeSingle();
    if (componentError) throw componentError;
    if (!component) {
      throw new HyperframesFinalVideoDeletionError(
        "No se encontró el componente de la lección.",
        404,
        "HYPERFRAMES_COMPONENT_NOT_FOUND",
      );
    }

    const nextAssets = removeHyperframesFinalVideoProjection(
      (component.assets || {}) as Record<string, unknown>,
      video,
    );
    const { error: componentUpdateError } = await this.supabase
      .from("material_components")
      .update({ assets: nextAssets })
      .eq("id", componentId);
    if (componentUpdateError) throw componentUpdateError;

    const objectPath = resolveFinalVideoObjectPath({
      artifactId,
      componentId,
      organizationId: params.organizationId,
      storageBucket: video.storage_bucket,
      storagePath: video.storage_path,
    });
    if (objectPath) {
      const { error: storageError } = await this.supabase.storage
        .from(FINAL_VIDEO_BUCKET)
        .remove([objectPath]);
      if (storageError) {
        throw new HyperframesFinalVideoDeletionError(
          "Se retiró el video de publicación, pero no se pudo borrar su archivo de Storage.",
          502,
          "HYPERFRAMES_FINAL_VIDEO_STORAGE_DELETE_FAILED",
        );
      }
    }

    const { error: archiveError } = await this.supabase
      .from("production_assets")
      .update({
        qa_status: PRODUCTION_QA_STATUSES.ARCHIVED,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", params.organizationId)
      .eq("material_component_id", componentId)
      .eq("asset_type", PRODUCTION_ASSET_TYPES.FINAL_VIDEO)
      .eq("provider", PRODUCTION_PROVIDERS.HYPERFRAMES)
      .neq("qa_status", PRODUCTION_QA_STATUSES.ARCHIVED);
    if (archiveError) throw archiveError;

    return {
      archivedAssetId: video.id,
      componentId,
      deletedFromStorage: Boolean(objectPath),
    };
  }

  private async assertNoActiveRender(params: {
    componentId: string;
    organizationId: string;
  }) {
    const { data, error } = await this.supabase
      .from("production_jobs")
      .select("id")
      .eq("organization_id", params.organizationId)
      .eq("material_component_id", params.componentId)
      .eq("job_type", PRODUCTION_JOB_TYPES.HYPERFRAMES_RENDER)
      .eq("provider", PRODUCTION_PROVIDERS.HYPERFRAMES)
      .in("status", [
        PRODUCTION_JOB_STATUSES.PENDING,
        PRODUCTION_JOB_STATUSES.RUNNING,
        PRODUCTION_JOB_STATUSES.WAITING_PROVIDER,
        PRODUCTION_JOB_STATUSES.RETRY_SCHEDULED,
      ])
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      throw new HyperframesFinalVideoDeletionError(
        "Espera a que termine el render activo antes de eliminar el video anterior.",
        409,
        "HYPERFRAMES_RENDER_ACTIVE",
      );
    }
  }
}

export function removeHyperframesFinalVideoProjection(
  currentAssets: Record<string, unknown>,
  video: Pick<FinalVideoRow, "public_url" | "storage_path">,
) {
  const isHyperframesProjection = currentAssets.final_video_source === "hyperframes_cloud"
    || currentAssets.final_video_asset_provider === PRODUCTION_PROVIDERS.HYPERFRAMES
    || currentAssets.final_video_url === video.public_url
    || currentAssets.final_video_storage_path === video.storage_path;
  if (!isHyperframesProjection) return currentAssets;

  const {
    final_video_asset_provider: _assetProvider,
    final_video_file_name: _fileName,
    final_video_source: _source,
    final_video_storage_path: _storagePath,
    final_video_url: _url,
    video_duration: _duration,
    ...preserved
  } = currentAssets;
  return {
    ...preserved,
    production_status: "PENDING",
    updated_at: new Date().toISOString(),
  };
}

export function resolveFinalVideoObjectPath(params: {
  artifactId: string;
  componentId: string;
  organizationId: string;
  storageBucket: string | null;
  storagePath: string | null;
}) {
  if (!params.storagePath) return null;
  if (params.storageBucket !== FINAL_VIDEO_BUCKET) {
    throw new HyperframesFinalVideoDeletionError(
      "El video final no pertenece al bucket administrado por HyperFrames.",
      409,
      "HYPERFRAMES_FINAL_VIDEO_BUCKET_INVALID",
    );
  }
  const path = params.storagePath.startsWith(`${FINAL_VIDEO_BUCKET}/`)
    ? params.storagePath.slice(FINAL_VIDEO_BUCKET.length + 1)
    : params.storagePath;
  const expectedPrefix = [
    "organizations",
    params.organizationId,
    "artifacts",
    params.artifactId,
    "components",
    params.componentId,
    "renders",
  ].join("/") + "/";
  if (
    !path.startsWith(expectedPrefix)
    || path.startsWith("/")
    || path.includes("..")
    || path.includes("\\")
  ) {
    throw new HyperframesFinalVideoDeletionError(
      "La ruta del video final no es segura para eliminarse.",
      409,
      "HYPERFRAMES_FINAL_VIDEO_PATH_INVALID",
    );
  }
  return path;
}
