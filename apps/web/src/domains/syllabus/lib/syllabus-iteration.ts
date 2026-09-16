export const SYLLABUS_MAX_ITERATIONS = 5;

export function normalizeSyllabusIterationCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

export function canIterateSyllabus(value: unknown) {
  return normalizeSyllabusIterationCount(value) < SYLLABUS_MAX_ITERATIONS;
}

export function getNextSyllabusIteration(value: unknown) {
  const currentIteration = normalizeSyllabusIterationCount(value);
  if (currentIteration >= SYLLABUS_MAX_ITERATIONS) {
    throw new Error(
      `SYLLABUS_ITERATION_LIMIT: El temario alcanzo el limite de ${SYLLABUS_MAX_ITERATIONS} iteraciones.`,
    );
  }

  return currentIteration + 1;
}
