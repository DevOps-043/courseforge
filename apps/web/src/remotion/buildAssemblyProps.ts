/**
 * Fase 7 - Traductor DB -> contrato de ensamblado.
 *
 * Este archivo mantiene la API publica usada por la preview, pero delega la
 * normalizacion de assets a `assembly-assets.normalizer.ts`. Asi evitamos que
 * reglas de orden, duracion y readiness queden dispersas en la UI.
 */

import type { MaterialAssets } from "@/domains/materials/types/materials.types";
import {
  getAssemblyAssetReadiness,
  normalizeAssemblyAssets,
} from "./assembly-assets.normalizer";
import {
  ASSEMBLY_FALLBACK_DURATION_SECONDS,
  ASSEMBLY_FPS,
  ASSEMBLY_TEMPLATES,
  DEFAULT_ASSEMBLY_TEMPLATE,
  parseAssemblyInputProps,
  type AssemblyInputProps,
  type AssemblyTemplate,
} from "./types";
import { parseTemplateRenderConfig } from "./template-config";
import { parseLayoutOverrideManifests } from "./layout-overrides";
import {
  normalizeTimelineOverrideManifestsForDuration,
  parseTimelineOverrideManifests,
  type TimelineOverrideManifestList,
} from "./timeline-overrides";
import { durationSecondsToFrames } from "./media-duration";

const VALID_TEMPLATE_SLUGS = new Set<string>(Object.values(ASSEMBLY_TEMPLATES));

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function resolveTemplate(slug: string | null | undefined): AssemblyTemplate {
  if (slug && VALID_TEMPLATE_SLUGS.has(slug)) {
    return slug as AssemblyTemplate;
  }

  return DEFAULT_ASSEMBLY_TEMPLATE;
}

function resolveTimelineOverrideDurationSeconds(params: {
  timelineOverrides: TimelineOverrideManifestList;
  template: AssemblyTemplate;
}) {
  const matchingManifests = params.timelineOverrides.filter(
    (manifest) => !manifest.templateId || manifest.templateId === params.template,
  );

  for (let index = matchingManifests.length - 1; index >= 0; index -= 1) {
    const manifest = matchingManifests[index];
    const timelineFps = manifest.timeline.fps;
    const durationInFrames = manifest.timeline.durationInFrames;
    if (isPositiveNumber(timelineFps) && isPositiveNumber(durationInFrames)) {
      return durationInFrames / timelineFps;
    }
  }

  return 0;
}

/**
 * Resuelve la duracion total del ensamblado.
 *
 * Prioridad: la duracion real medida de los assets (voz/avatar/b-roll/slides)
 * SIEMPRE gana cuando existe. `assembly_target_duration_seconds` es un legado de
 * una estimacion de guion (Fase 5) sin escritor vigente en el codigo actual; solo
 * se usa como ultimo recurso cuando ningun asset tiene duracion medible, para no
 * dejar caer el video a un fallback generico de 10s.
 */
export function resolveAssemblyDurationSeconds(params: {
  assets: MaterialAssets | null | undefined;
  normalizedDurationSeconds: number;
  timelineOverrides: TimelineOverrideManifestList;
  template: AssemblyTemplate;
}) {
  if (params.normalizedDurationSeconds > 0) {
    return params.normalizedDurationSeconds;
  }

  const targetDurationSeconds = params.assets?.assembly_target_duration_seconds;
  if (isPositiveNumber(targetDurationSeconds)) {
    return targetDurationSeconds;
  }

  const timelineDurationSeconds = resolveTimelineOverrideDurationSeconds({
    timelineOverrides: params.timelineOverrides,
    template: params.template,
  });
  if (timelineDurationSeconds > 0) {
    return timelineDurationSeconds;
  }

  return ASSEMBLY_FALLBACK_DURATION_SECONDS;
}

export function buildAssemblyProps(
  assets: MaterialAssets | null | undefined,
  templateSlug: string | null | undefined,
  templateConfigInput: unknown = {},
  layoutOverridesInput: unknown = [],
  timelineOverridesInput: unknown = assets?.timeline_overrides ?? [],
  fps: number = ASSEMBLY_FPS,
): AssemblyInputProps {
  const normalized = normalizeAssemblyAssets(assets, fps);
  const template = resolveTemplate(templateSlug);
  const templateConfig = parseTemplateRenderConfig(templateConfigInput);
  const layoutOverrides = parseLayoutOverrideManifests(layoutOverridesInput);
  const timelineOverrides = parseTimelineOverrideManifests(timelineOverridesInput);
  const totalSeconds = resolveAssemblyDurationSeconds({
    assets,
    normalizedDurationSeconds: normalized.totalDurationSeconds,
    timelineOverrides,
    template,
  });
  const totalDurationInFrames = durationSecondsToFrames(totalSeconds, fps);
  const normalizedTimelineOverrides = normalizeTimelineOverrideManifestsForDuration({
    manifests: timelineOverrides,
    durationInFrames: totalDurationInFrames,
    fps,
  });

  return parseAssemblyInputProps({
    template,
    fps,
    totalDurationInFrames,
    voiceAudioUrl: normalized.voiceAudioUrl,
    voiceClips: normalized.voiceClips,
    bgMusicUrl: normalized.bgMusicUrl,
    bgMusicVolume: normalized.bgMusicVolume,
    avatarVideoUrl: normalized.avatarVideoUrl,
    avatarClips: normalized.avatarClips,
    slides: normalized.slides,
    deckCss: normalized.deckCss,
    deckFonts: normalized.deckFonts,
    brollClips: normalized.brollClips,
    transitionType: templateConfig.transitionType,
    templateConfig,
    layoutOverrides,
    timelineOverrides: normalizedTimelineOverrides,
  });
}

/**
 * Hay algo que vale la pena mostrar en el panel de preview: puede ser un asset
 * renderizable o una referencia que requiere una accion clara (por ejemplo,
 * slides HTML aun no rasterizadas).
 */
export function hasPreviewableAssets(
  assets: MaterialAssets | null | undefined,
): boolean {
  return getAssemblyAssetReadiness(
    assets,
    ASSEMBLY_FPS,
  ).hasAnyAssetReference;
}
