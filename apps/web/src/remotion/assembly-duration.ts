import type { MaterialAssets } from "@/domains/materials/types/materials.types";

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function parseTimecodeToSeconds(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const parts = value
    .trim()
    .split(":")
    .map((part) => Number(part));

  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) {
    return undefined;
  }

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return minutes * 60 + seconds;
  }

  const [hours, minutes, seconds] = parts;
  return hours * 3600 + minutes * 60 + seconds;
}

function collectSectionDurations(sections: unknown): number | undefined {
  if (!Array.isArray(sections)) {
    return undefined;
  }

  const total = sections.reduce((sum, section) => {
    const duration = (section as { duration_seconds?: unknown })?.duration_seconds;
    return sum + (isPositiveNumber(duration) ? duration : 0);
  }, 0);

  return total > 0 ? total : undefined;
}

function collectMaxTimecodeEnd(items: unknown): number | undefined {
  if (!Array.isArray(items)) {
    return undefined;
  }

  const maxEnd = items.reduce((max, item) => {
    const seconds = parseTimecodeToSeconds(
      (item as { timecode_end?: unknown })?.timecode_end,
    );
    return seconds && seconds > max ? seconds : max;
  }, 0);

  return maxEnd > 0 ? maxEnd : undefined;
}

export function deriveAssemblyTargetDurationSeconds(
  content: unknown,
): number | undefined {
  if (!content || typeof content !== "object") {
    return undefined;
  }

  const source = content as {
    duration_estimate_minutes?: unknown;
    script?: {
      duration_estimate_minutes?: unknown;
      sections?: unknown;
    };
    video_script?: {
      duration_estimate_minutes?: unknown;
      sections?: unknown;
    };
    storyboard?: unknown;
  };

  const candidates = [
    isPositiveNumber(source.duration_estimate_minutes)
      ? source.duration_estimate_minutes * 60
      : undefined,
    isPositiveNumber(source.script?.duration_estimate_minutes)
      ? source.script.duration_estimate_minutes * 60
      : undefined,
    isPositiveNumber(source.video_script?.duration_estimate_minutes)
      ? source.video_script.duration_estimate_minutes * 60
      : undefined,
    collectSectionDurations(source.script?.sections),
    collectSectionDurations(source.video_script?.sections),
    collectMaxTimecodeEnd(source.storyboard),
  ].filter(isPositiveNumber);

  if (candidates.length === 0) {
    return undefined;
  }

  return Math.round(Math.max(...candidates));
}

export function withAssemblyTargetDuration(
  assets: MaterialAssets | null | undefined,
  targetDurationSeconds: number | undefined,
): MaterialAssets {
  const merged = { ...(assets ?? {}) } as MaterialAssets;

  if (isPositiveNumber(targetDurationSeconds)) {
    merged.assembly_target_duration_seconds = targetDurationSeconds;
  }

  return merged;
}
