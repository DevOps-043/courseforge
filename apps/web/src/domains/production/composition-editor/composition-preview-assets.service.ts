import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompositionEditorDocument } from "./composition-document.types";
import { CompositionPreviewCompilerError } from "./composition-preview-compiler.service";
import { PUBLIC_PRODUCTION_MEDIA_BUCKETS } from "../media-storage.config";
import {
  elapsedMilliseconds,
  type CompositionPreviewAssetDiagnostics,
} from "./composition-preview-performance";

export const COMPOSITION_PREVIEW_ASSET_URL_TTL_SECONDS = 60 * 60;
export const COMPOSITION_PREVIEW_SIGNING_CONCURRENCY = 6;
export const COMPOSITION_PREVIEW_PUBLIC_BUCKETS = PUBLIC_PRODUCTION_MEDIA_BUCKETS;

/** Resolves only linked assets into scoped Storage URLs renewed on every preview load. */
export async function resolveCompositionPreviewAssetUrls(params: {
  document: CompositionEditorDocument;
  draftId: string;
  onDiagnostics?: (diagnostics: CompositionPreviewAssetDiagnostics) => void;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const productionAssetIds = [...new Set(params.document.clips.flatMap((clip) => (
    clip.source.type === "PRODUCTION_ASSET" ? [clip.source.productionAssetId] : []
  )))];
  const brandingAssetIds = [...new Set(params.document.clips.flatMap((clip) => (
    clip.source.type === "ASSEMBLY_BRAND_ASSET" ? [clip.source.assemblyBrandAssetId] : []
  )))];
  const assetIds = [...productionAssetIds, ...brandingAssetIds];
  if (assetIds.length === 0) {
    params.onDiagnostics?.({
      assetCount: 0,
      assetQueryMs: 0,
      draftLinkQueryMs: 0,
      privateAssetCount: 0,
      publicAssetCount: 0,
      signingMs: 0,
    });
    return new Map<string, string>();
  }

  const draftLinkQueryStartedAt = performance.now();
  const [{ data: draftLinks, error: draftLinksError }, { data: draftBranding, error: draftBrandingError }] = await Promise.all([
    productionAssetIds.length > 0
      ? params.supabase.from("video_composition_draft_assets").select("production_asset_id").eq("draft_id", params.draftId).eq("organization_id", params.organizationId).in("production_asset_id", productionAssetIds)
      : Promise.resolve({ data: [], error: null }),
    brandingAssetIds.length > 0
      ? params.supabase.from("video_composition_draft_branding").select("intro_asset_id, outro_asset_id").eq("draft_id", params.draftId).eq("organization_id", params.organizationId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (draftLinksError) throw draftLinksError;
  if (draftBrandingError) throw draftBrandingError;
  const draftLinkQueryMs = elapsedMilliseconds(draftLinkQueryStartedAt);
  const linkedIds = new Set((draftLinks || []).map((link) => link.production_asset_id as string));
  const brandingLinks = new Set([draftBranding?.intro_asset_id, draftBranding?.outro_asset_id].filter((id): id is string => typeof id === "string"));
  const missingLinks = productionAssetIds.filter((assetId) => !linkedIds.has(assetId));
  const missingBrandingLinks = brandingAssetIds.filter((assetId) => !brandingLinks.has(assetId));
  if (missingLinks.length > 0 || missingBrandingLinks.length > 0) {
    throw new CompositionPreviewCompilerError("La composición referencia assets que no pertenecen al borrador.");
  }

  const assetQueryStartedAt = performance.now();
  const [{ data: productionAssets, error: assetsError }, { data: brandingAssets, error: brandingAssetsError }] = await Promise.all([
    productionAssetIds.length > 0
      ? params.supabase.from("production_assets").select("id, checksum, storage_bucket, storage_path").eq("organization_id", params.organizationId).in("id", productionAssetIds)
      : Promise.resolve({ data: [], error: null }),
    brandingAssetIds.length > 0
      ? params.supabase.from("organization_assembly_assets").select("id, checksum, storage_bucket, storage_path").eq("organization_id", params.organizationId).in("status", ["APPROVED", "ARCHIVED"]).in("id", brandingAssetIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (assetsError) throw assetsError;
  if (brandingAssetsError) throw brandingAssetsError;
  const assetQueryMs = elapsedMilliseconds(assetQueryStartedAt);
  const urls = new Map<string, string>();
  const storedAssets = [...(productionAssets || []), ...(brandingAssets || [])];
  const privateAssets = [];
  for (const asset of storedAssets) {
    if (!asset.storage_bucket || !asset.storage_path) {
      throw new CompositionPreviewCompilerError("Un asset de la composición no tiene storage disponible.");
    }
    const storagePath = toBucketRelativePath(asset.storage_bucket, asset.storage_path);
    if (COMPOSITION_PREVIEW_PUBLIC_BUCKETS.has(asset.storage_bucket)) {
      const rawPublicUrl = params.supabase.storage.from(asset.storage_bucket).getPublicUrl(storagePath).data.publicUrl;
      assertSafeStorageUrl(rawPublicUrl);
      const publicUrl = withContentVersion(
        rawPublicUrl,
        asset.checksum,
      );
      urls.set(asset.id, publicUrl);
      continue;
    }
    privateAssets.push({ ...asset, storagePath });
  }
  const signingStartedAt = performance.now();
  for (let offset = 0; offset < privateAssets.length; offset += COMPOSITION_PREVIEW_SIGNING_CONCURRENCY) {
    const batch = privateAssets.slice(offset, offset + COMPOSITION_PREVIEW_SIGNING_CONCURRENCY);
    const signedAssets = await Promise.all(batch.map(async (asset) => {
      const { data: signed, error: signedError } = await params.supabase.storage
        .from(asset.storage_bucket)
        .createSignedUrl(
          asset.storagePath,
          COMPOSITION_PREVIEW_ASSET_URL_TTL_SECONDS,
        );
      if (signedError) throw signedError;
      assertSafeStorageUrl(signed.signedUrl);
      return [asset.id, signed.signedUrl] as const;
    }));
    signedAssets.forEach(([assetId, signedUrl]) => urls.set(assetId, signedUrl));
  }
  if (urls.size !== assetIds.length) {
    throw new CompositionPreviewCompilerError("No se pudo resolver uno o más assets de preview.");
  }
  params.onDiagnostics?.({
    assetCount: assetIds.length,
    assetQueryMs,
    draftLinkQueryMs,
    privateAssetCount: privateAssets.length,
    publicAssetCount: storedAssets.length - privateAssets.length,
    signingMs: elapsedMilliseconds(signingStartedAt),
  });
  return urls;
}

function assertSafeStorageUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new CompositionPreviewCompilerError("Storage devolvió una URL de preview inválida.");
  }
  const isLocalDevelopmentUrl = url.protocol === "http:"
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !isLocalDevelopmentUrl) {
    throw new CompositionPreviewCompilerError("La URL de un asset de preview debe usar HTTPS.");
  }
}

function withContentVersion(rawUrl: string, checksum: unknown) {
  if (typeof checksum !== "string" || !/^[a-f0-9]{64}$/i.test(checksum)) return rawUrl;
  const url = new URL(rawUrl);
  url.searchParams.set("v", checksum.toLowerCase());
  return url.toString();
}

function toBucketRelativePath(bucket: string, storedPath: string) {
  const prefix = `${bucket}/`;
  const path = storedPath.startsWith(prefix) ? storedPath.slice(prefix.length) : storedPath;
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\")) {
    throw new CompositionPreviewCompilerError("La ruta de un asset de preview es insegura.");
  }
  return path;
}
