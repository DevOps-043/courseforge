import assert from "node:assert/strict";
import { calculateLessonCoverage, getMissingLessonCoverage } from "../coverage";
import type { CurationLesson } from "../types";

const lessons: CurationLesson[] = [
  {
    lesson_id: "lesson-1",
    lesson_title: "Lesson one",
    lesson_objective: "",
    module_title: "",
  },
  {
    lesson_id: "lesson-2",
    lesson_title: "Lesson two",
    lesson_objective: "",
    module_title: "",
  },
];

const rows = [
  {
    lesson_id: "lesson-1",
    apta: true,
    validation_report: { status: "valid" },
  },
  {
    lesson_id: "lesson-1",
    apta: false,
    validation_report: { status: "invalid" },
  },
  {
    lesson_id: "lesson-2",
    apta: true,
    validation_report: { status: "review_required" },
  },
];

const coverage = calculateLessonCoverage(lessons, rows);
assert.equal(coverage[0].validCount, 1);
assert.equal(coverage[0].isCovered, true);
assert.equal(coverage[1].validCount, 0);
assert.equal(coverage[1].isCovered, false);
assert.deepEqual(
  getMissingLessonCoverage(lessons, rows).map((item) => item.lessonId),
  ["lesson-2"],
);

console.log("curation-v2 coverage tests passed");
