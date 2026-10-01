export const AUDIO_WAVEFORM_CONTRACT_VERSION = 1;
export const AUDIO_WAVEFORM_SAMPLE_RATE_HZ = 400;
const MAX_BASE_BUCKETS = 65_536;

export interface AudioWaveformLevel {
  bucket_size_samples: number;
  max: number[];
  min: number[];
}

export interface AudioWaveformDerivative {
  contract_version: typeof AUDIO_WAVEFORM_CONTRACT_VERSION;
  duration_seconds: number;
  levels: AudioWaveformLevel[];
  sample_rate_hz: typeof AUDIO_WAVEFORM_SAMPLE_RATE_HZ;
}

export interface AudioWaveformManifest {
  checksum: string;
  contract_version: typeof AUDIO_WAVEFORM_CONTRACT_VERSION;
  duration_seconds: number;
  level_count: number;
  sample_rate_hz: typeof AUDIO_WAVEFORM_SAMPLE_RATE_HZ;
  storage_bucket: "production-assets";
  storage_path: string;
}

export function buildWaveformExtractionArgs(inputPath: string, outputPath: string) {
  assertLocalWorkerPath(inputPath);
  assertLocalWorkerPath(outputPath);
  if (inputPath === outputPath) throw new Error("AUDIO_WAVEFORM_PATH_CONFLICT");
  return [
    "-hide_banner", "-nostdin", "-v", "error", "-xerror", "-i", inputPath,
    "-map", "0:a:0", "-vn", "-ac", "1", "-ar", String(AUDIO_WAVEFORM_SAMPLE_RATE_HZ),
    "-c:a", "pcm_s16le", "-f", "s16le", "-y", outputPath,
  ];
}

/** Builds a min/max pyramid from mono PCM16. Every coarser level is derived
 * from the previous extrema, so zoom changes never invent or lose a peak. */
export function buildWaveformDerivative(
  pcm: Buffer,
  durationSeconds: number,
): AudioWaveformDerivative {
  if (pcm.byteLength === 0 || pcm.byteLength % 2 !== 0) {
    throw new Error("AUDIO_WAVEFORM_PCM_INVALID");
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("AUDIO_WAVEFORM_DURATION_INVALID");
  }

  const sampleCount = pcm.byteLength / 2;
  const baseBucketSize = Math.max(1, Math.ceil(sampleCount / MAX_BASE_BUCKETS));
  const firstLevel = bucketPcm(pcm, baseBucketSize);
  const levels: AudioWaveformLevel[] = [{ bucket_size_samples: baseBucketSize, ...firstLevel }];

  while (levels.at(-1)!.min.length > 256) {
    const previous = levels.at(-1)!;
    levels.push({
      bucket_size_samples: previous.bucket_size_samples * 2,
      ...mergeExtrema(previous.min, previous.max),
    });
  }

  return {
    contract_version: AUDIO_WAVEFORM_CONTRACT_VERSION,
    duration_seconds: durationSeconds,
    levels,
    sample_rate_hz: AUDIO_WAVEFORM_SAMPLE_RATE_HZ,
  };
}

function bucketPcm(pcm: Buffer, bucketSize: number) {
  const sampleCount = pcm.byteLength / 2;
  const bucketCount = Math.ceil(sampleCount / bucketSize);
  const min = new Array<number>(bucketCount);
  const max = new Array<number>(bucketCount);
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    let bucketMin = 1;
    let bucketMax = -1;
    const end = Math.min(sampleCount, (bucket + 1) * bucketSize);
    for (let sample = bucket * bucketSize; sample < end; sample += 1) {
      const normalized = pcm.readInt16LE(sample * 2) / 32_768;
      bucketMin = Math.min(bucketMin, normalized);
      bucketMax = Math.max(bucketMax, normalized);
    }
    min[bucket] = roundAmplitude(bucketMin);
    max[bucket] = roundAmplitude(bucketMax);
  }
  return { min, max };
}

function mergeExtrema(minimums: number[], maximums: number[]) {
  const length = Math.ceil(minimums.length / 2);
  const min = new Array<number>(length);
  const max = new Array<number>(length);
  for (let index = 0; index < length; index += 1) {
    const left = index * 2;
    const right = Math.min(left + 1, minimums.length - 1);
    min[index] = Math.min(minimums[left], minimums[right]);
    max[index] = Math.max(maximums[left], maximums[right]);
  }
  return { min, max };
}

function roundAmplitude(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function assertLocalWorkerPath(value: string) {
  if (!value.trim() || value.includes("\0") || /^(?:https?|file):/i.test(value)) {
    throw new Error("AUDIO_WAVEFORM_PATH_INVALID");
  }
}
