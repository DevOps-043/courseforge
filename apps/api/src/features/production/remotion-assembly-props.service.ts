import {
  type TemplateRenderConfig,
  parseTemplateRenderConfig,
} from './template-render-config.service';

export const ASSEMBLY_FPS = 30;
export const FALLBACK_DURATION_SECONDS = 10;
export const DEFAULT_CLIP_SECONDS = 5;
export const DEFAULT_SLIDE_SECONDS = 5;
export const DEFAULT_BG_MUSIC_VOLUME = 0.15;
export const DEFAULT_COMPOSITION_ID = 'full-slides';

const VALID_COMPOSITION_IDS = new Set(['full-slides', 'split-avatar', 'avatar-focus']);

export interface AssemblyInputProps {
  template: string;
  fps: number;
  totalDurationInFrames: number;
  voiceAudioUrl?: string;
  bgMusicUrl?: string;
  bgMusicVolume: number;
  avatarVideoUrl?: string;
  slides: { index: number; url: string }[];
  brollClips: { url: string; durationInFrames: number; order: number }[];
  transitionType: 'fade' | 'slide' | 'none';
  templateConfig: TemplateRenderConfig;
}

interface NormalizedAssemblyAssets {
  voiceAudioUrl?: string;
  bgMusicUrl?: string;
  bgMusicVolume: number;
  avatarVideoUrl?: string;
  slides: { index: number; url: string }[];
  brollClips: { url: string; durationInFrames: number; order: number }[];
  totalDurationSeconds: number;
}

function secondsToFrames(seconds: number, fps: number): number {
  return Math.max(1, Math.round(seconds * fps));
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function resolveCompositionId(rawCompositionId: unknown): string {
  if (typeof rawCompositionId === 'string' && VALID_COMPOSITION_IDS.has(rawCompositionId)) {
    return rawCompositionId;
  }

  return DEFAULT_COMPOSITION_ID;
}

export function normalizeAssemblyAssets(
  assets: any,
  fps: number = ASSEMBLY_FPS,
): NormalizedAssemblyAssets {
  const source = assets ?? {};

  const slides = (source.slides?.images ?? [])
    .filter((img: any) => Boolean(img?.public_url))
    .map((img: any) => ({ index: img.slide_index, url: img.public_url }))
    .sort((left: { index: number }, right: { index: number }) => left.index - right.index);

  const brollClips = (source.b_roll_clips ?? [])
    .filter((clip: any) => Boolean(clip?.public_url))
    .map((clip: any, index: number) => ({
      url: clip.public_url,
      durationInFrames: secondsToFrames(
        isPositiveNumber(clip.duration) ? clip.duration : DEFAULT_CLIP_SECONDS,
        fps,
      ),
      order: isPositiveNumber(clip.order) ? clip.order : index + 1,
      originalIndex: index,
    }))
    .sort(
      (
        left: { order: number; originalIndex: number },
        right: { order: number; originalIndex: number },
      ) => left.order - right.order || left.originalIndex - right.originalIndex,
    )
    .map(({ originalIndex: _originalIndex, ...clip }: { originalIndex: number; url: string; durationInFrames: number; order: number }) => clip);

  const brollTotalSeconds = brollClips.reduce(
    (sum: number, clip: { durationInFrames: number }) => sum + clip.durationInFrames / fps,
    0,
  );

  const primaryMediaDurationSeconds = isPositiveNumber(source.voice_audio?.duration)
    ? source.voice_audio.duration
    : isPositiveNumber(source.avatar_video?.duration)
      ? source.avatar_video.duration
      : 0;
  const targetDurationSeconds = isPositiveNumber(source.assembly_target_duration_seconds)
    ? source.assembly_target_duration_seconds
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

  return {
    voiceAudioUrl: source.voice_audio?.public_url || undefined,
    bgMusicUrl: source.background_music?.public_url || undefined,
    bgMusicVolume: source.background_music?.volume_multiplier ?? DEFAULT_BG_MUSIC_VOLUME,
    avatarVideoUrl: source.avatar_video?.public_url || undefined,
    slides,
    brollClips,
    totalDurationSeconds,
  };
}

export function hasPrimaryRenderableAssemblyAssets(assets: any): boolean {
  const normalized = normalizeAssemblyAssets(assets, ASSEMBLY_FPS);

  return Boolean(
    normalized.voiceAudioUrl ||
      normalized.avatarVideoUrl ||
      normalized.slides.length > 0 ||
      normalized.brollClips.length > 0,
  );
}

export function buildAssemblyInputProps(params: {
  assets: any;
  compositionId: string;
  transitionType: unknown;
  templateConfig?: unknown;
  fps?: number;
}): AssemblyInputProps {
  const fps = params.fps ?? ASSEMBLY_FPS;
  const normalized = normalizeAssemblyAssets(params.assets, fps);
  const templateConfig = parseTemplateRenderConfig(params.templateConfig);
  const hasPrimaryAssets = Boolean(
    normalized.voiceAudioUrl ||
      normalized.avatarVideoUrl ||
      normalized.slides.length > 0 ||
      normalized.brollClips.length > 0,
  );

  if (!hasPrimaryAssets) {
    throw new Error(
      'No hay assets renderizables para Remotion. Sube voz, avatar, slides renderizables o B-roll antes de ensamblar.',
    );
  }

  const totalSeconds =
    normalized.totalDurationSeconds > 0
      ? normalized.totalDurationSeconds
      : FALLBACK_DURATION_SECONDS;
  const transition =
    params.transitionType === 'slide' || params.transitionType === 'none'
      ? params.transitionType
      : templateConfig.transitionType;

  return {
    template: params.compositionId,
    fps,
    totalDurationInFrames: secondsToFrames(totalSeconds, fps),
    voiceAudioUrl: normalized.voiceAudioUrl,
    bgMusicUrl: normalized.bgMusicUrl,
    bgMusicVolume: normalized.bgMusicVolume,
    avatarVideoUrl: normalized.avatarVideoUrl,
    slides: normalized.slides,
    brollClips: normalized.brollClips,
    transitionType: transition,
    templateConfig: {
      ...templateConfig,
      transitionType: transition,
    },
  };
}
