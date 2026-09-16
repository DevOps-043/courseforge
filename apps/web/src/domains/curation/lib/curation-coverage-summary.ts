import type { CurationRow } from "../types/curation.types";

export interface CurationCoverageLesson {
  id: string;
  title: string;
  requiredSources: number;
}

export interface CurationLessonCoverage {
  id: string;
  title: string;
  requiredSources: number;
  validSources: number;
  isComplete: boolean;
}

export function getCurationCoverageSummary(
  lessons: CurationCoverageLesson[],
  rows: CurationRow[],
) {
  const lessonCoverage = lessons.map((lesson): CurationLessonCoverage => {
    const validSources = new Set(
      rows
        .filter((row) => rowBelongsToLesson(row, lesson) && isValidCurationRow(row))
        .map(getSourceKey),
    ).size;

    return {
      ...lesson,
      validSources,
      isComplete: validSources >= lesson.requiredSources,
    };
  });

  return {
    completedLessons: lessonCoverage.filter((lesson) => lesson.isComplete).length,
    coveredRequiredSources: lessonCoverage.reduce(
      (total, lesson) => total + Math.min(lesson.validSources, lesson.requiredSources),
      0,
    ),
    lessonCoverage,
    requiredSources: lessonCoverage.reduce(
      (total, lesson) => total + lesson.requiredSources,
      0,
    ),
    totalLessons: lessonCoverage.length,
  };
}

function getSourceKey(row: CurationRow) {
  const sourceIdentity = row.source_kind === "pdf"
    ? row.content_sha256 || row.storage_path || row.source_ref
    : row.source_ref;
  return `${row.source_kind || "url"}:${(sourceIdentity || row.id).trim().toLowerCase()}`;
}

export function isValidCurationRow(row: CurationRow) {
  return Boolean(
    row.apta === true &&
      (!row.validation_report?.status || row.validation_report.status === "valid"),
  );
}

function rowBelongsToLesson(row: CurationRow, lesson: CurationCoverageLesson) {
  return (
    row.lesson_id === lesson.id ||
    normalizeLessonKey(row.lesson_id) === normalizeLessonKey(lesson.id) ||
    normalizeLessonKey(row.lesson_title) === normalizeLessonKey(lesson.title)
  );
}

function normalizeLessonKey(value: string | null | undefined) {
  return (value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}
