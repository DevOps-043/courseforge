import type { MaterialAssets } from "@/domains/materials/types/materials.types";

type MediaAsset = {
  public_url?: string;
  duration?: number;
};

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function roundMeasuredDuration(seconds: number): number {
  return Math.max(1, Math.round(seconds));
}

function detectBrowserMediaDuration(url: string, kind: "audio" | "video") {
  return new Promise<number | null>((resolve) => {
    const element = document.createElement(kind);
    element.preload = "metadata";
    element.crossOrigin = "anonymous";
    element.onloadedmetadata = () => {
      const duration = element.duration;
      resolve(isPositiveFiniteNumber(duration) ? roundMeasuredDuration(duration) : null);
    };
    element.onerror = () => resolve(null);
    element.src = url;
  });
}

async function verifyAssetDuration<T extends MediaAsset>(
  asset: T | null | undefined,
  kind: "audio" | "video",
): Promise<T | null | undefined> {
  if (!asset) {
    return asset;
  }

  if (!asset.public_url) {
    const clone = { ...asset };
    delete clone.duration;
    return clone;
  }

  const measuredDuration = await detectBrowserMediaDuration(asset.public_url, kind);
  if (measuredDuration) {
    return {
      ...asset,
      duration: measuredDuration,
    };
  }

  const clone = { ...asset };
  delete clone.duration;
  return clone;
}

export async function verifyBrowserMediaDurationsFromUrls(
  assets: MaterialAssets | null | undefined,
): Promise<MaterialAssets | null | undefined> {
  if (!assets) {
    return assets;
  }

  const verifiedAssets: MaterialAssets = { ...assets };

  verifiedAssets.voice_audio = await verifyAssetDuration(
    assets.voice_audio,
    "audio",
  ) as MaterialAssets["voice_audio"];

  if (Array.isArray(assets.voice_clips)) {
    verifiedAssets.voice_clips = await Promise.all(
      assets.voice_clips.map((clip) => verifyAssetDuration(clip, "audio")),
    ) as MaterialAssets["voice_clips"];
  }

  verifiedAssets.avatar_video = await verifyAssetDuration(
    assets.avatar_video,
    "video",
  ) as MaterialAssets["avatar_video"];

  if (Array.isArray(assets.b_roll_clips)) {
    verifiedAssets.b_roll_clips = await Promise.all(
      assets.b_roll_clips.map((clip) => verifyAssetDuration(clip, "video")),
    ) as MaterialAssets["b_roll_clips"];
  }

  return verifiedAssets;
}
