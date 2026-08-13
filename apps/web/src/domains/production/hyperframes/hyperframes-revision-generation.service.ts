import type { SupabaseClient } from "@supabase/supabase-js";
import type { ZodError } from "zod";
import { getHyperframesGenerationSettings } from "./hyperframes-generation-settings.service";
import { generateHyperframesPlan } from "./hyperframes-plan.service";
import {
  buildInternalHyperframesProject,
  type HyperframesProjectAsset,
} from "./hyperframes-project-builder.service";
import {
  HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES,
  HYPERFRAMES_COMPOSITION_FORMAT,
  hyperframesAssetManifestSchema,
  hyperframesCompositionModeSchema,
  type HyperframesCompositionMode,
} from "./hyperframes.types";
import { validateHyperframesPreflight } from "./hyperframes-preflight.service";
import {
  collectInternalMaterialAssetReferences,
  extractHyperframesAnimatedDeck,
} from "./hyperframes-source-asset.service";

const PROJECT_BUCKET = "production-assets";

type CompositionRow = {
  artifact_id: string;
  id: string;
  material_component_id: string | null;
  name: string;
  organization_id: string;
  status: string;
};

type AssetRow = {
  checksum: string | null;
  file_size_bytes: number | null;
  id: string;
  metadata: Record<string, unknown> | null;
  mime_type: string | null;
  public_url: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
};

export class HyperframesRevisionGenerationError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export class HyperframesRevisionGenerationService {
  constructor(private readonly supabase: SupabaseClient<any, "public", any>) {}

  async generate(params: {
    agentInstruction?: string;
    compositionId: string;
    createdBy: string;
    generationMode: HyperframesCompositionMode;
    organizationId: string;
    selectedAssetIds?: string[];
  }) {
    hyperframesCompositionModeSchema.parse(params.generationMode);
    const selectedAssetIds = params.selectedAssetIds
      ? [...new Set(params.selectedAssetIds)]
      : null;
    if (selectedAssetIds && selectedAssetIds.length > 250) {
      throw new HyperframesRevisionGenerationError("Selecciona entre uno y 250 assets para la composición.");
    }
    const composition = await this.getComposition(params.compositionId, params.organizationId);
    if (!composition.material_component_id) {
      throw new HyperframesRevisionGenerationError("La composición no está asociada a un componente de material.");
    }
    if (!["DRAFT", "READY_FOR_PREVIEW"].includes(composition.status)) {
      throw new HyperframesRevisionGenerationError("La composición no admite una revisión nueva en su estado actual.");
    }
    const [assets, animatedDeck] = await Promise.all([
      this.getCompositionAssets({
      assetIds: selectedAssetIds,
      componentId: composition.material_component_id,
      organizationId: params.organizationId,
      }),
      this.getAnimatedDeck(composition.material_component_id),
    ]);
    if (assets.length === 0 && !animatedDeck) {
      throw new HyperframesRevisionGenerationError("Este video todavía no tiene assets de Producción disponibles.");
    }
    const manifestInput = assets.map((asset) => ({
      checksum: asset.checksum,
      fileSizeBytes: asset.file_size_bytes,
      mimeType: asset.mime_type,
      productionAssetId: asset.id,
      storagePath: asset.storage_path,
    }));
    const parsedManifest = hyperframesAssetManifestSchema.safeParse(manifestInput);
    if (!parsedManifest.success) {
      throw new HyperframesRevisionGenerationError(describeManifestValidationFailure(assets, parsedManifest.error));
    }
    const manifest = parsedManifest.data;
    const initialPreflight = validateHyperframesPreflight({ assets: manifest });
    if (!initialPreflight.valid) {
      throw new HyperframesRevisionGenerationError(initialPreflight.errors.join(" "));
    }

    const settings = await getHyperframesGenerationSettings({
      organizationId: params.organizationId,
      supabase: this.supabase,
    });
    const planned = await generateHyperframesPlan({
      agentInstruction: params.agentInstruction,
      assetCount: assets.length,
      mode: params.generationMode,
      settings,
      title: composition.name,
    });
    const project = await buildInternalHyperframesProject({
      assets: assets.map(toProjectAsset),
      animatedDeck,
      downloadAsset: (asset) => this.downloadAsset(asset),
      plan: animatedDeck
        ? { ...planned.plan, durationSeconds: Math.min(120, Math.max(planned.plan.durationSeconds, animatedDeck.slides.length * 5)) }
        : planned.plan,
    });
    const preflight = validateHyperframesPreflight({
      archiveSizeBytes: project.archive.byteLength,
      assets: manifest,
    });
    if (!preflight.valid) {
      throw new HyperframesRevisionGenerationError(preflight.errors.join(" "));
    }
    if (project.archive.byteLength > HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES) {
      throw new HyperframesRevisionGenerationError("El proyecto generado excede el límite de 200 MiB.");
    }

    const projectPath = `hyperframes/projects/${params.organizationId}/${composition.id}/${project.projectHash}.zip`;
    const { error: uploadError } = await this.supabase.storage
      .from(PROJECT_BUCKET)
      .upload(projectPath, project.archive, { contentType: "application/zip", upsert: false });
    if (uploadError) throw uploadError;

    const revisionNumber = await this.getNextRevisionNumber(composition.id);
    const { data: revision, error: revisionError } = await this.supabase
      .from("video_composition_revisions")
      .insert({
        composition_id: composition.id,
        created_by: params.createdBy,
        entry_point: project.entryPoint,
        format: HYPERFRAMES_COMPOSITION_FORMAT,
        generation_mode: params.generationMode,
        manifest: {
          agent: {
            model: planned.model,
            source: planned.source,
            warning: planned.warning,
          },
          asset_files: project.assetFiles,
          asset_manifest: manifest,
          animated_deck: animatedDeck,
          plan: planned.plan,
          preview_html: project.previewHtml,
          preview_timeline: project.previewTimeline,
        },
        organization_id: params.organizationId,
        project_archive_size_bytes: project.archive.byteLength,
        project_hash: project.projectHash,
        project_storage_bucket: PROJECT_BUCKET,
        project_storage_path: projectPath,
        revision_number: revisionNumber,
        variables_schema: project.variablesSchema,
        variables_values: project.variablesValues,
      })
      .select("id, revision_number, project_hash, project_archive_size_bytes, created_at")
      .single();
    if (revisionError) throw revisionError;

    const { error: linkError } = await this.supabase
      .from("video_composition_assets")
      .insert(manifest.map((asset) => ({
        composition_revision_id: revision.id,
        file_size_bytes: asset.fileSizeBytes,
        mime_type: asset.mimeType,
        organization_id: params.organizationId,
        production_asset_id: asset.productionAssetId,
        role: inferAssetRole(asset.mimeType),
        source_checksum: asset.checksum,
        source_storage_path: asset.storagePath,
      })));
    if (linkError) throw linkError;

    const now = new Date().toISOString();
    const { error: compositionError } = await this.supabase
      .from("video_compositions")
      .update({ active_revision_id: revision.id, status: "READY_FOR_PREVIEW", updated_at: now })
      .eq("id", composition.id)
      .eq("organization_id", params.organizationId);
    if (compositionError) throw compositionError;

    return { ...revision, preflight, previewTimeline: project.previewTimeline, warning: planned.warning };
  }

  private async getComposition(id: string, organizationId: string) {
    const { data, error } = await this.supabase
      .from("video_compositions")
      .select("id, organization_id, artifact_id, material_component_id, name, status")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new HyperframesRevisionGenerationError("Composición HyperFrames no encontrada.", 404);
    return data as CompositionRow;
  }

  private async getCompositionAssets(params: { assetIds: string[] | null; componentId: string; organizationId: string }) {
    const { data: component, error: componentError } = await this.supabase
      .from("material_components")
      .select("assets")
      .eq("id", params.componentId)
      .maybeSingle();
    if (componentError) throw componentError;
    const activePaths = collectInternalMaterialAssetReferences(component?.assets)
      .map((reference) => reference.storagePath);
    if (activePaths.length === 0) return [];

    let query = this.supabase
      .from("production_assets")
      .select("id, checksum, file_size_bytes, mime_type, storage_bucket, storage_path, public_url, metadata")
      .eq("organization_id", params.organizationId)
      .eq("material_component_id", params.componentId)
      .eq("asset_type", "SOURCE_MEDIA")
      .in("storage_path", activePaths);
    if (params.assetIds) query = query.in("id", params.assetIds);
    const { data, error } = await query;
    if (error) throw error;
    const assets = (data || []) as AssetRow[];
    if (params.assetIds && assets.length !== params.assetIds.length) {
      throw new HyperframesRevisionGenerationError("Uno o más assets no pertenecen a esta composición.", 403);
    }
    return assets;
  }

  private async getAnimatedDeck(componentId: string) {
    const { data, error } = await this.supabase
      .from("material_components")
      .select("assets")
      .eq("id", componentId)
      .maybeSingle();
    if (error) throw error;
    return extractHyperframesAnimatedDeck(data?.assets);
  }

  private async getNextRevisionNumber(compositionId: string) {
    const { data, error } = await this.supabase
      .from("video_composition_revisions")
      .select("revision_number")
      .eq("composition_id", compositionId)
      .order("revision_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data?.revision_number || 0) + 1;
  }

  private async downloadAsset(asset: HyperframesProjectAsset) {
    const storagePath = toBucketRelativePath(asset.storageBucket, asset.storagePath);
    const { data, error } = await this.supabase.storage.from(asset.storageBucket).download(storagePath);
    if (error) throw error;
    return new Uint8Array(await data.arrayBuffer());
  }
}

function toProjectAsset(asset: AssetRow): HyperframesProjectAsset {
  if (!asset.checksum || !asset.file_size_bytes || !asset.mime_type || !asset.storage_bucket || !asset.storage_path) {
    throw new HyperframesRevisionGenerationError("Un asset seleccionado no tiene trazabilidad completa.");
  }
  return {
    checksum: asset.checksum,
    fileSizeBytes: asset.file_size_bytes,
    mimeType: asset.mime_type,
    productionAssetId: asset.id,
    publicUrl: asset.public_url,
    storageBucket: asset.storage_bucket,
    storagePath: asset.storage_path,
  };
}

function describeManifestValidationFailure(assets: AssetRow[], error: ZodError) {
  const oversizedAssets = assets.filter((asset) => (
    typeof asset.file_size_bytes === "number"
    && asset.file_size_bytes > HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES
  ));
  if (oversizedAssets.length > 0) {
    const descriptions = oversizedAssets.map((asset) => {
      const fileName = typeof asset.metadata?.file_name === "string"
        ? asset.metadata.file_name
        : asset.storage_path?.split("/").pop() || "Asset sin nombre";
      return `“${fileName}” (${formatSizeInMb(asset.file_size_bytes || 0)})`;
    });
    return `No se puede generar el preview: ${descriptions.join(", ")} excede el máximo individual de 200 MB.`;
  }
  return `No se puede generar el preview porque uno o más assets no son válidos: ${error.issues.map((issue) => issue.message).join(" ")}`;
}

function formatSizeInMb(value: number) {
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function toBucketRelativePath(bucket: string, storedPath: string) {
  const prefix = `${bucket}/`;
  const path = storedPath.startsWith(prefix) ? storedPath.slice(prefix.length) : storedPath;
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\")) {
    throw new HyperframesRevisionGenerationError("La ruta de storage de un asset es insegura.");
  }
  return path;
}

function inferAssetRole(mimeType: string) {
  if (mimeType.startsWith("video/")) return "VIDEO";
  if (mimeType.startsWith("audio/")) return "AUDIO";
  if (mimeType.startsWith("font/")) return "FONT";
  return "IMAGE";
}
