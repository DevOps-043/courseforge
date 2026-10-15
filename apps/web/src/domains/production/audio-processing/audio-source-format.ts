import { normalizeAudioSourceMime } from "./audio-source-contract";

const AUDIO_EXTENSIONS = { "audio/mpeg": "mp3", "audio/wav": "wav", "audio/mp4": "m4a", "audio/aac": "aac" } as const;
type DetectedAudioMime = keyof typeof AUDIO_EXTENSIONS;

/** Container signature is a first gate; decoding and stream validation happen in the worker. */
export function detectAudioContainer(bytes: Uint8Array): DetectedAudioMime | null {
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "audio/wav";
  if (bytes.length >= 12 && ascii(4, 4) === "ftyp") return "audio/mp4";
  if (bytes.length >= 3 && ascii(0, 3) === "ID3") return "audio/mpeg";
  if (bytes.length >= 7 && bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0) return "audio/aac";
  if (bytes.length >= 4 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0 && (bytes[1]! & 0x06) !== 0) return "audio/mpeg";
  return null;
}

export function resolveImportedAudioFormat(header: string | null, bytes: Uint8Array) {
  const declared = (header || "").split(";", 1)[0]!.trim().toLowerCase();
  const detected = detectAudioContainer(bytes);
  if (!detected) throw new Error("El archivo de voz no contiene un formato MP3, WAV, M4A o AAC reconocible.");
  const generic = !declared || declared === "application/octet-stream" || declared === "binary/octet-stream";
  if (!generic && normalizeAudioSourceMime(declared) !== detected) {
    throw new Error("El contenido de la voz no coincide con el formato declarado.");
  }
  return { contentType: detected, extension: AUDIO_EXTENSIONS[detected] };
}
