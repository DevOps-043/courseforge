const TIMECODE_PRECISION = 1000;

/** Formats persisted seconds as an unambiguous human timecode. */
export function formatCompositionTimecode(value: number) {
  if (!Number.isFinite(value) || value < 0) return "";
  const totalMilliseconds = Math.round(value * TIMECODE_PRECISION);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  const prefix = hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
    : String(minutes).padStart(2, "0");
  return `${prefix}:${String(seconds).padStart(2, "0")}${milliseconds > 0 ? `.${String(milliseconds).padStart(3, "0")}` : ""}`;
}

/** Accepts MM:SS(.mmm), HH:MM:SS(.mmm), or raw seconds for compatibility. */
export function parseCompositionTimecode(rawValue: string) {
  const normalized = rawValue.trim().replace(",", ".");
  if (!normalized) return null;
  if (!normalized.includes(":")) {
    const seconds = Number(normalized);
    return Number.isFinite(seconds) && seconds >= 0 ? roundMilliseconds(seconds) : null;
  }

  const parts = normalized.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !part.trim())) return null;
  const values = parts.map(Number);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
  const seconds = values.at(-1)!;
  const minutes = values.at(-2)!;
  const hours = values.length === 3 ? values[0]! : 0;
  if (seconds >= 60 || (values.length === 3 && minutes >= 60)) return null;
  return roundMilliseconds((hours * 3600) + (minutes * 60) + seconds);
}

function roundMilliseconds(value: number) {
  return Math.round(value * TIMECODE_PRECISION) / TIMECODE_PRECISION;
}
