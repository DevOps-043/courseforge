import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AudioProcessingTerminalError } from "./audio-worker-errors";

const execFileAsync = promisify(execFile);
// At 192 kbps, 30 minutes stays below the existing 50 MB output limit.
export const MAX_AUDIO_DURATION_SECONDS = 30 * 60;
const AUDIO_CONTAINERS = new Set(["mp3", "wav", "mov", "mp4", "m4a", "3gp", "3g2", "mj2", "aac"]);
const AUDIO_CODECS = new Set(["mp3", "aac", "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_f64le", "pcm_u8"]);

export function validateAudioSourceProbe(value: unknown): number {
  if (!value || typeof value !== "object") throw new AudioProcessingTerminalError("AUDIO_SOURCE_PROBE_INVALID");
  const probe = value as { format?: { format_name?: string; duration?: string }; streams?: { codec_type?: string; codec_name?: string; duration?: string; disposition?: { attached_pic?: number } }[] };
  if (!Array.isArray(probe.streams)) throw new AudioProcessingTerminalError("AUDIO_SOURCE_PROBE_INVALID");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  if (!audio) throw new AudioProcessingTerminalError("AUDIO_SOURCE_HAS_NO_AUDIO");
  if (probe.streams.some((stream) => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1)) {
    throw new AudioProcessingTerminalError("AUDIO_SOURCE_VIDEO_NOT_SUPPORTED");
  }
  if (!probe.format?.format_name?.split(",").some((format) => AUDIO_CONTAINERS.has(format)) || !AUDIO_CODECS.has(audio.codec_name || "")) {
    throw new AudioProcessingTerminalError("AUDIO_SOURCE_CODEC_UNSUPPORTED");
  }
  const duration = Number(audio.duration ?? probe.format.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new AudioProcessingTerminalError("AUDIO_SOURCE_DURATION_INVALID");
  if (duration > MAX_AUDIO_DURATION_SECONDS) throw new AudioProcessingTerminalError("AUDIO_SOURCE_DURATION_TOO_LARGE");
  return duration;
}

export async function probeAudioSource(inputPath: string) {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries",
      "format=format_name,duration:stream=codec_type,codec_name,duration:stream_disposition=attached_pic", "-of", "json", inputPath,
    ], { encoding: "utf8", maxBuffer: 64 * 1024, timeout: 30_000, windowsHide: true }));
  } catch { throw new AudioProcessingTerminalError("AUDIO_SOURCE_PROBE_FAILED"); }
  let probe: unknown;
  try { probe = JSON.parse(stdout); }
  catch { throw new AudioProcessingTerminalError("AUDIO_SOURCE_PROBE_INVALID"); }
  return validateAudioSourceProbe(probe);
}
