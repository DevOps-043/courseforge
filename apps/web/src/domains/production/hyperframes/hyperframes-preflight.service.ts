import {
  HYPERFRAMES_ASSET_DELIVERY_MODES,
  HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES,
  hyperframesAssetManifestSchema,
  type HyperframesAssetDeliveryMode,
  type HyperframesAssetManifestItem,
} from "./hyperframes.types";
import { validateHyperframesMediaAsset } from "./hyperframes-media-constraints";

export interface HyperframesPreflightResult {
  archiveSizeBytes: number | null;
  assetCount: number;
  duplicateAssetCount: number;
  deliveryMode: HyperframesAssetDeliveryMode;
  errors: string[];
  totalAssetBytes: number;
  valid: boolean;
}

/**
 * Validates the immutable asset manifest before any archive is sent to HeyGen.
 * Assets with the same checksum are packaged once, so they count once against
 * the provider upload limit.
 */
export function validateHyperframesPreflight(params: {
  archiveSizeBytes?: number | null;
  assets: unknown;
  deliveryMode?: HyperframesAssetDeliveryMode;
}): HyperframesPreflightResult {
  const deliveryMode = params.deliveryMode || HYPERFRAMES_ASSET_DELIVERY_MODES.EMBEDDED;
  const parsedAssets = hyperframesAssetManifestSchema.safeParse(params.assets);
  if (!parsedAssets.success) {
    return {
      archiveSizeBytes: normalizeArchiveSize(params.archiveSizeBytes),
      assetCount: 0,
      duplicateAssetCount: 0,
      deliveryMode,
      errors: parsedAssets.error.issues.map((issue) => issue.message),
      totalAssetBytes: 0,
      valid: false,
    };
  }

  const uniqueAssets = uniqueByChecksum(parsedAssets.data);
  const totalAssetBytes = uniqueAssets.reduce((total, asset) => total + asset.fileSizeBytes, 0);
  const archiveSizeBytes = normalizeArchiveSize(params.archiveSizeBytes);
  const errors: string[] = [];

  for (const asset of uniqueAssets) {
    errors.push(...validateHyperframesMediaAsset({
      deliveryMode,
      fileName: asset.storagePath,
      fileSizeBytes: asset.fileSizeBytes,
      mimeType: asset.mimeType,
    }).errors);
  }

  if (deliveryMode === HYPERFRAMES_ASSET_DELIVERY_MODES.EMBEDDED
    && totalAssetBytes > HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES) {
    errors.push("Los assets únicos exceden el límite de 200 MiB para render cloud.");
  }

  if (params.archiveSizeBytes !== undefined && archiveSizeBytes === null) {
    errors.push("El tamaño del archivo HyperFrames debe ser un entero no negativo.");
  }

  if (archiveSizeBytes !== null && archiveSizeBytes > HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES) {
    errors.push("El archivo HyperFrames empaquetado excede el límite de 200 MiB para render cloud.");
  }

  return {
    archiveSizeBytes,
    assetCount: parsedAssets.data.length,
    duplicateAssetCount: parsedAssets.data.length - uniqueAssets.length,
    deliveryMode,
    errors,
    totalAssetBytes,
    valid: errors.length === 0,
  };
}

function uniqueByChecksum(assets: HyperframesAssetManifestItem[]) {
  const checksums = new Set<string>();
  return assets.filter((asset) => {
    const normalizedChecksum = asset.checksum.toLowerCase();
    if (checksums.has(normalizedChecksum)) return false;
    checksums.add(normalizedChecksum);
    return true;
  });
}

function normalizeArchiveSize(value: number | null | undefined) {
  if (value === undefined || value === null) return null;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
