export const BASE_AUDIO_PROFILE_ID = "voice-course-v1";
export const DEEPFILTER_AUDIO_PROFILE_ID = "voice-clean-neural-dfn3-v1";

/** The neural profile is claimed only by images with the managed runtime enabled. */
export function supportedAudioProfileIds(environment: NodeJS.ProcessEnv = process.env): readonly string[] {
  return environment.DEEPFILTERNET_ENABLED === "true"
    ? [BASE_AUDIO_PROFILE_ID, DEEPFILTER_AUDIO_PROFILE_ID]
    : [BASE_AUDIO_PROFILE_ID];
}

export function assertSupportedAudioProfile(profileId: string, supportedProfiles: readonly string[]): void {
  if (!supportedProfiles.includes(profileId)) {
    throw new Error("AUDIO_PROCESSING_PROFILE_UNSUPPORTED_BY_WORKER");
  }
}
