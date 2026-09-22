import type { AudioProcessingProfile, AudioProcessingProfileId } from "./audio-processing.types";

/**
 * This is the deliberately conservative first profile. Noise reduction is
 * excluded until it has been calibrated with representative course recordings.
 */
export const AUDIO_PROCESSING_PROFILES: readonly AudioProcessingProfile[] = [
  {
    description: "Voz de narración para cursos: filtra graves, controla dinámica y normaliza entrega.",
    id: "voice-course-v1",
    label: "Voz de curso",
    output: {
      bitrateKbps: 192,
      channels: 1,
      codec: "aac",
      container: "m4a",
      sampleRateHz: 48_000,
    },
    processing: {
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
    },
    version: 1,
  },
  {
    description: "Limpieza neural experimental para narración; requiere comparación A/B y aprobación manual.",
    id: "voice-clean-neural-dfn3-v1",
    label: "Voz limpia neural (experimental)",
    neuralEnhancement: {
      engine: "deepfilternet",
      modelId: "deepfilternet3-onnx",
      requiresManualQa: true,
    },
    output: {
      bitrateKbps: 192,
      channels: 1,
      codec: "aac",
      container: "m4a",
      sampleRateHz: 48_000,
    },
    processing: {
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
    },
    version: 1,
  },
] as const;

export const DEFAULT_AUDIO_PROCESSING_PROFILE_ID: AudioProcessingProfileId = "voice-course-v1";

export function getAudioProcessingProfile(id: AudioProcessingProfileId): AudioProcessingProfile {
  const profile = AUDIO_PROCESSING_PROFILES.find((candidate) => candidate.id === id);
  if (!profile) throw new Error(`Perfil de audio no registrado: ${id}`);
  return profile;
}
