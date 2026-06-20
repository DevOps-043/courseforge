import type { MaterialAssets } from "@/domains/materials/types/materials.types";
import type { AssemblyBrollClip, AssemblySlide } from "./types";

const DEFAULT_CLIP_SECONDS = 5;
const DEFAULT_SLIDE_SECONDS = 5;
const DEFAULT_BG_MUSIC_VOLUME = 0.15;

export type AssemblyAssetWarningCode =
  | "SLIDES_REFERENCE_NOT_RENDERIZABLE"
  | "NO_RENDERABLE_VISUAL_ASSETS";

export interface AssemblyAssetWarning {
  code: AssemblyAssetWarningCode;
  message: string;
}

export interface NormalizedAssemblyAssets {
  voiceAudioUrl?: string;
  bgMusicUrl?: string;
  bgMusicVolume: number;
  avatarVideoUrl?: string;
  slides: AssemblySlide[];
  brollClips: AssemblyBrollClip[];
  totalDurationSeconds: number;
  warnings: AssemblyAssetWarning[];
}

export interface AssemblyAssetReadiness {
  hasAnyAssetReference: boolean;
  hasRenderableAssets: boolean;
  hasRenderableVisualAssets: boolean;
  warnings: AssemblyAssetWarning[];
}

function secondsToFrames(seconds: number, fps: number): number {
  return Math.max(1, Math.round(seconds * fps));
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function hasSlideReference(assets: MaterialAssets): boolean {
  return Boolean(
    assets.slides_url ||
      assets.slides?.html_public_url ||
      assets.slides?.html_content_path ||
      assets.slides?.open_design_project_id,
  );
}

function buildWarnings(params: {
  assets: MaterialAssets;
  slides: AssemblySlide[];
  brollClips: AssemblyBrollClip[];
}) {
  const warnings: AssemblyAssetWarning[] = [];
  const hasNonRenderableSlides =
    hasSlideReference(params.assets) && params.slides.length === 0;

  if (hasNonRenderableSlides) {
    warnings.push({
      code: "SLIDES_REFERENCE_NOT_RENDERIZABLE",
      message:
        "Hay slides cargadas como referencia, pero todavia no existen imagenes renderizables para Remotion.",
    });
  }

  if (params.slides.length === 0 && params.brollClips.length === 0) {
    warnings.push({
      code: "NO_RENDERABLE_VISUAL_ASSETS",
      message:
        "No hay recursos visuales renderizables; Remotion usara audio/avatar o un fondo neutro.",
    });
  }

  return warnings;
}

export function normalizeAssemblyAssets(
  assets: MaterialAssets | null | undefined,
  fps: number,
): NormalizedAssemblyAssets {
  const a = assets ?? {};

  const slides = (a.slides?.images ?? [])
    .filter((img) => Boolean(img?.public_url))
    .map((img) => ({ index: img.slide_index, url: img.public_url }))
    .sort((left, right) => left.index - right.index);

  const brollClips = (a.b_roll_clips ?? [])
    .filter((clip) => Boolean(clip?.public_url))
    .map((clip, index) => ({
      url: clip.public_url,
      durationInFrames: secondsToFrames(
        isPositiveNumber(clip.duration) ? clip.duration : DEFAULT_CLIP_SECONDS,
        fps,
      ),
      order: isPositiveNumber(clip.order) ? clip.order : index + 1,
      originalIndex: index,
    }))
    .sort(
      (left, right) =>
        left.order - right.order || left.originalIndex - right.originalIndex,
    )
    .map(({ originalIndex: _originalIndex, ...clip }) => clip);

  const brollTotalSeconds = brollClips.reduce(
    (sum, clip) => sum + clip.durationInFrames / fps,
    0,
  );

  const primaryMediaDurationSeconds = isPositiveNumber(a.voice_audio?.duration)
    ? a.voice_audio.duration
    : isPositiveNumber(a.avatar_video?.duration)
      ? a.avatar_video.duration
      : 0;
  const targetDurationSeconds = isPositiveNumber(a.assembly_target_duration_seconds)
    ? a.assembly_target_duration_seconds
    : 0;

  let totalDurationSeconds = primaryMediaDurationSeconds;

  if (targetDurationSeconds > 0) {
    totalDurationSeconds =
      primaryMediaDurationSeconds > 0
        ? Math.max(primaryMediaDurationSeconds, targetDurationSeconds)
        : targetDurationSeconds;
  } else if (totalDurationSeconds <= 0 && brollTotalSeconds > 0) {
    totalDurationSeconds = brollTotalSeconds;
  } else if (totalDurationSeconds <= 0 && slides.length > 0) {
    totalDurationSeconds = slides.length * DEFAULT_SLIDE_SECONDS;
  }

  const warnings = buildWarnings({ assets: a, slides, brollClips });

  return {
    voiceAudioUrl: a.voice_audio?.public_url || undefined,
    bgMusicUrl: a.background_music?.public_url || undefined,
    bgMusicVolume: a.background_music?.volume_multiplier ?? DEFAULT_BG_MUSIC_VOLUME,
    avatarVideoUrl: a.avatar_video?.public_url || undefined,
    slides,
    brollClips,
    totalDurationSeconds,
    warnings,
  };
}

export function getAssemblyAssetReadiness(
  assets: MaterialAssets | null | undefined,
  fps: number,
): AssemblyAssetReadiness {
  const a = assets ?? {};
  const normalized = normalizeAssemblyAssets(a, fps);
  const hasRenderableVisualAssets =
    normalized.slides.length > 0 || normalized.brollClips.length > 0;
  const hasRenderableAssets = Boolean(
    normalized.voiceAudioUrl ||
      normalized.avatarVideoUrl ||
      normalized.bgMusicUrl ||
      hasRenderableVisualAssets,
  );
  const hasAnyAssetReference = Boolean(
    hasRenderableAssets ||
      hasSlideReference(a) ||
      a.video_url ||
      a.screencast_url ||
      a.final_video_url ||
      a.b_roll_prompts,
  );

  return {
    hasAnyAssetReference,
    hasRenderableAssets,
    hasRenderableVisualAssets,
    warnings: normalized.warnings,
  };
}
