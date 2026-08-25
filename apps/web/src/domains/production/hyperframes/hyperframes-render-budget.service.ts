import { HYPERFRAMES_REMOTE_VIDEO_LIMIT_BYTES } from "./hyperframes.types";
import type { HyperframesRenderSettings } from "./hyperframes-render-profiles";

const MEBIBYTE = 1024 * 1024;
const RECOMMENDED_SEGMENT_SECONDS = 10 * 60;
const RECOMMENDED_SEGMENT_BYTES = 1536 * MEBIBYTE;
const CONTAINER_OVERHEAD_FACTOR = 1.08;

const VIDEO_BITRATE_BITS_PER_SECOND: Record<HyperframesRenderSettings["quality"], number> = {
  draft: 3_500_000,
  high: 14_000_000,
  standard: 8_000_000,
};

export type HyperframesRenderBudget = {
  estimatedOutputBytes: number;
  hardLimitBytes: number;
  recommendedSegmentCount: number;
  recommendedSegmentSeconds: number;
  requiresSegmentation: boolean;
  utilizationRatio: number;
};

/** Conservative planning estimate; the provider's final encoder can vary by scene complexity. */
export function estimateHyperframesRenderBudget(params: {
  durationSeconds: number;
  renderProfile: HyperframesRenderSettings;
}): HyperframesRenderBudget {
  const durationSeconds = Math.max(0, params.durationSeconds);
  const bitrate = VIDEO_BITRATE_BITS_PER_SECOND[params.renderProfile.quality];
  const estimatedOutputBytes = Math.ceil((durationSeconds * bitrate / 8) * CONTAINER_OVERHEAD_FACTOR);
  const secondsBySize = Math.max(
    1,
    Math.floor((RECOMMENDED_SEGMENT_BYTES * 8) / (bitrate * CONTAINER_OVERHEAD_FACTOR)),
  );
  const recommendedSegmentSeconds = Math.min(RECOMMENDED_SEGMENT_SECONDS, secondsBySize);
  const recommendedSegmentCount = Math.max(1, Math.ceil(durationSeconds / recommendedSegmentSeconds));

  return {
    estimatedOutputBytes,
    hardLimitBytes: HYPERFRAMES_REMOTE_VIDEO_LIMIT_BYTES,
    recommendedSegmentCount,
    recommendedSegmentSeconds,
    requiresSegmentation: estimatedOutputBytes > HYPERFRAMES_REMOTE_VIDEO_LIMIT_BYTES,
    utilizationRatio: estimatedOutputBytes / HYPERFRAMES_REMOTE_VIDEO_LIMIT_BYTES,
  };
}

export function formatRenderBudgetBytes(bytes: number) {
  if (bytes >= 1024 * MEBIBYTE) return `${(bytes / (1024 * MEBIBYTE)).toFixed(2)} GiB`;
  return `${Math.ceil(bytes / MEBIBYTE)} MiB`;
}
