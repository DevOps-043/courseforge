import {
  type TemplateRenderConfig,
  parseTemplateRenderConfig,
} from './template-render-config.service';
import {
  parseLayoutOverrideManifests,
  type LayoutOverrideManifestList,
} from './layout-overrides.service';
import {
  normalizeTimelineOverrideManifestsForDuration,
  parseTimelineOverrideManifests,
  type TimelineOverrideManifestList,
} from './timeline-overrides.service';

export const ASSEMBLY_FPS = 30;
export const FALLBACK_DURATION_SECONDS = 10;
export const DEFAULT_CLIP_SECONDS = 5;
export const DEFAULT_SLIDE_SECONDS = 5;
export const DEFAULT_BG_MUSIC_VOLUME = 0.15;
export const DEFAULT_COMPOSITION_ID = 'full-slides';

// Only compositions registered by the internal Remotion root are accepted here.
// External cloud bundles may provide different composition IDs.
const INTERNAL_COMPOSITION_IDS = new Set(['full-slides', 'split-avatar', 'avatar-focus']);

export interface AssemblyInputProps {
  template: string;
  fps: number;
  totalDurationInFrames: number;
  voiceAudioUrl?: string;
  bgMusicUrl?: string;
  bgMusicVolume: number;
  avatarVideoUrl?: string;
  avatarClips: { url: string; durationInFrames: number; order: number }[];
  slides: { index: number; url: string }[];
  brollClips: { url: string; durationInFrames: number; order: number }[];
  transitionType: 'fade' | 'slide' | 'none';
  templateConfig: TemplateRenderConfig;
  layoutOverrides: LayoutOverrideManifestList;
  timelineOverrides: TimelineOverrideManifestList;
}

interface NormalizedAssemblyAssets {
  voiceAudioUrl?: string;
  bgMusicUrl?: string;
  bgMusicVolume: number;
  avatarVideoUrl?: string;
  avatarClips: { url: string; durationInFrames: number; order: number }[];
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

export function resolveInternalCompositionId(rawCompositionId: unknown): string {
  if (typeof rawCompositionId === 'string' && INTERNAL_COMPOSITION_IDS.has(rawCompositionId)) {
    return rawCompositionId;
  }

  return DEFAULT_COMPOSITION_ID;
}

export const resolveCompositionId = resolveInternalCompositionId;

export function resolveExternalCompositionId(
  rawCompositionId: unknown,
  fallback: string = DEFAULT_COMPOSITION_ID,
): string {
  if (
    typeof rawCompositionId === 'string' &&
    rawCompositionId.trim().length > 0 &&
    rawCompositionId.length <= 128
  ) {
    return rawCompositionId.trim();
  }

  return fallback;
}

function resolveTimelineOverrideDurationSeconds(params: {
  timelineOverrides: TimelineOverrideManifestList;
  compositionId: string;
}) {
  const matchingManifests = params.timelineOverrides.filter(
    (manifest) => !manifest.templateId || manifest.templateId === params.compositionId,
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

export function resolveAssemblyDurationSeconds(params: {
  assets: any;
  normalizedDurationSeconds: number;
  timelineOverrides: TimelineOverrideManifestList;
  compositionId: string;
}) {
  const targetDurationSeconds = params.assets?.assembly_target_duration_seconds;
  if (isPositiveNumber(targetDurationSeconds)) {
    return targetDurationSeconds;
  }

  if (params.normalizedDurationSeconds > 0) {
    return params.normalizedDurationSeconds;
  }

  const timelineDurationSeconds = resolveTimelineOverrideDurationSeconds({
    timelineOverrides: params.timelineOverrides,
    compositionId: params.compositionId,
  });
  if (timelineDurationSeconds > 0) {
    return timelineDurationSeconds;
  }

  return FALLBACK_DURATION_SECONDS;
}

export function normalizeAssemblyAssets(
  assets: any,
  fps: number = ASSEMBLY_FPS,
): NormalizedAssemblyAssets {
  const source = assets ?? {};

  const slides = (source.slides?.images ?? [])
    .filter((img: any) => Boolean(img?.public_url))
    .sort((left: any, right: any) => left.slide_index - right.slide_index)
    .map((img: any, index: number) => ({ index, url: img.public_url }));

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

  const avatarClips = (source.avatar_clips ?? [])
    .filter((clip: any) => Boolean(clip?.public_url) && (!clip.status || clip.status === 'COMPLETED'))
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

  const explicitBrollTotalSeconds = (source.b_roll_clips ?? [])
    .filter((clip: any) => Boolean(clip?.public_url) && isPositiveNumber(clip?.duration))
    .reduce(
      (sum: number, clip: any) => sum + clip.duration,
      0,
    );
  const fallbackBrollTotalSeconds = brollClips.reduce(
    (sum: number, clip: { durationInFrames: number }) => sum + clip.durationInFrames / fps,
    0,
  );
  const explicitAvatarClipTotalSeconds = (source.avatar_clips ?? [])
    .filter((clip: any) => Boolean(clip?.public_url) && (!clip.status || clip.status === 'COMPLETED') && isPositiveNumber(clip?.duration))
    .reduce((sum: number, clip: any) => sum + clip.duration, 0);
  const fallbackAvatarClipTotalSeconds = avatarClips.reduce(
    (sum: number, clip: { durationInFrames: number }) => sum + clip.durationInFrames / fps,
    0,
  );

  const voiceDurationSeconds = isPositiveNumber(source.voice_audio?.duration)
    ? source.voice_audio.duration
    : 0;
  const avatarDurationSeconds = isPositiveNumber(source.avatar_video?.duration)
    ? source.avatar_video.duration
    : 0;
  let totalDurationSeconds = 0;

  if (
    source.avatar_generation_mode === 'scene_clips' &&
    (explicitAvatarClipTotalSeconds > 0 || fallbackAvatarClipTotalSeconds > 0)
  ) {
    totalDurationSeconds = explicitAvatarClipTotalSeconds || fallbackAvatarClipTotalSeconds;
  } else if (source.avatar_generation_mode === 'single_video' && avatarDurationSeconds > 0) {
    totalDurationSeconds = avatarDurationSeconds;
  } else if (!source.avatar_generation_mode && explicitAvatarClipTotalSeconds > 0) {
    totalDurationSeconds = explicitAvatarClipTotalSeconds;
  } else if (!source.avatar_generation_mode && fallbackAvatarClipTotalSeconds > 0) {
    totalDurationSeconds = fallbackAvatarClipTotalSeconds;
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

  return {
    voiceAudioUrl: source.voice_audio?.public_url || undefined,
    bgMusicUrl: source.background_music?.public_url || undefined,
    bgMusicVolume: source.background_music?.volume_multiplier ?? DEFAULT_BG_MUSIC_VOLUME,
    avatarVideoUrl: source.avatar_video?.public_url || undefined,
    avatarClips,
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
      normalized.avatarClips.length > 0 ||
      normalized.slides.length > 0 ||
      normalized.brollClips.length > 0,
  );
}

export function buildAssemblyInputProps(params: {
  assets: any;
  compositionId: string;
  transitionType: unknown;
  templateConfig?: unknown;
  layoutOverrides?: unknown;
  timelineOverrides?: unknown;
  fps?: number;
}): AssemblyInputProps {
  const fps = params.fps ?? ASSEMBLY_FPS;
  const normalized = normalizeAssemblyAssets(params.assets, fps);
  const templateConfig = parseTemplateRenderConfig(params.templateConfig);
  const layoutOverrides = parseLayoutOverrideManifests(params.layoutOverrides);
  const timelineOverrides = parseTimelineOverrideManifests(
    params.timelineOverrides ?? params.assets?.timeline_overrides,
  );
  const hasPrimaryAssets = Boolean(
    normalized.voiceAudioUrl ||
      normalized.avatarVideoUrl ||
      normalized.avatarClips.length > 0 ||
      normalized.slides.length > 0 ||
      normalized.brollClips.length > 0,
  );

  if (!hasPrimaryAssets) {
    throw new Error(
      'No hay assets renderizables para Remotion. Sube voz, avatar, slides renderizables o B-roll antes de ensamblar.',
    );
  }

  const totalSeconds = resolveAssemblyDurationSeconds({
    assets: params.assets,
    normalizedDurationSeconds: normalized.totalDurationSeconds,
    timelineOverrides,
    compositionId: params.compositionId,
  });
  const totalDurationInFrames = secondsToFrames(totalSeconds, fps);
  const normalizedTimelineOverrides = normalizeTimelineOverrideManifestsForDuration({
    manifests: timelineOverrides,
    durationInFrames: totalDurationInFrames,
    fps,
  });
  const transition =
    params.transitionType === 'slide' || params.transitionType === 'none'
      ? params.transitionType
      : templateConfig.transitionType;

  return {
    template: params.compositionId,
    fps,
    totalDurationInFrames,
    voiceAudioUrl: normalized.voiceAudioUrl,
    bgMusicUrl: normalized.bgMusicUrl,
    bgMusicVolume: normalized.bgMusicVolume,
    avatarVideoUrl: normalized.avatarVideoUrl,
    avatarClips: normalized.avatarClips,
    slides: normalized.slides,
    brollClips: normalized.brollClips,
    transitionType: transition,
    templateConfig: {
      ...templateConfig,
      transitionType: transition,
    },
    layoutOverrides,
    timelineOverrides: normalizedTimelineOverrides,
  };
}
