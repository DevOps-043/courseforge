import { z } from "zod";
import type {
  AudioLoudnessAnalysis,
  AudioWaveformDerivative,
  AudioWaveformLevel,
  AudioWaveformManifest,
} from "./audio-processing.types";

const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/);
const amplitudeSchema = z.number().finite().min(-1).max(1);

const loudnessSchema = z.object({
  contract_version: z.literal(1),
  integrated_lufs: z.number().finite().min(-100).max(20).nullable(),
  loudness_range_lu: z.number().finite().min(0).max(100),
  measured_threshold_lufs: z.number().finite().min(-100).max(20).nullable(),
  passed: z.boolean(),
  target_integrated_lufs: z.number().finite().min(-70).max(0),
  target_true_peak_dbtp: z.number().finite().min(-20).max(0),
  tolerance_lu: z.number().finite().positive().max(10),
  true_peak_dbtp: z.number().finite().min(-100).max(20).nullable(),
}).strict();

const waveformManifestSchema = z.object({
  checksum: checksumSchema,
  contract_version: z.literal(1),
  duration_seconds: z.number().finite().positive(),
  level_count: z.number().int().positive().max(32),
  sample_rate_hz: z.number().int().min(25).max(8_000),
  storage_bucket: z.literal("production-assets"),
  storage_path: z.string().regex(/^organizations\/[0-9a-f-]+\/audio-analysis\/[a-f0-9]{64}\/waveform-v1\.json$/),
}).strict();

const waveformLevelSchema = z.object({
  bucket_size_samples: z.number().int().positive(),
  max: z.array(amplitudeSchema).min(1).max(65_536),
  min: z.array(amplitudeSchema).min(1).max(65_536),
}).strict();

const waveformDerivativeSchema = z.object({
  contract_version: z.literal(1),
  duration_seconds: z.number().finite().positive(),
  levels: z.array(waveformLevelSchema).min(1).max(32),
  sample_rate_hz: z.number().int().min(25).max(8_000),
}).strict();

export interface AudioProcessingDerivatives {
  loudness: AudioLoudnessAnalysis;
  waveform: AudioWaveformManifest;
}

export function parseAudioProcessingDerivatives(metadata: unknown): AudioProcessingDerivatives | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  const loudness = loudnessSchema.safeParse(record.audio_analysis);
  const waveform = waveformManifestSchema.safeParse(record.waveform);
  if (!loudness.success || !waveform.success) return null;
  if (!waveform.data.storage_path.includes(`/${waveform.data.checksum}/`)) return null;
  return {
    loudness: {
      contractVersion: 1,
      integratedLufs: loudness.data.integrated_lufs,
      loudnessRangeLu: loudness.data.loudness_range_lu,
      measuredThresholdLufs: loudness.data.measured_threshold_lufs,
      passed: loudness.data.passed,
      targetIntegratedLufs: loudness.data.target_integrated_lufs,
      targetTruePeakDbtp: loudness.data.target_true_peak_dbtp,
      toleranceLu: loudness.data.tolerance_lu,
      truePeakDbtp: loudness.data.true_peak_dbtp,
    },
    waveform: mapWaveformManifest(waveform.data),
  };
}

export function parseAudioWaveformDerivative(value: unknown): AudioWaveformDerivative {
  const parsed = waveformDerivativeSchema.parse(value);
  const levels = parsed.levels.map(mapWaveformLevel);
  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index];
    if (level.min.length !== level.max.length) throw new Error("AUDIO_WAVEFORM_CHANNEL_LENGTH_MISMATCH");
    if (level.min.some((minimum, point) => minimum > level.max[point])) {
      throw new Error("AUDIO_WAVEFORM_EXTREMA_INVALID");
    }
    if (index > 0) {
      const previous = levels[index - 1];
      if (level.bucketSizeSamples !== previous.bucketSizeSamples * 2 || level.min.length !== Math.ceil(previous.min.length / 2)) {
        throw new Error("AUDIO_WAVEFORM_LOD_SEQUENCE_INVALID");
      }
    }
  }
  return {
    contractVersion: 1,
    durationSeconds: parsed.duration_seconds,
    levels,
    sampleRateHz: parsed.sample_rate_hz,
  };
}

/** Picks at most two extrema buckets per horizontal pixel to keep rendering bounded. */
export function selectAudioWaveformLevel(
  waveform: AudioWaveformDerivative,
  viewportWidthPixels: number,
): AudioWaveformLevel {
  const width = Math.max(1, Math.floor(viewportWidthPixels));
  const maximumBuckets = width * 2;
  return waveform.levels.find((level) => level.min.length <= maximumBuckets)
    || waveform.levels.at(-1)!;
}

function mapWaveformManifest(value: z.infer<typeof waveformManifestSchema>): AudioWaveformManifest {
  return {
    checksum: value.checksum,
    contractVersion: 1,
    durationSeconds: value.duration_seconds,
    levelCount: value.level_count,
    sampleRateHz: value.sample_rate_hz,
    storageBucket: value.storage_bucket,
    storagePath: value.storage_path,
  };
}

function mapWaveformLevel(value: z.infer<typeof waveformLevelSchema>): AudioWaveformLevel {
  return {
    bucketSizeSamples: value.bucket_size_samples,
    max: value.max,
    min: value.min,
  };
}
