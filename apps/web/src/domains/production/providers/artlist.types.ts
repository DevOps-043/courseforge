export interface ArtlistTrack {
  artist: string;
  duration_seconds: number;
  genre: string;
  id: string;
  mood: string;
  public_url: string;
  title: string;
}

export interface ArtlistVideo {
  duration_seconds: number;
  id: string;
  public_url: string;
  tags: string[];
  thumbnail_url?: string;
  title: string;
}

export type ArtlistSearchResult = ArtlistTrack | ArtlistVideo;

export function isArtlistTrack(value: unknown): value is ArtlistTrack {
  if (!isRecord(value)) return false;
  return hasBaseFields(value) &&
    typeof value.artist === "string" &&
    typeof value.genre === "string" &&
    typeof value.mood === "string";
}

export function isArtlistVideo(value: unknown): value is ArtlistVideo {
  if (!isRecord(value)) return false;
  return hasBaseFields(value) &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string") &&
    (value.thumbnail_url === undefined || typeof value.thumbnail_url === "string");
}

export function parseArtlistSearchResults(
  value: unknown,
  type: "music" | "video",
): ArtlistSearchResult[] {
  if (!Array.isArray(value)) return [];
  return type === "music"
    ? value.filter(isArtlistTrack)
    : value.filter(isArtlistVideo);
}

function hasBaseFields(value: Record<string, unknown>) {
  return typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.public_url === "string" &&
    typeof value.duration_seconds === "number" &&
    Number.isFinite(value.duration_seconds);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
