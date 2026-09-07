import assert from "node:assert/strict";
import test from "node:test";
import {
  canIteratePlan,
  getPlanIterationCount,
  getNextPlanIteration,
  normalizePlanIterationCount,
  PLAN_MAX_ITERATIONS,
} from "../plan-iteration";

test("normaliza contadores de iteracion del plan", () => {
  assert.equal(normalizePlanIterationCount(undefined), 0);
  assert.equal(normalizePlanIterationCount(-2), 0);
  assert.equal(normalizePlanIterationCount(3.8), 3);
  assert.equal(getPlanIterationCount(0, true), 1);
  assert.equal(getPlanIterationCount(0, false), 0);
});

test("permite generar hasta cinco iteraciones del plan", () => {
  assert.equal(PLAN_MAX_ITERATIONS, 5);
  assert.equal(canIteratePlan(4), true);
  assert.equal(getNextPlanIteration(4), 5);
});

test("bloquea una sexta iteracion del plan", () => {
  assert.equal(canIteratePlan(5), false);
  assert.throws(() => getNextPlanIteration(5), /limite de 5 iteraciones/);
});
