import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MaterialComponent, ProductionStatus } from "../../types/materials.types";
import { getLessonProductionProgress } from "../lesson-production-progress";

function componentWithStatus(status: ProductionStatus): MaterialComponent {
  return {
    id: `component-${status}`,
    material_lesson_id: "lesson-1",
    type: "VIDEO_THEORETICAL",
    content: {},
    source_refs: [],
    validation_status: "PASS",
    validation_errors: [],
    generated_at: "2026-08-29T00:00:00.000Z",
    iteration_number: 1,
    assets: { production_status: status },
  };
}

describe("lesson production progress", () => {
  it("reports an empty lesson without dividing by zero", () => {
    assert.deepEqual(getLessonProductionProgress([]), {
      completed: 0,
      inProgress: 0,
      percentage: 0,
      total: 0,
    });
  });

  it("separates completed, active and pending components", () => {
    const progress = getLessonProductionProgress([
      componentWithStatus("COMPLETED"),
      componentWithStatus("IN_PROGRESS"),
      componentWithStatus("DECK_READY"),
      componentWithStatus("EXPORTED"),
      componentWithStatus("PENDING"),
    ]);

    assert.deepEqual(progress, {
      completed: 1,
      inProgress: 3,
      percentage: 20,
      total: 5,
    });
  });
});
