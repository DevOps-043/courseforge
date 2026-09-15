import assert from "node:assert/strict";
import { calculateLessonCoverage, getMissingLessonCoverage } from "../coverage";
import type { CurationLesson } from "../types";
import { getLessonSourceRequirement } from "../../../../../src/domains/curation/lib/lesson-source-requirement";
import { getCurationCoverageSummary } from "../../../../../src/domains/curation/lib/curation-coverage-summary";
import type { CurationRow } from "../../../../../src/domains/curation/types/curation.types";

const lessons: CurationLesson[] = [
  {
    lesson_id: "lesson-1",
    lesson_title: "Lesson one",
    lesson_objective: "",
    module_title: "",
    required_sources: 4,
    video_target_seconds: 660,
  },
  {
    lesson_id: "lesson-2",
    lesson_title: "Lesson two",
    lesson_objective: "",
    module_title: "",
    required_sources: 2,
    video_target_seconds: 0,
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
    validation_report: { status: "valid" },
    source_ref: "https://example.com/source",
  },
  {
    lesson_id: "lesson-2",
    apta: true,
    validation_report: { status: "valid" },
    source_ref: "https://example.com/source",
  },
  {
    lesson_id: "lesson-2",
    apta: true,
    validation_report: { status: "valid" },
    source_ref: "https://example.com/second-source",
  },
];

const coverage = calculateLessonCoverage(lessons, rows);
assert.equal(coverage[0].validCount, 1);
assert.equal(coverage[0].targetCount, 4);
assert.equal(coverage[0].isCovered, false);
assert.equal(coverage[1].validCount, 2);
assert.equal(coverage[1].targetCount, 2);
assert.equal(coverage[1].isCovered, true);
assert.deepEqual(
  getMissingLessonCoverage(lessons, rows).map((item) => item.lessonId),
  ["lesson-1"],
);

assert.deepEqual(
  getLessonSourceRequirement({
    components: [
      {
        type: "VIDEO_THEORETICAL",
        duration_contract: { targetDurationSeconds: 660 },
      },
    ],
  }),
  { requiredSources: 4, videoTargetSeconds: 660 },
);
assert.deepEqual(
  getLessonSourceRequirement({
    components: [{ type: "VIDEO_DEMO", duration: "14–16 min" }],
  }),
  { requiredSources: 5, videoTargetSeconds: 900 },
);
assert.deepEqual(
  getLessonSourceRequirement({
    components: [
      { type: "VIDEO_GUIDE", duration_contract: { targetDurationSeconds: 360 } },
      { type: "VIDEO_DEMO", duration_contract: { targetDurationSeconds: 360 } },
    ],
  }),
  { requiredSources: 4, videoTargetSeconds: 720 },
);
assert.deepEqual(
  getLessonSourceRequirement({ components: [{ type: "READING", duration: "20 min" }] }),
  { requiredSources: 2, videoTargetSeconds: 0 },
);

const uiCoverage = getCurationCoverageSummary(
  [
    { id: "lesson-1", title: "Lección Única", requiredSources: 2 },
    { id: "lesson-2", title: "Segunda lección", requiredSources: 4 },
  ],
  [
    { id: "row-1", lesson_id: "legacy-id", lesson_title: "Leccion Unica", apta: true, source_ref: "https://example.com/a", validation_report: { status: "valid" } },
    { id: "row-2", lesson_id: "lesson-1", lesson_title: "Lección Única", apta: true, source_ref: "https://example.com/b", validation_report: { status: "valid" } },
    { id: "row-3", lesson_id: "lesson-2", lesson_title: "Segunda lección", apta: true, source_ref: "https://example.com/c", validation_report: { status: "valid" } },
  ] as CurationRow[],
);
assert.deepEqual(
  {
    completedLessons: uiCoverage.completedLessons,
    coveredRequiredSources: uiCoverage.coveredRequiredSources,
    requiredSources: uiCoverage.requiredSources,
    totalLessons: uiCoverage.totalLessons,
  },
  {
    completedLessons: 1,
    coveredRequiredSources: 3,
    requiredSources: 6,
    totalLessons: 2,
  },
);

console.log("curation-v2 coverage tests passed");
