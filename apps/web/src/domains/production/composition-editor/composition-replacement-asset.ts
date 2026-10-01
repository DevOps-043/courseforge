import { HYPERFRAMES_SOURCE_BUCKETS } from "../media-storage.config";
import { validateHyperframesMediaAsset } from "../hyperframes/hyperframes-media-constraints";
import { HYPERFRAMES_ASSET_DELIVERY_MODES, hyperframesAssetManifestItemSchema } from "../hyperframes/hyperframes.types";
import { PRODUCTION_QA_STATUSES } from "../types/production.types";

export interface CompositionReplacementAssetRecord {
  checksum: string | null;
  file_size_bytes: number | null;
  id: string;
  metadata: Record<string, unknown> | null;
  mime_type: string | null;
  qa_status: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
}

/** Applies the same media delivery limits at the API boundary as the editor's asset catalog. */
export function isUsableCompositionReplacementAsset(asset: CompositionReplacementAssetRecord): boolean {
  if (asset.qa_status === PRODUCTION_QA_STATUSES.ARCHIVED || asset.qa_status === PRODUCTION_QA_STATUSES.REJECTED) return false;
  if (!asset.storage_bucket || !HYPERFRAMES_SOURCE_BUCKETS.has(asset.storage_bucket)) return false;
  const manifest = hyperframesAssetManifestItemSchema.safeParse({
    checksum: asset.checksum,
    fileSizeBytes: asset.file_size_bytes,
    mimeType: asset.mime_type,
    productionAssetId: asset.id,
    storageBucket: asset.storage_bucket,
    storagePath: asset.storage_path,
  });
  if (!manifest.success) return false;
  const metadata = asset.metadata || {};
  const fileName = typeof metadata.file_name === "string" ? metadata.file_name : asset.storage_path?.split("/").pop();
  return validateHyperframesMediaAsset({
    deliveryMode: HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES,
    fileName,
    fileSizeBytes: asset.file_size_bytes,
    height: typeof metadata.source_height === "number" ? metadata.source_height : null,
    mimeType: asset.mime_type,
    width: typeof metadata.source_width === "number" ? metadata.source_width : null,
  }).valid;
}

export function replacementAssetStoragePath(asset: CompositionReplacementAssetRecord): string {
  if (!isUsableCompositionReplacementAsset(asset)) throw new Error("COMPOSITION_REPLACEMENT_ASSET_INVALID");
  const prefix = `${asset.storage_bucket}/`;
  return asset.storage_path!.startsWith(prefix) ? asset.storage_path!.slice(prefix.length) : asset.storage_path!;
}
