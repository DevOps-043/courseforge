import assert from "node:assert/strict";
import test from "node:test";
import {
  canIterateSyllabus,
  getNextSyllabusIteration,
  normalizeSyllabusIterationCount,
  SYLLABUS_MAX_ITERATIONS,
} from "../syllabus-iteration";

test("normaliza contadores ausentes o invalidos", () => {
  assert.equal(normalizeSyllabusIterationCount(undefined), 0);
  assert.equal(normalizeSyllabusIterationCount(-2), 0);
  assert.equal(normalizeSyllabusIterationCount(2.9), 2);
});

test("permite generar hasta cinco iteraciones", () => {
  assert.equal(SYLLABUS_MAX_ITERATIONS, 5);
  assert.equal(canIterateSyllabus(4), true);
  assert.equal(getNextSyllabusIteration(4), 5);
});

test("bloquea una sexta iteracion", () => {
  assert.equal(canIterateSyllabus(5), false);
  assert.throws(() => getNextSyllabusIteration(5), /limite de 5 iteraciones/);
});
