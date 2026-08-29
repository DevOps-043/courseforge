export interface OrderableMaterialLesson {
  created_at?: string | null;
  lesson_id: string;
  lesson_title?: string | null;
  module_id?: string | null;
}

function getGeneratedSequence(lessonId: string) {
  const match = lessonId.match(/-G(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function getDisplayedOrdinal(title?: string | null) {
  const match = title?.match(/(?:lecci[oó]n\s*)?(\d+)\s*[.:_-]\s*(\d+)/i);
  return match ? [Number(match[1]), Number(match[2])] as const : null;
}

function compareNullableNumbers(left: number | null, right: number | null) {
  if (left !== null && right !== null) return left - right;
  if (left !== null) return -1;
  if (right !== null) return 1;
  return 0;
}

/**
 * Restores the canonical flattened instructional-plan order. New material lesson
 * IDs carry that position in their `-G<n>` suffix. Title and creation time are
 * compatibility fallbacks for legacy/SCORM rows that predate that convention.
 */
export function sortMaterialLessonsCanonically<T extends OrderableMaterialLesson>(
  lessons: readonly T[],
): T[] {
  return lessons
    .map((lesson, originalIndex) => ({ lesson, originalIndex }))
    .sort((left, right) => {
      const generatedOrder = compareNullableNumbers(
        getGeneratedSequence(left.lesson.lesson_id),
        getGeneratedSequence(right.lesson.lesson_id),
      );
      if (generatedOrder !== 0) return generatedOrder;

      const leftOrdinal = getDisplayedOrdinal(left.lesson.lesson_title);
      const rightOrdinal = getDisplayedOrdinal(right.lesson.lesson_title);
      if (leftOrdinal && rightOrdinal) {
        const moduleDifference = leftOrdinal[0] - rightOrdinal[0];
        if (moduleDifference !== 0) return moduleDifference;
        const lessonDifference = leftOrdinal[1] - rightOrdinal[1];
        if (lessonDifference !== 0) return lessonDifference;
      }

      const createdAtDifference = String(left.lesson.created_at || "").localeCompare(
        String(right.lesson.created_at || ""),
      );
      return createdAtDifference || left.originalIndex - right.originalIndex;
    })
    .map(({ lesson }) => lesson);
}
