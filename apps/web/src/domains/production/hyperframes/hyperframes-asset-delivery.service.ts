import type { SupabaseClient } from "@supabase/supabase-js";
import {
  HYPERFRAMES_SOURCE_BUCKETS,
  HYPERFRAMES_SOURCE_SIGNED_URL_TTL_SECONDS,
  PUBLIC_PRODUCTION_MEDIA_BUCKETS,
} from "../media-storage.config";
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

/** Resolves a short-lived delivery URL without persisting credentials in a revision. */
export async function resolveHyperframesAssetDeliveryUrl(params: {
  asset: HyperframesAssetManifestItem;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const bucket = params.asset.storageBucket || "production-assets";
  if (!HYPERFRAMES_SOURCE_BUCKETS.has(bucket)) {
    throw new HyperframesAssetDeliveryError(`El bucket “${bucket}” no permite entrega remota a HyperFrames.`);
  }
  const objectPath = bucketRelativePath(bucket, params.asset.storagePath);
  let deliveryUrl: string;
  if (PUBLIC_PRODUCTION_MEDIA_BUCKETS.has(bucket)) {
    const { data } = params.supabase.storage.from(bucket).getPublicUrl(objectPath);
    deliveryUrl = data.publicUrl;
  } else {
    const { data, error } = await params.supabase.storage
      .from(bucket)
      .createSignedUrl(objectPath, HYPERFRAMES_SOURCE_SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      throw new HyperframesAssetDeliveryError(
        `No se pudo autorizar temporalmente el asset remoto “${params.asset.productionAssetId}”.`,
      );
    }
    deliveryUrl = data.signedUrl;
  }
  let url: URL;
  try {
    url = new URL(deliveryUrl);
  } catch {
    throw new HyperframesAssetDeliveryError("Supabase no generó una URL válida para el asset remoto.");
  }
  if (url.protocol !== "https:") {
    throw new HyperframesAssetDeliveryError("HyperFrames requiere URLs HTTPS para descargar medios remotos.");
  }
  url.searchParams.set("v", params.asset.checksum.toLowerCase());
  return url.toString();
}

export async function resolveHyperframesAssetVariables(params: {
  assets: HyperframesAssetManifestItem[];
  supabase: SupabaseClient<any, "public", any>;
}) {
  const entries = await Promise.all(params.assets.map(async (asset) => [
    buildHyperframesAssetVariableName(asset.productionAssetId),
    await resolveHyperframesAssetDeliveryUrl({ asset, supabase: params.supabase }),
  ] as const));
  return Object.fromEntries(entries);
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
