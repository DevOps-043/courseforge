/**
 * Fase 3 — Traductor DB -> contrato de ensamblado.
 *
 * Único punto donde el shape de `material_components.assets` se mapea al
 * contrato `AssemblyInputProps` que consumen las composiciones. Mantener esta
 * traducción centralizada evita que la lógica se disperse por la UI.
 *
 * Es una función pura (sin I/O): recibe los assets ya cargados y devuelve props
 * validadas. Lanza si las props resultan inválidas (fail-fast); el caller de UI
 * debe envolver la llamada para degradar con gracia.
 */

import type { MaterialAssets } from "@/domains/materials/types/materials.types";
import {
  ASSEMBLY_FPS,
  ASSEMBLY_FALLBACK_DURATION_SECONDS,
  ASSEMBLY_TEMPLATES,
  DEFAULT_ASSEMBLY_TEMPLATE,
  parseAssemblyInputProps,
  type AssemblyInputProps,
  type AssemblyTemplate,
} from "./types";

/** Duración por defecto (segundos) de un clip de B-roll sin metadato. */
const DEFAULT_CLIP_SECONDS = 5;
/** Duración por defecto (segundos) por slide cuando no hay audio que mande. */
const DEFAULT_SLIDE_SECONDS = 5;
/** Volumen por defecto de la música si el asset no lo especifica. */
const DEFAULT_BG_MUSIC_VOLUME = 0.15;

const VALID_TEMPLATE_SLUGS = new Set<string>(Object.values(ASSEMBLY_TEMPLATES));

function secondsToFrames(seconds: number, fps: number): number {
  return Math.max(1, Math.round(seconds * fps));
}

/** Resuelve un slug arbitrario a una plantilla válida, con fallback seguro. */
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
  const a = assets ?? {};

  // Slides: solo las que tienen URL pública, en su orden de índice.
  const slides = (a.slides?.images ?? [])
    .filter((img): img is { slide_index: number; storage_path: string; public_url: string } =>
      Boolean(img?.public_url),
    )
    .map((img) => ({ index: img.slide_index, url: img.public_url }));

  // B-roll: solo clips con URL, su duración convertida a frames.
  const brollClips = (a.b_roll_clips ?? [])
    .filter((clip) => Boolean(clip?.public_url))
    .map((clip, i) => ({
      url: clip.public_url,
      durationInFrames: secondsToFrames(clip.duration ?? DEFAULT_CLIP_SECONDS, fps),
      order: clip.order ?? i + 1,
    }));

  // Duración total: la manda la locución; si no, el avatar; si no, el B-roll;
  // si no, las slides; en último caso, el fallback. Nunca 0.
  const brollTotalSeconds = brollClips.reduce(
    (sum, clip) => sum + clip.durationInFrames / fps,
    0,
  );

  let totalSeconds =
    a.voice_audio?.duration ?? a.avatar_video?.duration ?? 0;
  if (totalSeconds <= 0 && brollTotalSeconds > 0) {
    totalSeconds = brollTotalSeconds;
  }
  if (totalSeconds <= 0 && slides.length > 0) {
    totalSeconds = slides.length * DEFAULT_SLIDE_SECONDS;
  }
  if (totalSeconds <= 0) {
    totalSeconds = ASSEMBLY_FALLBACK_DURATION_SECONDS;
  }

  return parseAssemblyInputProps({
    template: resolveTemplate(templateSlug),
    fps,
    totalDurationInFrames: secondsToFrames(totalSeconds, fps),
    voiceAudioUrl: a.voice_audio?.public_url,
    bgMusicUrl: a.background_music?.public_url,
    bgMusicVolume: a.background_music?.volume_multiplier ?? DEFAULT_BG_MUSIC_VOLUME,
    avatarVideoUrl: a.avatar_video?.public_url,
    slides,
    brollClips,
    transitionType: "fade",
  });
}

/**
 * ¿Hay al menos un recurso reproducible para mostrar una preview? Evita montar
 * el Player cuando no hay absolutamente nada que ensamblar todavía.
 */
export function hasPreviewableAssets(
  assets: MaterialAssets | null | undefined,
): boolean {
  const a = assets ?? {};
  return Boolean(
    a.voice_audio?.public_url ||
      a.avatar_video?.public_url ||
      a.background_music?.public_url ||
      (a.slides?.images?.some((img) => img?.public_url) ?? false) ||
      (a.b_roll_clips?.some((clip) => clip?.public_url) ?? false),
  );
}