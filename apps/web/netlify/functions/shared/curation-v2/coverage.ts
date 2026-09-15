import type { CurationCoverageItem, CurationLesson } from "./types";

interface CoverageRow {
  id?: string;
  lesson_id: string;
  apta: boolean | null;
  content_sha256?: string | null;
  source_kind?: string | null;
  source_ref?: string | null;
  storage_path?: string | null;
  validation_report?: { status?: string } | null;
}

export function calculateLessonCoverage(
  lessons: CurationLesson[],
  rows: CoverageRow[],
): CurationCoverageItem[] {
  return lessons.map((lesson) => {
    const targetCount = Math.max(1, lesson.required_sources || 2);
    const validCount = new Set(
      rows
        .filter(
          (row) =>
            row.lesson_id === lesson.lesson_id &&
            row.apta === true &&
            (!row.validation_report?.status ||
              row.validation_report.status === "valid"),
        )
        .map(coverageSourceKey),
    ).size;
    return {
      lessonId: lesson.lesson_id,
      lessonTitle: lesson.lesson_title,
      validCount,
      targetCount,
      isCovered: validCount >= targetCount,
    };
  });
}

function coverageSourceKey(row: CoverageRow, index: number) {
  const sourceIdentity = row.source_kind === "pdf"
    ? row.content_sha256 || row.storage_path || row.source_ref
    : row.source_ref;
  return `${row.source_kind || "url"}:${(sourceIdentity || row.id || `row-${index}`).trim().toLowerCase()}`;
}

export function getMissingLessonCoverage(
  lessons: CurationLesson[],
  rows: CoverageRow[],
) {
  return calculateLessonCoverage(lessons, rows).filter((item) => !item.isCovered);
}
