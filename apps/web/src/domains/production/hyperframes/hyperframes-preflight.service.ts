import {
  HYPERFRAMES_ASSET_DELIVERY_MODES,
  HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES,
  hyperframesAssetManifestSchema,
  type HyperframesAssetDeliveryMode,
  type HyperframesAssetManifestItem,
} from "./hyperframes.types";
import { validateHyperframesMediaAsset } from "./hyperframes-media-constraints";
import {
  estimateHyperframesRenderBudget,
  formatRenderBudgetBytes,
  type HyperframesRenderBudget,
} from "./hyperframes-render-budget.service";
import type { HyperframesRenderSettings } from "./hyperframes-render-profiles";

export interface HyperframesPreflightResult {
  archiveSizeBytes: number | null;
  assetCount: number;
  duplicateAssetCount: number;
  deliveryMode: HyperframesAssetDeliveryMode;
  errors: string[];
  renderBudget: HyperframesRenderBudget | null;
  totalAssetBytes: number;
  valid: boolean;
  warnings: string[];
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
  durationSeconds?: number | null;
  renderProfile?: HyperframesRenderSettings | null;
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
      renderBudget: null,
      totalAssetBytes: 0,
      valid: false,
      warnings: [],
    };
  }

  const uniqueAssets = uniqueByChecksum(parsedAssets.data);
  const totalAssetBytes = uniqueAssets.reduce((total, asset) => total + asset.fileSizeBytes, 0);
  const archiveSizeBytes = normalizeArchiveSize(params.archiveSizeBytes);
  const errors: string[] = [];
  const warnings: string[] = [];
  const renderBudget = validRenderBudgetInput(params.durationSeconds, params.renderProfile)
    ? estimateHyperframesRenderBudget({
        durationSeconds: params.durationSeconds!,
        renderProfile: params.renderProfile!,
      })
    : null;

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

  if (renderBudget?.requiresSegmentation) {
    errors.push(
      `La salida estimada (${formatRenderBudgetBytes(renderBudget.estimatedOutputBytes)}) excede el límite de 2 GiB. Divide la composición en al menos ${renderBudget.recommendedSegmentCount} segmentos.`,
    );
  } else if (renderBudget && renderBudget.recommendedSegmentCount > 1) {
    warnings.push(
      `Para reducir reintentos, se recomienda dividir esta composición en ${renderBudget.recommendedSegmentCount} segmentos de hasta ${Math.floor(renderBudget.recommendedSegmentSeconds / 60)} min.`,
    );
  }

  return {
    archiveSizeBytes,
    assetCount: parsedAssets.data.length,
    duplicateAssetCount: parsedAssets.data.length - uniqueAssets.length,
    deliveryMode,
    errors,
    renderBudget,
    totalAssetBytes,
    valid: errors.length === 0,
    warnings,
  };
}

function validRenderBudgetInput(
  durationSeconds: number | null | undefined,
  renderProfile: HyperframesRenderSettings | null | undefined,
): renderProfile is HyperframesRenderSettings {
  return typeof durationSeconds === "number"
    && Number.isFinite(durationSeconds)
    && durationSeconds > 0
    && Boolean(renderProfile);
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
