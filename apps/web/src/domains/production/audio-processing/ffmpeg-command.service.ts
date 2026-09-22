import type { AudioProcessingProfile } from "./audio-processing.types";

export interface FfmpegAudioCommand {
  args: string[];
  executable: "ffmpeg";
}

export interface BuildFfmpegAudioCommandInput {
  inputFilePath: string;
  outputFilePath: string;
  profile: AudioProcessingProfile;
}

/**
 * Builds arguments for spawn/execFile only. Callers must never concatenate
 * these values into a shell command. Local paths are created by the worker
 * after downloading an authorized Storage object.
 */
export function buildFfmpegAudioCommand(input: BuildFfmpegAudioCommandInput): FfmpegAudioCommand {
  assertWorkerFilePath(input.inputFilePath, "entrada");
  assertWorkerFilePath(input.outputFilePath, "salida");
  if (input.inputFilePath === input.outputFilePath) {
    throw new Error("FFMPEG_INPUT_OUTPUT_PATH_CONFLICT");
  }

  const filters = buildVoiceFilterChain(input.profile);
  return {
    executable: "ffmpeg",
    args: [
      "-hide_banner",
      "-nostdin",
      "-v", "error",
      "-xerror",
      "-i", input.inputFilePath,
      "-map", "0:a:0",
      "-vn",
      "-af", filters,
      "-c:a", input.profile.output.codec,
      "-b:a", `${input.profile.output.bitrateKbps}k`,
      "-ar", String(input.profile.output.sampleRateHz),
      "-ac", String(input.profile.output.channels),
      "-movflags", "+faststart",
      "-y",
      input.outputFilePath,
    ],
  };
}

export function buildVoiceFilterChain(profile: AudioProcessingProfile) {
  const { compressor, highPassFrequencyHz, limiterPeak, loudness } = profile.processing;
  return [
    `highpass=f=${highPassFrequencyHz}`,
    `acompressor=threshold=${compressor.thresholdDecibels}dB:ratio=${compressor.ratio}:attack=${compressor.attackMilliseconds}:release=${compressor.releaseMilliseconds}:makeup=${compressor.makeupDecibels}dB`,
    `alimiter=limit=${limiterPeak}`,
    `loudnorm=I=${loudness.integratedLufs}:LRA=${loudness.loudnessRangeLu}:TP=${loudness.truePeakDbtp}`,
  ].join(",");
}

function assertWorkerFilePath(value: string, label: string) {
  if (!value.trim() || value.includes("\0") || /^(?:https?|file):/i.test(value)) {
    throw new Error(`FFMPEG_${label.toUpperCase()}_PATH_INVALID`);
  }
}
