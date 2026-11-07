export const HYPERFRAMES_RENDER_PROFILE_IDS = [
  "preview",
  "balanced",
  "high",
  "preview-24",
  "high-4k",
  "mov-editing",
] as const;

export type HyperframesRenderProfileId = typeof HYPERFRAMES_RENDER_PROFILE_IDS[number];
export const HYPERFRAMES_RENDER_FORMATS = ["mp4", "mov"] as const;
export const HYPERFRAMES_RENDER_RESOLUTIONS = ["1080p", "4k"] as const;
export type HyperframesRenderFormat = typeof HYPERFRAMES_RENDER_FORMATS[number];
export type HyperframesRenderQuality = "draft" | "standard" | "high";
export type HyperframesRenderResolution = typeof HYPERFRAMES_RENDER_RESOLUTIONS[number];

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

/** Perfiles de salida. El perfil Estándar conserva la cadencia del lienzo editorial. */
export const HYPERFRAMES_RENDER_PROFILES: readonly HyperframesRenderProfile[] = [
  {
    description: "Menor fidelidad para revisar composición y sincronización.",
    format: "mp4",
    fps: 24,
    id: "preview-24",
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
    description: "Salida 4K con mayor tiempo y costo de render en HeyGen.",
    format: "mp4",
    fps: 30,
    id: "high-4k",
    label: "Alta calidad",
    quality: "high",
    resolution: "4k",
  },
  {
    description: "Archivo para edición externa. Puede ocupar mucho más espacio que MP4.",
    format: "mov",
    fps: 25,
    id: "mov-editing",
    label: "MOV para edición",
    quality: "high",
    resolution: "1080p",
  },
] as const;

export const DEFAULT_HYPERFRAMES_RENDER_PROFILE_ID: HyperframesRenderProfileId = "balanced";

const ALL_RENDER_PROFILES: readonly HyperframesRenderProfile[] = [
  ...HYPERFRAMES_RENDER_PROFILES,
  { ...HYPERFRAMES_RENDER_PROFILES[0]!, id: "preview", fps: 25, label: "Borrador anterior" },
  { ...HYPERFRAMES_RENDER_PROFILES[2]!, id: "high", fps: 25, resolution: "1080p",
    label: "Alta calidad anterior", description: "Perfil histórico conservado para esta revisión." },
];

export function getHyperframesRenderProfile(
  id: HyperframesRenderProfileId,
): HyperframesRenderProfile {
  return ALL_RENDER_PROFILES.find((profile) => profile.id === id)
    || HYPERFRAMES_RENDER_PROFILES[1]!;
}

export function findHyperframesRenderProfile(
  settings: Partial<HyperframesRenderSettings> | null | undefined,
): HyperframesRenderProfile | null {
  if (!settings) return null;
  return ALL_RENDER_PROFILES.find((profile) => (
    profile.format === settings.format
    && profile.fps === settings.fps
    && profile.quality === settings.quality
    && profile.resolution === settings.resolution
  )) || null;
}

export function toHyperframesRenderSettings(
  profile: HyperframesRenderSettings,
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
