import { z } from "zod";
import type {
  AudioWaveformDerivative,
  AudioWaveformManifest,
} from "./audio-processing.types";

const checksum = z.string().regex(/^[a-f0-9]{64}$/);
const sampleRate = z.number().int().min(8000).max(192000);
const amplitude = z.number().finite().min(-1).max(1);
const level = z
  .object({
    bucket_size_samples: z.number().int().positive(),
    min: z.array(amplitude).min(1).max(65536),
    max: z.array(amplitude).min(1).max(65536),
  })
  .strict();
const manifestSchema = z
  .object({
    contract_version: z.literal(2),
    checksum,
    source_checksum: checksum,
    duration_seconds: z.number().finite().positive().max(1800),
    sample_rate_hz: sampleRate,
    channel_count: z.number().int().min(1).max(8),
    level_count: z.number().int().min(1).max(32),
    storage_bucket: z.literal("production-assets"),
    storage_path: z
      .string()
      .regex(
        /^organizations\/[0-9a-f-]+\/audio-analysis\/[a-f0-9]{64}\/waveform-v2\.json$/,
      ),
  })
  .strict();
const derivativeSchema = z
  .object({
    contract_version: z.literal(2),
    duration_seconds: z.number().finite().positive().max(1800),
    sample_rate_hz: sampleRate,
    channels: z
      .array(z.object({ levels: z.array(level).min(1).max(32) }).strict())
      .min(1)
      .max(8),
  })
  .strict();

export function parseWaveformV2Manifest(
  value: unknown,
): AudioWaveformManifest | null {
  const result = manifestSchema.safeParse(value);
  if (
    !result.success ||
    !result.data.storage_path.includes(`/${result.data.checksum}/`)
  )
    return null;
  const manifest = result.data;
  return {
    contractVersion: 2,
    checksum: manifest.checksum,
    sourceChecksum: manifest.source_checksum,
    durationSeconds: manifest.duration_seconds,
    sampleRateHz: manifest.sample_rate_hz,
    channelCount: manifest.channel_count,
    levelCount: manifest.level_count,
    storageBucket: manifest.storage_bucket,
    storagePath: manifest.storage_path,
  };
}

export function parseWaveformV2Derivative(
  value: unknown,
): AudioWaveformDerivative {
  const derivative = derivativeSchema.parse(value);
  const channels = derivative.channels.map((channel) => ({
    levels: channel.levels.map((entry) => ({
      bucketSizeSamples: entry.bucket_size_samples,
      min: entry.min,
      max: entry.max,
    })),
  }));
  const reference = channels[0].levels;
  if (
    reference[0].min.length !==
    Math.ceil(
      Math.round(derivative.duration_seconds * derivative.sample_rate_hz) /
        reference[0].bucketSizeSamples,
    )
  ) {
    throw new Error("WAVEFORM_DURATION_COVERAGE_INVALID");
  }
  for (const channel of channels)
    for (let index = 0; index < channel.levels.length; index += 1) {
      const current = channel.levels[index],
        previous = channel.levels[index - 1];
      if (
        channel.levels.length !== reference.length ||
        current.min.length !== current.max.length ||
        current.min.some((value, position) => value > current.max[position]) ||
        current.min.length !== reference[index].min.length ||
        current.bucketSizeSamples !== reference[index].bucketSizeSamples ||
        (previous &&
          (current.bucketSizeSamples !== previous.bucketSizeSamples * 2 ||
            current.min.length !== Math.ceil(previous.min.length / 2)))
      ) {
        throw new Error("WAVEFORM_CHANNEL_LOD_INVALID");
      }
    }
  return {
    contractVersion: 2,
    durationSeconds: derivative.duration_seconds,
    sampleRateHz: derivative.sample_rate_hz,
    levels: reference,
    channels,
  };
}
