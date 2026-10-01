export const AUDIO_PROCESSING_PROFILE_IDS = [
  "voice-course-v1",
  "voice-clean-neural-dfn3-v1",
] as const;

export type AudioProcessingProfileId = typeof AUDIO_PROCESSING_PROFILE_IDS[number];

export interface AudioProcessingProfile {
  description: string;
  id: AudioProcessingProfileId;
  label: string;
  neuralEnhancement?: {
    engine: "deepfilternet";
    modelId: "deepfilternet3-onnx";
    requiresManualQa: true;
  };
  output: {
    bitrateKbps: 192;
    channels: 1;
    codec: "aac";
    container: "m4a";
    sampleRateHz: 48_000;
  };
  /** Human-approved processing settings; preserved verbatim in the job snapshot. */
  processing: {
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
  };
  version: number;
}

export interface AudioProcessingSource {
  assetId: string;
  checksum: string;
  mimeType: "audio/mpeg" | "audio/mp3" | "audio/wav" | "audio/x-wav";
  storageBucket: string;
  storagePath: string;
}

/**
 * Serializable worker input. It intentionally contains storage identities,
 * never a user-controlled shell command or a long-lived signed URL.
 */
export interface AudioProcessingJobInput {
  profile: AudioProcessingProfile;
  source: AudioProcessingSource;
}

export interface AudioLoudnessAnalysis {
  contractVersion: 1;
  integratedLufs: number | null;
  loudnessRangeLu: number;
  measuredThresholdLufs: number | null;
  passed: boolean;
  targetIntegratedLufs: number;
  targetTruePeakDbtp: number;
  toleranceLu: number;
  truePeakDbtp: number | null;
}

export interface AudioWaveformManifest {
  checksum: string;
  contractVersion: 1;
  durationSeconds: number;
  levelCount: number;
  sampleRateHz: number;
  storageBucket: "production-assets";
  storagePath: string;
}

export interface AudioWaveformLevel {
  bucketSizeSamples: number;
  max: number[];
  min: number[];
}

export interface AudioWaveformDerivative {
  contractVersion: 1;
  durationSeconds: number;
  levels: AudioWaveformLevel[];
  sampleRateHz: number;
}

/** A single server-selected LOD for responsive timeline rendering. */
export interface AudioWaveformPreview {
  bucketSizeSamples: number;
  durationSeconds: number;
  max: number[];
  min: number[];
  sampleRateHz: number;
}
