/** Versioned measurement policy; existing evidence is never reinterpreted as this policy. */
export const AUDIO_TIMING_POLICY = Object.freeze({
  id: "stereo-envelope-v3", sampleRate: 8_000, channels: 2, binMilliseconds: 5,
  maximumDurationSeconds: 600, maximumFileBytes: 2 * 1024 * 1024 * 1024,
  searchMilliseconds: 500, toleranceMilliseconds: 20, minimumCorrelation: 0.95,
  minimumPeakSeparation: 0.02, peakExclusionMilliseconds: 40, minimumDurationMilliseconds: 2_000,
  lagUncertaintyMilliseconds: 5, silenceRms: 0.0001,
} as const);

export const AUDIO_STREAM_LIMITS = Object.freeze({ legacyDurationSeconds: 120, mixChunkFrames: 80_000,
  processingChunkBytes: 64 * 1024, decodeTimeoutMilliseconds: 10 * 60 * 1000 } as const);

export const AUDIO_RMS_WINDOW_POLICY = Object.freeze({
  id: "stereo-rms-window-v1", windowMilliseconds: 20, maximumDeltaDb: 0.5,
  sampleRate: AUDIO_TIMING_POLICY.sampleRate, silenceRms: AUDIO_TIMING_POLICY.silenceRms,
  maximumRecordedFailures: 8, alignment: "SAME_TIMELINE_NO_GAIN_NORMALIZATION",
} as const);
