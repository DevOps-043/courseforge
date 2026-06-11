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

const VALID_TEMPLATE_SLUGS = new Set<string>(Object.values(ASSEMBLY_TEMPLATES));

function secondsToFrames(seconds: number, fps: number): number {
  return Math.max(1, Math.round(seconds * fps));
}

function resolveTemplate(slug: string | null | undefined): AssemblyTemplate {
  if (slug && VALID_TEMPLATE_SLUGS.has(slug)) {
    return slug as AssemblyTemplate;
  }

  return DEFAULT_ASSEMBLY_TEMPLATE;
}

export function buildAssemblyProps(
  assets: MaterialAssets | null | undefined,
  templateSlug: string | null | undefined,
  fps: number = ASSEMBLY_FPS,
): AssemblyInputProps {
  const normalized = normalizeAssemblyAssets(assets, fps);
  const totalSeconds =
    normalized.totalDurationSeconds > 0
      ? normalized.totalDurationSeconds
      : ASSEMBLY_FALLBACK_DURATION_SECONDS;

  return parseAssemblyInputProps({
    template: resolveTemplate(templateSlug),
    fps,
    totalDurationInFrames: secondsToFrames(totalSeconds, fps),
    voiceAudioUrl: normalized.voiceAudioUrl,
    bgMusicUrl: normalized.bgMusicUrl,
    bgMusicVolume: normalized.bgMusicVolume,
    avatarVideoUrl: normalized.avatarVideoUrl,
    slides: normalized.slides,
    brollClips: normalized.brollClips,
    transitionType: "fade",
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
