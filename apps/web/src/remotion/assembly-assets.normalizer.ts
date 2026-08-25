import type { MaterialAssets } from "@/domains/materials/types/materials.types";
import { repairCommonUtf8Mojibake } from "../domains/production/text/mojibake.service";
import type {
  AssemblyAvatarClip,
  AssemblyBrollClip,
  AssemblySlide,
  AssemblyVoiceClip,
} from "./types";
import { getAvatarClipEffectiveDurationInFrames } from "./avatar-clip-transitions";
import { durationSecondsToFrames } from "./media-duration";

const DEFAULT_CLIP_SECONDS = 5;
const DEFAULT_SLIDE_SECONDS = 5;
const DEFAULT_BG_MUSIC_VOLUME = 0.15;

export type AssemblyAssetWarningCode =
  | "SLIDES_REFERENCE_NOT_RENDERIZABLE"
  | "INCOMPLETE_VOICE_CLIPS"
  | "NO_RENDERABLE_VISUAL_ASSETS";

export interface AssemblyAssetWarning {
  code: AssemblyAssetWarningCode;
  message: string;
}

export interface NormalizedAssemblyAssets {
  voiceAudioUrl?: string;
  voiceClips: AssemblyVoiceClip[];
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
  canRender: boolean;
  blockingIssues: AssemblyBlockingIssue[];
  manifest: AssemblyAssetManifest;
  warnings: AssemblyAssetWarning[];
}

export type AssemblyBlockingIssueCode =
  | "SLIDES_REFERENCE_NOT_RENDERIZABLE"
  | "NO_RENDERABLE_ASSETS";

export interface AssemblyBlockingIssue {
  code: AssemblyBlockingIssueCode;
  message: string;
}

export interface AssemblyAssetManifest {
  slideCount: number;
  brollClipCount: number;
  avatarClipCount: number;
  hasAvatarVideo: boolean;
  hasVoiceAudio: boolean;
  hasBackgroundMusic: boolean;
  totalDurationSeconds: number;
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
  voiceClips: AssemblyVoiceClip[];
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

  if ((params.assets.voice_clips?.length || 0) > 0 && params.voiceClips.length === 0) {
    warnings.push({
      code: "INCOMPLETE_VOICE_CLIPS",
      message:
        "Las voces por escena no forman una colección completa y sincronizada; se usará el audio del avatar como respaldo.",
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

function normalizeAnimatedSlideClasses(classes: string | undefined) {
  const classList = (classes || "slide").split(/\s+/).filter(Boolean);
  if (!classList.includes("active")) {
    classList.push("active");
  }
  return classList.join(" ");
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
          classes: normalizeAnimatedSlideClasses(slide.classes),
          html: repairCommonUtf8Mojibake(slide.html),
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
      durationInFrames: durationSecondsToFrames(
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

  const completedAvatarClipSources = (a.avatar_clips ?? []).filter(isCompletedAvatarClip);
  const avatarClips = completedAvatarClipSources
    .map((clip, index) => ({
      clipId: clip.id,
      url: clip.public_url as string,
      durationInFrames: durationSecondsToFrames(
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

  const completedVoiceByClipId = new Map(
    (a.voice_clips ?? [])
      .filter((clip) => clip.status === "COMPLETED" && Boolean(clip.public_url))
      .map((clip) => [clip.clip_id, clip] as const),
  );
  const hasCompleteVoiceClipMapping = completedAvatarClipSources.length > 0
    && completedAvatarClipSources.every((avatarClip) => {
      const voiceClip = completedVoiceByClipId.get(avatarClip.id);
      return Boolean(
        voiceClip
        && (!avatarClip.script_hash || voiceClip.script_hash === avatarClip.script_hash),
      );
    });
  const voiceClips = hasCompleteVoiceClipMapping
    ? completedAvatarClipSources.map((avatarClip, index) => {
        const voiceClip = completedVoiceByClipId.get(avatarClip.id)!;
        return {
          clipId: avatarClip.id,
          url: voiceClip.public_url,
          durationInFrames: durationSecondsToFrames(
            isPositiveNumber(voiceClip.duration)
              ? voiceClip.duration
              : isPositiveNumber(avatarClip.duration)
                ? avatarClip.duration
                : DEFAULT_CLIP_SECONDS,
            fps,
          ),
          order: isPositiveNumber(avatarClip.order) ? avatarClip.order : index + 1,
        };
      }).sort((left, right) => left.order - right.order)
    : [];

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
  const voiceClipTotalSeconds =
    getAvatarClipEffectiveDurationInFrames(voiceClips) / fps;

  const voiceDurationSeconds = a.avatar_generation_mode !== "scene_clips"
    && isPositiveNumber(a.voice_audio?.duration)
    ? a.voice_audio.duration
    : 0;
  const avatarDurationSeconds = isPositiveNumber(a.avatar_video?.duration)
    ? a.avatar_video.duration
    : 0;
  let totalDurationSeconds = 0;

  if (voiceDurationSeconds > 0) {
    totalDurationSeconds = voiceDurationSeconds;
  } else if (voiceClipTotalSeconds > 0) {
    totalDurationSeconds = voiceClipTotalSeconds;
  } else if (
    a.avatar_generation_mode === "scene_clips" &&
    avatarClipTotalSeconds > 0
  ) {
    totalDurationSeconds = avatarClipTotalSeconds;
  } else if (a.avatar_generation_mode === "single_video" && avatarDurationSeconds > 0) {
    totalDurationSeconds = avatarDurationSeconds;
  } else if (!a.avatar_generation_mode && avatarClipTotalSeconds > 0) {
    totalDurationSeconds = avatarClipTotalSeconds;
  } else if (avatarDurationSeconds > 0) {
    totalDurationSeconds = avatarDurationSeconds;
  } else if (explicitBrollTotalSeconds > 0) {
    totalDurationSeconds = explicitBrollTotalSeconds;
  } else if (fallbackBrollTotalSeconds > 0) {
    totalDurationSeconds = fallbackBrollTotalSeconds;
  } else if (slides.length > 0) {
    totalDurationSeconds = slides.length * DEFAULT_SLIDE_SECONDS;
  }

  const warnings = buildWarnings({ assets: a, slides, brollClips, avatarClips, voiceClips });

  return {
    voiceAudioUrl: a.avatar_generation_mode === "scene_clips"
      ? undefined
      : a.voice_audio?.public_url || undefined,
    voiceClips,
    bgMusicUrl: a.background_music?.public_url || undefined,
    bgMusicVolume: a.background_music?.volume_multiplier ?? DEFAULT_BG_MUSIC_VOLUME,
    avatarVideoUrl: a.avatar_generation_mode === "scene_clips"
      ? undefined
      : a.avatar_video?.public_url || undefined,
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
      normalized.voiceClips.length > 0 ||
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
  const blockingIssues: AssemblyBlockingIssue[] = [];
  if (normalized.warnings.some((warning) => warning.code === "SLIDES_REFERENCE_NOT_RENDERIZABLE")) {
    blockingIssues.push({
      code: "SLIDES_REFERENCE_NOT_RENDERIZABLE",
      message:
        "Las diapositivas existen solo como referencia HTML/proyecto. Exportalas a imagenes o prepara el deck animado antes de renderizar.",
    });
  }
  if (!hasRenderableAssets) {
    blockingIssues.push({
      code: "NO_RENDERABLE_ASSETS",
      message:
        "No hay assets renderizables. Sube voz, avatar, diapositivas renderizables o B-roll antes de ensamblar.",
    });
  }

  return {
    hasAnyAssetReference,
    hasRenderableAssets,
    hasRenderableVisualAssets,
    canRender: blockingIssues.length === 0,
    blockingIssues,
    manifest: {
      slideCount: normalized.slides.length,
      brollClipCount: normalized.brollClips.length,
      avatarClipCount: normalized.avatarClips.length,
      hasAvatarVideo: Boolean(normalized.avatarVideoUrl),
      hasVoiceAudio: Boolean(normalized.voiceAudioUrl || normalized.voiceClips.length > 0),
      hasBackgroundMusic: Boolean(normalized.bgMusicUrl),
      totalDurationSeconds: normalized.totalDurationSeconds,
    },
    warnings: normalized.warnings,
  };
}
