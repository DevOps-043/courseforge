export const BASE_AUDIO_PROFILE_ID = "voice-course-v1";
export const DEEPFILTER_AUDIO_PROFILE_ID = "voice-clean-neural-dfn3-v1";

export interface WorkerAudioProfilePolicy {
  compressor: {
    attackMilliseconds: number;
    makeupDecibels: number;
    ratio: number;
    releaseMilliseconds: number;
    thresholdDecibels: number;
  };
  highPassFrequencyHz: number;
  limiterPeak: number;
  loudness: {
    integratedLufs: number;
    loudnessRangeLu: number;
    truePeakDbtp: number;
  };
}

const VOICE_COURSE_POLICY: WorkerAudioProfilePolicy = {
  compressor: {
    attackMilliseconds: 20,
    makeupDecibels: 4,
    ratio: 3,
    releaseMilliseconds: 200,
    thresholdDecibels: -18,
  },
  highPassFrequencyHz: 70,
  limiterPeak: 0.95,
  loudness: {
    integratedLufs: -16,
    loudnessRangeLu: 11,
    truePeakDbtp: -1.5,
  },
};

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

/** Worker-owned policy: persisted snapshots select a version but cannot inject filters. */
export function resolveWorkerAudioProfilePolicy(profileId: string): WorkerAudioProfilePolicy {
  if (profileId !== BASE_AUDIO_PROFILE_ID && profileId !== DEEPFILTER_AUDIO_PROFILE_ID) {
    throw new Error("AUDIO_PROCESSING_PROFILE_UNKNOWN");
  }
  return VOICE_COURSE_POLICY;
}
