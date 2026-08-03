import type { MaterialAssets } from "@/domains/materials/types/materials.types";
import type {
  AssemblyAvatarClip,
  AssemblyBrollClip,
  AssemblySlide,
} from "./types";
import { getAvatarClipEffectiveDurationInFrames } from "./avatar-clip-transitions";

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
  avatarClips: AssemblyAvatarClip[];
  slides: AssemblySlide[];
  deckCss: string;
  deckFonts: { family: string; href: string }[];
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
      assets.slides?.animated_deck?.status === "READY_FOR_PREVIEW" ||
      assets.slides?.animated_deck?.status === "READY_FOR_RENDER" ||
      assets.slides?.open_design_project_id,
  );
}

function buildWarnings(params: {
  assets: MaterialAssets;
  slides: AssemblySlide[];
  brollClips: AssemblyBrollClip[];
  avatarClips: AssemblyAvatarClip[];
}) {
  const warnings: AssemblyAssetWarning[] = [];
  const hasNonRenderableSlides =
    hasSlideReference(params.assets) && params.slides.length === 0;

  if (hasNonRenderableSlides) {
    warnings.push({
      code: "SLIDES_REFERENCE_NOT_RENDERIZABLE",
      message:
        "Hay slides cargadas como referencia, pero todavia no existen imagenes renderizables para ensamblado.",
    });
  }

  if (
    params.slides.length === 0 &&
    params.brollClips.length === 0 &&
    params.avatarClips.length === 0
  ) {
    warnings.push({
      code: "NO_RENDERABLE_VISUAL_ASSETS",
      message:
        "No hay recursos visuales renderizables; el preview usara audio/avatar o un fondo neutro.",
    });
  }

  return warnings;
}

function isCompletedAvatarClip(
  clip: NonNullable<MaterialAssets["avatar_clips"]>[number],
) {
  return Boolean(clip?.public_url) && !clip.deleted && (!clip.status || clip.status === "COMPLETED");
}

export function normalizeAssemblyAssets(
  assets: MaterialAssets | null | undefined,
  fps: number,
): NormalizedAssemblyAssets {
  const a = assets ?? {};

  const animatedDeck = a.slides?.animated_deck;
  const hasAnimatedDeck =
    animatedDeck?.status === "READY_FOR_PREVIEW" ||
    animatedDeck?.status === "READY_FOR_RENDER";
  const animatedSlides = hasAnimatedDeck
    ? (animatedDeck.slides ?? [])
        .sort((left, right) => left.index - right.index)
        .map((slide, index) => ({
          animationCount: slide.animationCount,
          classes: slide.classes,
          html: slide.html,
          index,
          kind: "html" as const,
          label: slide.label,
        }))
    : [];
  const imageSlides = (a.slides?.images ?? [])
    .filter((img) => Boolean(img?.public_url))
    .sort((left, right) => left.slide_index - right.slide_index)
    .map((img, index) => ({
      animationCount: 0,
      index,
      kind: "image" as const,
      url: img.public_url,
    }));
  const slides = animatedSlides.length > 0 ? animatedSlides : imageSlides;

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

  const avatarClips = (a.avatar_clips ?? [])
    .filter(isCompletedAvatarClip)
    .map((clip, index) => ({
      url: clip.public_url as string,
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

  const explicitBrollTotalSeconds = (a.b_roll_clips ?? [])
    .filter(
      (clip): clip is NonNullable<MaterialAssets["b_roll_clips"]>[number] & { duration: number } =>
        Boolean(clip?.public_url) && isPositiveNumber(clip.duration),
    )
    .reduce((sum, clip) => sum + clip.duration, 0);
  const fallbackBrollTotalSeconds = brollClips.reduce(
    (sum, clip) => sum + clip.durationInFrames / fps,
    0,
  );
  const avatarClipTotalSeconds =
    getAvatarClipEffectiveDurationInFrames(avatarClips) / fps;

  const voiceDurationSeconds = isPositiveNumber(a.voice_audio?.duration)
    ? a.voice_audio.duration
    : 0;
  const avatarDurationSeconds = isPositiveNumber(a.avatar_video?.duration)
    ? a.avatar_video.duration
    : 0;
  let totalDurationSeconds = 0;

  if (
    a.avatar_generation_mode === "scene_clips" &&
    avatarClipTotalSeconds > 0
  ) {
    totalDurationSeconds = avatarClipTotalSeconds;
  } else if (a.avatar_generation_mode === "single_video" && avatarDurationSeconds > 0) {
    totalDurationSeconds = avatarDurationSeconds;
  } else if (!a.avatar_generation_mode && avatarClipTotalSeconds > 0) {
    totalDurationSeconds = avatarClipTotalSeconds;
  } else if (voiceDurationSeconds > 0) {
    totalDurationSeconds = voiceDurationSeconds;
  } else if (avatarDurationSeconds > 0) {
    totalDurationSeconds = avatarDurationSeconds;
  } else if (explicitBrollTotalSeconds > 0) {
    totalDurationSeconds = explicitBrollTotalSeconds;
  } else if (fallbackBrollTotalSeconds > 0) {
    totalDurationSeconds = fallbackBrollTotalSeconds;
  } else if (slides.length > 0) {
    totalDurationSeconds = slides.length * DEFAULT_SLIDE_SECONDS;
  }

  const warnings = buildWarnings({ assets: a, slides, brollClips, avatarClips });

  return {
    voiceAudioUrl: a.voice_audio?.public_url || undefined,
    bgMusicUrl: a.background_music?.public_url || undefined,
    bgMusicVolume: a.background_music?.volume_multiplier ?? DEFAULT_BG_MUSIC_VOLUME,
    avatarVideoUrl: a.avatar_video?.public_url || undefined,
    avatarClips,
    slides,
    deckCss: animatedSlides.length > 0 ? animatedDeck?.css || "" : "",
    deckFonts: animatedSlides.length > 0
      ? (animatedDeck?.fonts ?? []).map((font) => ({
          family: font.family,
          href: font.href,
        }))
      : [],
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
    normalized.slides.length > 0 ||
    normalized.brollClips.length > 0 ||
    normalized.avatarClips.length > 0;
  const hasRenderableAssets = Boolean(
      normalized.voiceAudioUrl ||
      normalized.avatarVideoUrl ||
      normalized.avatarClips.length > 0 ||
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
