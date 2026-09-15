const DEFAULT_REQUIRED_SOURCES = 2;
const MAX_REQUIRED_SOURCES = 10;
const SECONDS_PER_SOURCE = 3 * 60;

interface LessonComponentLike {
  duration?: unknown;
  duration_contract?: unknown;
  type?: unknown;
}

interface LessonWithComponents {
  components?: unknown[] | null;
}

export interface LessonSourceRequirement {
  requiredSources: number;
  videoTargetSeconds: number;
}

export function getRequiredSourcesForVideoDuration(videoTargetSeconds: number) {
  if (!Number.isFinite(videoTargetSeconds) || videoTargetSeconds <= 0) {
    return DEFAULT_REQUIRED_SOURCES;
  }

  return Math.min(
    MAX_REQUIRED_SOURCES,
    Math.max(DEFAULT_REQUIRED_SOURCES, Math.ceil(videoTargetSeconds / SECONDS_PER_SOURCE)),
  );
}

export function getLessonSourceRequirement(
  lesson: LessonWithComponents | null | undefined,
): LessonSourceRequirement {
  const videoTargetSeconds = (lesson?.components || []).reduce<number>(
    (total, rawComponent) => total + getVideoTargetSeconds(rawComponent),
    0,
  );

  return {
    requiredSources: getRequiredSourcesForVideoDuration(videoTargetSeconds),
    videoTargetSeconds,
  };
}

function getVideoTargetSeconds(rawComponent: unknown) {
  const component = asRecord(rawComponent) as LessonComponentLike | null;
  if (!component || !isVideoComponentType(component.type)) return 0;

  const contract = asRecord(component.duration_contract);
  const contractedSeconds = contract?.targetDurationSeconds;
  if (
    typeof contractedSeconds === "number" &&
    Number.isFinite(contractedSeconds) &&
    contractedSeconds > 0
  ) {
    return Math.round(contractedSeconds);
  }

  return parseDurationTargetSeconds(component.duration);
}

function parseDurationTargetSeconds(value: unknown) {
  if (typeof value !== "string") return 0;
  const matches = value
    .match(/\d+(?:[.,]\d+)?/g)
    ?.map((match) => Number(match.replace(",", ".")))
    .filter((minutes) => Number.isFinite(minutes) && minutes > 0);
  if (!matches?.length) return 0;

  const targetMinutes = matches.length > 1
    ? (Math.min(matches[0], matches[1]) + Math.max(matches[0], matches[1])) / 2
    : matches[0];
  return Math.round(targetMinutes * 60);
}

function isVideoComponentType(value: unknown) {
  return value === "VIDEO_THEORETICAL" || value === "VIDEO_DEMO" || value === "VIDEO_GUIDE";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
