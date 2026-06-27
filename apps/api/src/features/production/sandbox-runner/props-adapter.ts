const DEFAULT_BG_MUSIC_VOLUME = 0.15;
const DEFAULT_FPS = 30;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function adaptToExternalTemplateProps(inputProps: unknown): Record<string, unknown> {
  const props = isRecord(inputProps) ? inputProps : {};
  const templateConfig = isRecord(props.templateConfig) ? props.templateConfig : {};

  return {
    slides: Array.isArray(props.slides) ? props.slides : [],
    brollClips: Array.isArray(props.brollClips) ? props.brollClips : [],
    avatarVideoUrl: typeof props.avatarVideoUrl === 'string' ? props.avatarVideoUrl : undefined,
    totalDurationInFrames:
      typeof props.totalDurationInFrames === 'number' && Number.isFinite(props.totalDurationInFrames)
        ? props.totalDurationInFrames
        : undefined,
    voiceAudioUrl: typeof props.voiceAudioUrl === 'string' ? props.voiceAudioUrl : undefined,
    bgMusicUrl: typeof props.bgMusicUrl === 'string' ? props.bgMusicUrl : undefined,
    bgMusicVolume:
      typeof props.bgMusicVolume === 'number' && Number.isFinite(props.bgMusicVolume)
        ? props.bgMusicVolume
        : DEFAULT_BG_MUSIC_VOLUME,
    fps: typeof props.fps === 'number' && Number.isFinite(props.fps) ? props.fps : DEFAULT_FPS,
    templateConfig,
  };
}
