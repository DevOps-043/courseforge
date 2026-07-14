import type { RemotionRenderProviderSetting } from './remotion-render.config';

type FailureProvider = RemotionRenderProviderSetting | 'preview' | 'codebuild' | 'unknown';

export interface RemotionFailureContext {
  provider?: FailureProvider;
  stage?: string;
}

export interface RenderDiagnosticsSnapshotInput {
  renderProvider: RemotionRenderProviderSetting | string;
  renderMode: string;
  inputProps?: unknown;
  rawAssets?: unknown;
  templateId?: string | null;
  templateVersionId?: string | null;
  buildId?: string | null;
  bundleHash?: string | null;
  buildHash?: string | null;
  compositionId?: string | null;
  propsHash?: string | null;
  timeoutInMilliseconds?: number | null;
  lambdaTuning?: Record<string, unknown> | null;
  cloudBuildReadinessReason?: string | null;
}

export function classifyRemotionFailure(
  message: string,
  context: RemotionFailureContext = {},
): string {
  const normalized = message.toLowerCase();

  if (normalized.includes('external_cloud_build_required')) return 'EXTERNAL_CLOUD_BUILD_REQUIRED';
  if (normalized.includes('external_build_not_ready')) return 'EXTERNAL_BUILD_NOT_READY';
  if (normalized.includes('external_render_target_incomplete')) return 'EXTERNAL_RENDER_TARGET_INCOMPLETE';
  if (normalized.includes('external_composition_id_missing')) return 'EXTERNAL_COMPOSITION_ID_MISSING';
  if (normalized.includes('external_props_invalid')) return 'EXTERNAL_PROPS_INVALID';
  if (normalized.includes('external_serve_url_mismatch')) return 'EXTERNAL_SERVE_URL_MISMATCH';
  if (normalized.includes('throttl') || normalized.includes('rate exceeded') || normalized.includes('concurrency')) {
    return context.provider === 'lambda' ? 'LAMBDA_THROTTLED' : 'RENDER_PROVIDER_THROTTLED';
  }
  if (normalized.includes('timed out') || normalized.includes('timeout')) {
    if (context.provider === 'lambda') return 'LAMBDA_TIMEOUT';
    if (context.provider === 'preview') return 'EXTERNAL_PREVIEW_TIMEOUT';
    if (context.provider === 'codebuild') return 'CODEBUILD_TIMEOUT';
    if (context.provider === 'desktop_worker') return 'DESKTOP_WORKER_TIMEOUT';
    if (context.provider === 'local') return 'LOCAL_RENDER_TIMEOUT';
    return 'RENDER_TIMEOUT';
  }
  if (
    normalized.includes('output_not_accessible') ||
    normalized.includes('output not accessible') ||
    normalized.includes('no playable output') ||
    normalized.includes('s3://')
  ) {
    return 'OUTPUT_NOT_ACCESSIBLE';
  }
  if (normalized.includes('props') || normalized.includes('asset')) return 'INVALID_RENDER_PROPS';
  if (normalized.includes('selectcomposition') || normalized.includes('composition')) {
    return 'COMPOSITION_RESOLUTION_FAILED';
  }

  if (context.provider === 'lambda') return 'LAMBDA_RENDER_FAILED';
  if (context.provider === 'desktop_worker') return 'DESKTOP_WORKER_RENDER_FAILED';
  if (context.provider === 'local') return 'LOCAL_RENDER_FAILED';
  if (context.provider === 'preview') return 'EXTERNAL_PREVIEW_RENDER_FAILED';
  if (context.provider === 'codebuild') return 'CODEBUILD_RENDER_FAILED';
  return 'REMOTION_RENDER_FAILED';
}

export function buildRenderDiagnosticsSnapshot(
  input: RenderDiagnosticsSnapshotInput,
): Record<string, unknown> {
  const propsSummary = summarizeInputProps(input.inputProps);
  const assetSummary = summarizeRawAssets(input.rawAssets);

  return dropEmptyValues({
    renderProvider: input.renderProvider,
    renderMode: input.renderMode,
    templateId: input.templateId,
    templateVersionId: input.templateVersionId,
    buildId: input.buildId,
    compositionId: input.compositionId || propsSummary.template || null,
    bundleHash: truncateHash(input.bundleHash),
    buildHash: truncateHash(input.buildHash),
    propsHash: truncateHash(input.propsHash),
    timeoutInMilliseconds: positiveNumberOrNull(input.timeoutInMilliseconds),
    lambdaTuning: input.lambdaTuning || null,
    cloudBuildReadinessReason: input.cloudBuildReadinessReason || null,
    props: propsSummary,
    assets: assetSummary,
  });
}

export function summarizeInputProps(inputProps: unknown): Record<string, unknown> {
  const props = asRecord(inputProps);
  const fps = positiveNumberOrNull(props.fps);
  const totalDurationInFrames = positiveNumberOrNull(props.totalDurationInFrames);
  const totalDurationSeconds =
    fps && totalDurationInFrames ? Math.round((totalDurationInFrames / fps) * 1000) / 1000 : null;
  const slides = Array.isArray(props.slides) ? props.slides : [];
  const brollClips = Array.isArray(props.brollClips) ? props.brollClips : [];

  return dropEmptyValues({
    template: typeof props.template === 'string' ? props.template : null,
    fps,
    totalDurationInFrames,
    totalDurationSeconds,
    propKeys: Object.keys(props).sort(),
    slideCount: slides.length,
    brollClipCount: brollClips.length,
    hasVoiceAudio: Boolean(props.voiceAudioUrl),
    hasAvatarVideo: Boolean(props.avatarVideoUrl),
    hasBackgroundMusic: Boolean(props.bgMusicUrl),
    hasCaptions: Boolean(props.captionsUrl || props.captions),
  });
}

export function summarizeRawAssets(rawAssets: unknown): Record<string, unknown> {
  const assets = asRecord(rawAssets);
  const slides = asRecord(assets.slides);
  const slideImages = Array.isArray(slides.images)
    ? slides.images
    : Array.isArray(assets.slide_images)
      ? assets.slide_images
      : [];
  const brollClips = Array.isArray(assets.b_roll_clips) ? assets.b_roll_clips : [];
  const voiceAudio = asRecord(assets.voice_audio);
  const avatarVideo = asRecord(assets.avatar_video);
  const backgroundMusic = asRecord(assets.background_music);

  return dropEmptyValues({
    hasVoiceAudio: Boolean(voiceAudio.public_url || voiceAudio.storage_path || assets.voice_audio_url),
    voiceDurationSeconds: positiveNumberOrNull(voiceAudio.duration),
    hasAvatarVideo: Boolean(avatarVideo.public_url || avatarVideo.storage_path || assets.avatar_video_url),
    avatarDurationSeconds: positiveNumberOrNull(avatarVideo.duration),
    hasBackgroundMusic: Boolean(backgroundMusic.public_url || backgroundMusic.storage_path || assets.bg_music_url),
    slideCount: slideImages.length,
    brollClipCount: brollClips.length,
    assemblyTargetDurationSeconds: positiveNumberOrNull(assets.assembly_target_duration_seconds),
    hasFinalVideoUrl: Boolean(assets.final_video_url),
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function positiveNumberOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function truncateHash(value: string | null | undefined): string | null {
  return value ? value.slice(0, 16) : null;
}

function dropEmptyValues(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => {
      if (value === null || value === undefined) return false;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
      return true;
    }),
  );
}
