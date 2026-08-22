export const HYPERFRAMES_RENDER_PROFILE_IDS = [
  "preview",
  "balanced",
  "high",
] as const;

export type HyperframesRenderProfileId = typeof HYPERFRAMES_RENDER_PROFILE_IDS[number];
export type HyperframesRenderFormat = "mp4";
export type HyperframesRenderQuality = "draft" | "standard" | "high";
export type HyperframesRenderResolution = "1080p";

export type HyperframesRenderSettings = {
  format: HyperframesRenderFormat;
  fps: 24 | 25 | 30 | 60;
  quality: HyperframesRenderQuality;
  resolution: HyperframesRenderResolution;
};

export type HyperframesRenderProfile = HyperframesRenderSettings & {
  description: string;
  id: HyperframesRenderProfileId;
  label: string;
};

/**
 * Safe presets for Courseforge compositions that contain avatar footage.
 * HeyGen documents 25 FPS for avatar output. The accepted source assets are
 * capped below 2K, so exposing 4K would add cost without source detail and can
 * require an Enterprise entitlement.
 */
export const HYPERFRAMES_RENDER_PROFILES: readonly HyperframesRenderProfile[] = [
  {
    description: "Menor fidelidad para revisar composición y sincronización.",
    format: "mp4",
    fps: 25,
    id: "preview",
    label: "Borrador",
    quality: "draft",
    resolution: "1080p",
  },
  {
    description: "Equilibrio recomendado entre calidad y tiempo de procesamiento.",
    format: "mp4",
    fps: 25,
    id: "balanced",
    label: "Estándar",
    quality: "standard",
    resolution: "1080p",
  },
  {
    description: "Mayor fidelidad de codificación; puede tardar más en procesarse.",
    format: "mp4",
    fps: 25,
    id: "high",
    label: "Alta calidad",
    quality: "high",
    resolution: "1080p",
  },
] as const;

export const DEFAULT_HYPERFRAMES_RENDER_PROFILE_ID: HyperframesRenderProfileId = "balanced";

export function getHyperframesRenderProfile(
  id: HyperframesRenderProfileId,
): HyperframesRenderProfile {
  return HYPERFRAMES_RENDER_PROFILES.find((profile) => profile.id === id)
    || HYPERFRAMES_RENDER_PROFILES[1]!;
}

export function findHyperframesRenderProfile(
  settings: Partial<HyperframesRenderSettings> | null | undefined,
): HyperframesRenderProfile | null {
  if (!settings) return null;
  return HYPERFRAMES_RENDER_PROFILES.find((profile) => (
    profile.format === settings.format
    && profile.fps === settings.fps
    && profile.quality === settings.quality
    && profile.resolution === settings.resolution
  )) || null;
}

export function toHyperframesRenderSettings(
  profile: HyperframesRenderProfile,
): HyperframesRenderSettings {
  return {
    format: profile.format,
    fps: profile.fps,
    quality: profile.quality,
    resolution: profile.resolution,
  };
}

export function sameHyperframesRenderSettings(
  left: Partial<HyperframesRenderSettings> | null | undefined,
  right: Partial<HyperframesRenderSettings> | null | undefined,
) {
  return Boolean(left && right
    && left.format === right.format
    && left.fps === right.fps
    && left.quality === right.quality
    && left.resolution === right.resolution);
}
