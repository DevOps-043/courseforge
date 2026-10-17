export const MIN_REQUIRED_AUDIO_PEAK_DBFS = -60;
const MAX_AUDIO_PROBE_OUTPUT_CHARS = 512 * 1024;

export interface ExportedAudioSignal {
  maxDbfs: number | null;
  meanDbfs: number | null;
  signalAboveFloor: boolean;
}

/** Parses FFmpeg volumedetect output; sample peak is not a true-peak measurement. */
export function parseExportedAudioSignal(stderr: string): ExportedAudioSignal {
  if (stderr.length > MAX_AUDIO_PROBE_OUTPUT_CHARS) throw new Error("EXPORTED_VIDEO_AUDIO_PROBE_OUTPUT_TOO_LARGE");
  const meanMatches = [...stderr.matchAll(/^\[Parsed_volumedetect_\d+\s+@[^\]\r\n]{1,120}\]\s*mean_volume:\s*(-inf|[-+]?\d+(?:\.\d+)?)\s+dB\s*$/gim)];
  const maxMatches = [...stderr.matchAll(/^\[Parsed_volumedetect_\d+\s+@[^\]\r\n]{1,120}\]\s*max_volume:\s*(-inf|[-+]?\d+(?:\.\d+)?)\s+dB\s*$/gim)];
  const meanRaw = meanMatches.at(-1)?.[1];
  const maxRaw = maxMatches.at(-1)?.[1];
  if (!meanRaw || !maxRaw) throw new Error("EXPORTED_VIDEO_AUDIO_MEASUREMENT_MISSING");
  const meanDbfs = meanRaw.toLowerCase() === "-inf" ? null : Number(meanRaw);
  const maxDbfs = maxRaw.toLowerCase() === "-inf" ? null : Number(maxRaw);
  if ((meanDbfs === null) !== (maxDbfs === null)
    || (meanDbfs !== null && maxDbfs !== null && meanDbfs > maxDbfs)) {
    throw new Error("EXPORTED_VIDEO_AUDIO_MEASUREMENT_INVALID");
  }
  return { maxDbfs, meanDbfs, signalAboveFloor: maxDbfs !== null && maxDbfs > MIN_REQUIRED_AUDIO_PEAK_DBFS };
}
