import type { SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_PRODUCTION_MEDIA_BUCKETS } from "../media-storage.config";
import type { HyperframesAssetManifestItem } from "./hyperframes.types";

const ASSET_VARIABLE_PREFIX = "cf_asset_";

export class HyperframesAssetDeliveryError extends Error {}

/**
 * Produces a stable provider variable name without persisting a temporary URL.
 * The UUID is already immutable within a snapshot and the prefix reserves a
 * namespace that cannot collide with author-defined composition variables.
 */
export function buildHyperframesAssetVariableName(productionAssetId: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(productionAssetId)) {
    throw new HyperframesAssetDeliveryError("El identificador del asset remoto no es válido.");
  }
  return `${ASSET_VARIABLE_PREFIX}${productionAssetId.replaceAll("-", "")}`;
}

export function buildHyperframesAssetVariableNames(assets: HyperframesAssetManifestItem[]) {
  return new Map(assets.map((asset) => [
    asset.productionAssetId,
    buildHyperframesAssetVariableName(asset.productionAssetId),
  ]));
}

/** Resolves public, content-versioned URLs only from trusted Storage identity. */
export function resolveHyperframesAssetDeliveryUrl(params: {
  asset: HyperframesAssetManifestItem;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const bucket = params.asset.storageBucket || "production-assets";
  if (!PUBLIC_PRODUCTION_MEDIA_BUCKETS.has(bucket)) {
    throw new HyperframesAssetDeliveryError(`El bucket “${bucket}” no permite entrega remota a HyperFrames.`);
  }
  const objectPath = bucketRelativePath(bucket, params.asset.storagePath);
  const { data } = params.supabase.storage.from(bucket).getPublicUrl(objectPath);
  let url: URL;
  try {
    url = new URL(data.publicUrl);
  } catch {
    throw new HyperframesAssetDeliveryError("Supabase no generó una URL válida para el asset remoto.");
  }
  if (url.protocol !== "https:") {
    throw new HyperframesAssetDeliveryError("HyperFrames requiere URLs HTTPS para descargar medios remotos.");
  }
  url.searchParams.set("v", params.asset.checksum.toLowerCase());
  return url.toString();
}

export function resolveHyperframesAssetVariables(params: {
  assets: HyperframesAssetManifestItem[];
  supabase: SupabaseClient<any, "public", any>;
}) {
  return Object.fromEntries(params.assets.map((asset) => [
    buildHyperframesAssetVariableName(asset.productionAssetId),
    resolveHyperframesAssetDeliveryUrl({ asset, supabase: params.supabase }),
  ]));
}

export function buildHyperframesAssetVariableSchema(assets: HyperframesAssetManifestItem[]) {
  return assets.map((asset) => ({
    default: "",
    id: buildHyperframesAssetVariableName(asset.productionAssetId),
    label: `Asset ${asset.productionAssetId}`,
    type: "string",
  }));
}

function bucketRelativePath(bucket: string, storagePath: string) {
  const path = storagePath.startsWith(`${bucket}/`)
    ? storagePath.slice(bucket.length + 1)
    : storagePath;
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\")) {
    throw new HyperframesAssetDeliveryError("La ruta del asset remoto no es segura.");
  }
  return path;
}
