export type ProductionMediaKind = "audio" | "image" | "video";

/** Accepts authenticated application paths and explicit HTTP(S) media URLs only. */
export function isAllowedProductionMediaSource(source: string | null | undefined) {
  const normalizedSource = source?.trim();
  if (!normalizedSource) return false;
  if (normalizedSource.startsWith("/api/storage/media?")) {
    return true;
  }

  try {
    const url = new URL(normalizedSource);
    return !url.username
      && !url.password
      && (url.protocol === "https:" || url.protocol === "http:");
  } catch {
    return false;
  }
}

export function formatProductionMediaDuration(durationSeconds: number | null | undefined) {
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }
  const roundedSeconds = Math.round(durationSeconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
