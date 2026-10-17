/** Original-rate, per-channel extrema. Memory is bounded independently of PCM size. */
export const WAVEFORM_ANALYSIS_PROFILE_ID = "waveform-analysis-v2";
export const WAVEFORM_MAX_BUCKETS = 65_536;
export const WAVEFORM_MAX_DURATION_SECONDS = 1800;
export const WAVEFORM_MAX_SOURCE_BYTES = 250 * 1024 * 1024;

export function createWaveformAccumulator(
  sampleRateHz: number,
  channelCount: number,
  durationSeconds: number,
) {
  if (
    !Number.isInteger(sampleRateHz) ||
    sampleRateHz < 8000 ||
    sampleRateHz > 192000 ||
    !Number.isInteger(channelCount) ||
    channelCount < 1 ||
    channelCount > 8 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    durationSeconds > WAVEFORM_MAX_DURATION_SECONDS
  ) {
    throw new Error("WAVEFORM_FORMAT_UNSUPPORTED");
  }
  const bucketSize = Math.max(
    1,
    Math.ceil((durationSeconds * sampleRateHz) / WAVEFORM_MAX_BUCKETS),
  );
  const channels = Array.from({ length: channelCount }, () => ({
    min: [] as number[],
    max: [] as number[],
  }));
  let remainder = Buffer.alloc(0);
  let frames = 0;
  const frameBytes = channelCount * 4;
  return {
    push(chunk: Buffer) {
      const bytes = remainder.length
        ? Buffer.concat([remainder, chunk])
        : chunk;
      const completeBytes = bytes.length - (bytes.length % frameBytes);
      for (let offset = 0; offset < completeBytes; offset += frameBytes) {
        const bucket = Math.floor(frames / bucketSize);
        if (bucket >= WAVEFORM_MAX_BUCKETS)
          throw new Error("WAVEFORM_DECODED_DURATION_EXCEEDED");
        for (let channel = 0; channel < channelCount; channel += 1) {
          const amplitude = bytes.readFloatLE(offset + channel * 4);
          if (!Number.isFinite(amplitude))
            throw new Error("WAVEFORM_PCM_INVALID");
          // Display is normalized; true-peak measurement remains a separate operation.
          const value = Math.max(-1, Math.min(1, amplitude));
          const extrema = channels[channel];
          extrema.min[bucket] = Math.min(extrema.min[bucket] ?? 1, value);
          extrema.max[bucket] = Math.max(extrema.max[bucket] ?? -1, value);
        }
        frames += 1;
      }
      remainder = Buffer.from(bytes.subarray(completeBytes));
    },
    finish() {
      if (!frames || remainder.length)
        throw new Error("WAVEFORM_PCM_INCOMPLETE");
      const levels = channels.map((channel) => {
        const pyramid = [
          {
            bucket_size_samples: bucketSize,
            min: channel.min,
            max: channel.max,
          },
        ];
        while (pyramid.at(-1)!.min.length > 256) {
          const previous = pyramid.at(-1)!;
          const min: number[] = [],
            max: number[] = [];
          for (let index = 0; index < previous.min.length; index += 2) {
            const right = Math.min(index + 1, previous.min.length - 1);
            min.push(Math.min(previous.min[index], previous.min[right]));
            max.push(Math.max(previous.max[index], previous.max[right]));
          }
          pyramid.push({
            bucket_size_samples: previous.bucket_size_samples * 2,
            min,
            max,
          });
        }
        return pyramid;
      });
      return {
        contract_version: 2 as const,
        duration_seconds: frames / sampleRateHz,
        sample_rate_hz: sampleRateHz,
        channels: levels.map((levels) => ({ levels })),
      };
    },
  };
}
