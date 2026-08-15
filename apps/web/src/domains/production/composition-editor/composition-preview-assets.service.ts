import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompositionEditorDocument } from "./composition-document.types";
import { CompositionPreviewCompilerError } from "./composition-preview-compiler.service";

export const COMPOSITION_PREVIEW_ASSET_URL_TTL_SECONDS = 60 * 60;

/** Resolves only linked assets into scoped Storage URLs renewed on every preview load. */
export async function resolveCompositionPreviewAssetUrls(params: {
  document: CompositionEditorDocument;
  draftId: string;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const assetIds = [...new Set(params.document.clips.flatMap((clip) => (
    clip.source.type === "PRODUCTION_ASSET" ? [clip.source.productionAssetId] : []
  )))];
  if (assetIds.length === 0) return new Map<string, string>();

  const { data: draftLinks, error: draftLinksError } = await params.supabase
    .from("video_composition_draft_assets")
    .select("production_asset_id")
    .eq("draft_id", params.draftId)
    .eq("organization_id", params.organizationId)
    .in("production_asset_id", assetIds);
  if (draftLinksError) throw draftLinksError;
  const linkedIds = new Set((draftLinks || []).map((link) => link.production_asset_id as string));
  const missingLinks = assetIds.filter((assetId) => !linkedIds.has(assetId));
  if (missingLinks.length > 0) {
    throw new CompositionPreviewCompilerError("La composición referencia assets que no pertenecen al borrador.");
  }

  const { data: assets, error: assetsError } = await params.supabase
    .from("production_assets")
    .select("id, storage_bucket, storage_path")
    .eq("organization_id", params.organizationId)
    .in("id", assetIds);
  if (assetsError) throw assetsError;
  const urls = new Map<string, string>();
  for (const asset of assets || []) {
    if (!asset.storage_bucket || !asset.storage_path) {
      throw new CompositionPreviewCompilerError("Un asset de la composición no tiene storage disponible.");
    }
    const { data: signed, error: signedError } = await params.supabase.storage
      .from(asset.storage_bucket)
      .createSignedUrl(
        toBucketRelativePath(asset.storage_bucket, asset.storage_path),
        COMPOSITION_PREVIEW_ASSET_URL_TTL_SECONDS,
      );
    if (signedError) throw signedError;
    urls.set(asset.id, signed.signedUrl);
  }
  if (urls.size !== assetIds.length) {
    throw new CompositionPreviewCompilerError("No se pudo resolver uno o más assets de preview.");
  }
  return urls;
}

function toBucketRelativePath(bucket: string, storedPath: string) {
  const prefix = `${bucket}/`;
  const path = storedPath.startsWith(prefix) ? storedPath.slice(prefix.length) : storedPath;
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\")) {
    throw new CompositionPreviewCompilerError("La ruta de un asset de preview es insegura.");
  }
  return path;
}
