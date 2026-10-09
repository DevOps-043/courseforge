import { MAX_AUDIO_SOURCE_BYTES, normalizeAudioSourceMime, resolveAudioStorageSource } from "./audio-source-contract";

export interface AudioSourceCandidate {
  asset_type: string;
  checksum: string | null;
  file_size_bytes: number | null;
  metadata?: unknown;
  mime_type: string | null;
  qa_status?: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
}

export type AudioSourceRejectionCode = "AUDIO_SOURCE_INVALID" | "AUDIO_SOURCE_ARCHIVED" | "AUDIO_SOURCE_FORMAT_UNSUPPORTED"
  | "AUDIO_SOURCE_INTEGRITY_INVALID" | "AUDIO_SOURCE_STORAGE_INVALID" | "AUDIO_SOURCE_TOO_LARGE";
export type AudioSourceCapability = { eligible: true; code: null; reason: null } | { eligible: false; code: AudioSourceRejectionCode; reason: string };

/** Eligibility uses persisted provenance, never the track chosen by the browser. */
export function getAudioSourceCapability(source: AudioSourceCandidate): AudioSourceCapability {
  const reject = (code: AudioSourceRejectionCode, reason: string): AudioSourceCapability => ({ eligible: false, code, reason });
  const metadata = source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata)
    ? source.metadata as Record<string, unknown> : {};
  if (source.qa_status === "ARCHIVED" || source.qa_status === "REJECTED") return reject("AUDIO_SOURCE_ARCHIVED", "La narración está archivada o rechazada.");
  if (source.asset_type !== "VOICE_AUDIO" && !(source.asset_type === "SOURCE_MEDIA"
    && (metadata.timeline_role === "VOICE" || metadata.import_type === "voice"))) {
    return reject("AUDIO_SOURCE_INVALID", "El recurso no está registrado como narración de voz.");
  }
  if (!normalizeAudioSourceMime(source.mime_type)) return reject("AUDIO_SOURCE_FORMAT_UNSUPPORTED", "Formato de voz no admitido. Usa MP3, WAV, M4A o AAC.");
  if (!/^[a-f0-9]{64}$/.test(source.checksum || "")) return reject("AUDIO_SOURCE_INTEGRITY_INVALID", "La narración no tiene un checksum válido.");
  try { resolveAudioStorageSource(source.storage_bucket, source.storage_path); }
  catch { return reject("AUDIO_SOURCE_STORAGE_INVALID", "La narración no tiene una ubicación de almacenamiento válida."); }
  if (!Number.isSafeInteger(source.file_size_bytes) || source.file_size_bytes! <= 0 || source.file_size_bytes! > MAX_AUDIO_SOURCE_BYTES) {
    return reject("AUDIO_SOURCE_TOO_LARGE", "El audio fuente debe pesar entre 1 byte y 50 MB.");
  }
  return { eligible: true, code: null, reason: null };
}
