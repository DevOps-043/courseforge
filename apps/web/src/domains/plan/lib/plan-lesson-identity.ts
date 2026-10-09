/** Map model content by ID, never repair unknown IDs using array positions. */
export function alignPlanLessonsById<T extends { lesson_id: string }>(
  lessons: Array<{ id: string }>,
  plans: T[],
): T[] {
  const byId = new Map(plans.map((plan) => [plan.lesson_id, plan]));
  const expected = new Set(lessons.map((lesson) => lesson.id));
  if (
    byId.size !== plans.length ||
    plans.length !== lessons.length ||
    plans.some((plan) => !expected.has(plan.lesson_id))
  ) {
    throw new Error(
      "El plan no conserva una correspondencia exacta con los IDs de las lecciones del temario.",
    );
  }
  return lessons.map((lesson) => {
    const plan = byId.get(lesson.id);
    if (!plan) throw new Error("Falta una lección del temario en el plan.");
    return plan;
  });
}
