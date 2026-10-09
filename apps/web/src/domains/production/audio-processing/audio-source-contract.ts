/** Mirrored in the independently deployed API worker; checked by contract parity tests. */
export const AUDIO_SOURCE_MIME_TYPES = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/aac"] as const;
export type AudioSourceMimeType = typeof AUDIO_SOURCE_MIME_TYPES[number];
export const MAX_AUDIO_SOURCE_BYTES = 50 * 1024 * 1024;
export const AUDIO_SOURCE_BUCKETS = ["production-assets", "production-render-sources", "sound-effect-assets"] as const;

export function normalizeAudioSourceMime(value: string | null): AudioSourceMimeType | null {
  const mime = (value || "").split(";", 1)[0]!.trim().toLowerCase();
  if (mime === "audio/mp3") return "audio/mpeg";
  if (["audio/x-wav", "audio/wave", "audio/vnd.wave"].includes(mime)) return "audio/wav";
  if (["audio/m4a", "audio/x-m4a"].includes(mime)) return "audio/mp4";
  if (mime === "audio/x-aac") return "audio/aac";
  return AUDIO_SOURCE_MIME_TYPES.includes(mime as AudioSourceMimeType) ? mime as AudioSourceMimeType : null;
}

export function resolveAudioStorageSource(bucket: string | null, path: string | null) {
  if (!AUDIO_SOURCE_BUCKETS.includes(bucket as typeof AUDIO_SOURCE_BUCKETS[number])) {
    throw new Error("AUDIO_SOURCE_BUCKET_NOT_ALLOWED");
  }
  if (!path || path !== path.trim() || path.length > 2_000 || /[\\\u0000-\u001f]/.test(path)
    || path.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw new Error("AUDIO_SOURCE_STORAGE_INVALID");
  }
  const prefix = `${bucket}/`;
  const objectPath = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  if (!objectPath || objectPath.split("/").some((segment) => !segment || segment === "." || segment === "..")
    || /%(?:2e|2f|5c|00)/i.test(objectPath)
    || AUDIO_SOURCE_BUCKETS.some((knownBucket) => objectPath.startsWith(`${knownBucket}/`))) {
    throw new Error("AUDIO_SOURCE_STORAGE_INVALID");
  }
  return { storageBucket: bucket!, storagePath: objectPath };
}
