import type { CurationCoverageItem, CurationLesson } from "./types";

interface CoverageRow {
  lesson_id: string;
  apta: boolean | null;
  validation_report?: { status?: string } | null;
}

export function calculateLessonCoverage(
  lessons: CurationLesson[],
  rows: CoverageRow[],
  targetCount = 2,
): CurationCoverageItem[] {
  return lessons.map((lesson) => {
    const validCount = rows.filter(
      (row) =>
        row.lesson_id === lesson.lesson_id &&
        row.apta === true &&
        (!row.validation_report?.status ||
          row.validation_report.status === "valid"),
    ).length;
    return {
      lessonId: lesson.lesson_id,
      lessonTitle: lesson.lesson_title,
      validCount,
      targetCount,
      isCovered: validCount >= 1,
    };
  });
}

export function getMissingLessonCoverage(
  lessons: CurationLesson[],
  rows: CoverageRow[],
) {
  return calculateLessonCoverage(lessons, rows).filter((item) => !item.isCovered);
}
