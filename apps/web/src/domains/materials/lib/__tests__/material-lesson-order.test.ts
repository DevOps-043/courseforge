import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sortMaterialLessonsCanonically } from "../material-lesson-order";

describe("material lesson canonical order", () => {
  it("restores generation order when opaque source IDs sort incorrectly", () => {
    const lessons = [
      { lesson_id: "opaque-z-G10", lesson_title: "Lección 2.5: Cierre" },
      { lesson_id: "opaque-a-G6", lesson_title: "Lección 2.1: Inicio" },
      { lesson_id: "opaque-b-G7", lesson_title: "Lección 2.2: Desarrollo" },
    ];

    assert.deepEqual(
      sortMaterialLessonsCanonically(lessons).map((lesson) => lesson.lesson_title),
      ["Lección 2.1: Inicio", "Lección 2.2: Desarrollo", "Lección 2.5: Cierre"],
    );
  });

  it("uses displayed module and lesson ordinals for legacy rows", () => {
    const lessons = [
      { lesson_id: "legacy-c", lesson_title: "Lección 2.5: Cierre" },
      { lesson_id: "legacy-a", lesson_title: "Lección 2.1: Inicio" },
    ];

    assert.deepEqual(
      sortMaterialLessonsCanonically(lessons).map((lesson) => lesson.lesson_id),
      ["legacy-a", "legacy-c"],
    );
  });
});
