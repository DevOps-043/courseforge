export const PLAN_MAX_ITERATIONS = 5;

export function normalizePlanIterationCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

export function getPlanIterationCount(
  value: unknown,
  hasExistingPlan = false,
) {
  const normalizedValue = normalizePlanIterationCount(value);
  return hasExistingPlan ? Math.max(1, normalizedValue) : normalizedValue;
}

export function canIteratePlan(value: unknown) {
  return normalizePlanIterationCount(value) < PLAN_MAX_ITERATIONS;
}

export function getNextPlanIteration(value: unknown) {
  const currentIteration = normalizePlanIterationCount(value);
  if (currentIteration >= PLAN_MAX_ITERATIONS) {
    throw new Error(
      `PLAN_ITERATION_LIMIT: El plan instruccional alcanzo el limite de ${PLAN_MAX_ITERATIONS} iteraciones.`,
    );
  }

  return currentIteration + 1;
}
