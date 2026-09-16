interface SyllabusLessonLike {
  id?: unknown;
}

interface SyllabusModuleLike {
  lessons?: unknown;
}

interface PlanLessonLike {
  lesson_id?: unknown;
}

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The plan must preserve the syllabus lesson identity one-to-one. This is a
 * deterministic completion gate; an AI quality score cannot replace it.
 */
export function getInstructionalPlanCompletenessIssues(
  rawModules: unknown,
  rawLessonPlans: unknown,
) {
  if (!Array.isArray(rawModules) || rawModules.length === 0) {
    return ["El temario no contiene módulos para comparar el plan."];
  }
  if (!Array.isArray(rawLessonPlans)) {
    return ["El plan instruccional no contiene una lista de lecciones válida."];
  }

  const expectedIds = rawModules.flatMap((rawModule, moduleIndex) => {
    const syllabusModule = (rawModule || {}) as SyllabusModuleLike;
    const lessons = Array.isArray(syllabusModule.lessons)
      ? syllabusModule.lessons
      : [];
    return lessons.map((rawLesson, lessonIndex) => {
      const lesson = (rawLesson || {}) as SyllabusLessonLike;
      return asNonEmptyString(lesson.id) ||
        `lesson-${moduleIndex + 1}-${lessonIndex + 1}`;
    });
  });
  const generatedIds = rawLessonPlans.map((rawLesson, index) => {
    const lesson = (rawLesson || {}) as PlanLessonLike;
    return asNonEmptyString(lesson.lesson_id) || `missing-id-${index + 1}`;
  });
  const generatedSet = new Set(generatedIds);
  const expectedSet = new Set(expectedIds);
  const duplicateIds = generatedIds.filter(
    (id, index) => generatedIds.indexOf(id) !== index,
  );
  const missingIds = expectedIds.filter((id) => !generatedSet.has(id));
  const unexpectedIds = generatedIds.filter((id) => !expectedSet.has(id));
  const issues: string[] = [];

  if (generatedIds.length !== expectedIds.length) {
    issues.push(
      `El plan contiene ${generatedIds.length} lecciones y el temario requiere ${expectedIds.length}.`,
    );
  }
  if (missingIds.length > 0) {
    issues.push(`Faltan lecciones del temario: ${missingIds.join(", ")}.`);
  }
  if (unexpectedIds.length > 0) {
    issues.push(`El plan contiene lecciones desconocidas: ${unexpectedIds.join(", ")}.`);
  }
  if (duplicateIds.length > 0) {
    issues.push(
      `El plan repite identificadores de lección: ${[...new Set(duplicateIds)].join(", ")}.`,
    );
  }

  return issues;
}
