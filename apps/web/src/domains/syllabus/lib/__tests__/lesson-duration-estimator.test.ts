import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGeneratedLessonDurationEstimates,
  calculateEstimatedCourseHours,
  estimateLessonDuration,
  fillMissingLessonDurationEstimates,
} from "../lesson-duration-estimator";
import type { SyllabusModule } from "../../types/syllabus.types";

const lesson = (objective_specific: string, estimated_minutes?: number) => ({
  title: "Lección de prueba",
  objective_specific,
  estimated_minutes,
});

const moduleWith = (...lessons: ReturnType<typeof lesson>[]): SyllabusModule => ({
  objective_general_ref: "Objetivo general",
  title: "Módulo de prueba",
  lessons,
});

test("estimates lesson time from video duration and Bloom complexity", () => {
  assert.deepEqual(
    [
      estimateLessonDuration(lesson("Identificar los conceptos clave")),
      estimateLessonDuration(lesson("Aplicar el proceso en un caso real")),
      estimateLessonDuration(lesson("Analizar riesgos y resultados")),
      estimateLessonDuration(lesson("Diseñar una solución verificable")),
    ].map(({ complexity, estimatedMinutes }) => ({
      complexity,
      estimatedMinutes,
    })),
    [
      { complexity: "FOUNDATIONAL", estimatedMinutes: 30 },
      { complexity: "APPLIED", estimatedMinutes: 40 },
      { complexity: "ANALYTICAL", estimatedMinutes: 40 },
      { complexity: "CREATIVE", estimatedMinutes: 45 },
    ],
  );
});

test("responds to the video duration selected at course creation", () => {
  const estimate = estimateLessonDuration(
    lesson("Diseñar una solución verificable"),
    {
      maximumDurationSeconds: 720,
      minimumDurationSeconds: 600,
      narrationWordsPerMinute: 145,
      targetDurationSeconds: 660,
      version: 1,
      visualBeatCadenceSeconds: 25,
    },
  );

  assert.equal(estimate.videoMinutes, 11);
  assert.equal(estimate.estimatedMinutes, 50);
});

test("overrides AI estimates for new generations but preserves manual legacy values", () => {
  const modules = [
    moduleWith(
      lesson("Aplicar el proceso", 30),
      lesson("Identificar los conceptos", 55),
      lesson("Analizar los riesgos"),
    ),
  ];

  const generated = applyGeneratedLessonDurationEstimates(modules);
  assert.deepEqual(
    generated[0].lessons.map((item) => item.estimated_minutes),
    [40, 30, 40],
  );

  const legacy = fillMissingLessonDurationEstimates(modules);
  assert.deepEqual(
    legacy[0].lessons.map((item) => item.estimated_minutes),
    [30, 55, 40],
  );
});

test("calculates course hours from per-lesson estimates instead of an average", () => {
  const modules = [
    moduleWith(
      lesson("Identificar conceptos", 25),
      lesson("Aplicar un proceso", 35),
      lesson("Analizar resultados", 40),
      lesson("Diseñar una solución", 45),
    ),
  ];

  assert.equal(calculateEstimatedCourseHours(modules), 2.4);
});
