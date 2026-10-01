import type { AudioWaveformPreview } from "./audio-processing.types";

/** Projects a source interval into vertical min/max bars, preserving peaks. */
export function buildAudioWaveformPath(input: {
  clipDurationSeconds: number;
  sourceOffsetSeconds: number;
  viewportWidthPixels: number;
  waveform: AudioWaveformPreview;
}) {
  const { waveform } = input;
  if (
    !Number.isFinite(input.clipDurationSeconds) || input.clipDurationSeconds <= 0
    || !Number.isFinite(input.sourceOffsetSeconds) || input.sourceOffsetSeconds < 0
    || !Number.isFinite(input.viewportWidthPixels) || input.viewportWidthPixels <= 0
    || waveform.min.length !== waveform.max.length || waveform.min.length === 0
  ) return "";

  const columns = Math.min(1024, Math.max(1, Math.ceil(input.viewportWidthPixels)));
  const bucketSeconds = waveform.bucketSizeSamples / waveform.sampleRateHz;
  if (input.sourceOffsetSeconds >= waveform.durationSeconds || bucketSeconds <= 0) return "";
  const segments: string[] = [];
  for (let column = 0; column < columns; column += 1) {
    const start = input.sourceOffsetSeconds + (column / columns) * input.clipDurationSeconds;
    if (start >= waveform.durationSeconds) break;
    const end = Math.min(waveform.durationSeconds, input.sourceOffsetSeconds + ((column + 1) / columns) * input.clipDurationSeconds);
    const first = Math.min(waveform.min.length - 1, Math.floor(start / bucketSeconds));
    const last = Math.min(waveform.min.length - 1, Math.max(first, Math.ceil(end / bucketSeconds) - 1));
    let minimum = 1;
    let maximum = -1;
    for (let index = first; index <= last; index += 1) {
      minimum = Math.min(minimum, waveform.min[index]);
      maximum = Math.max(maximum, waveform.max[index]);
    }
    const x = column + 0.5;
    segments.push(`M${x} ${((1 - maximum) * 50).toFixed(1)}V${((1 - minimum) * 50).toFixed(1)}`);
  }
  return segments.join("");
}
