import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Artifact } from "../artifacts-list.types";
import { getArtifactProgress } from "../artifacts-list.utils";

function artifact(overrides: Partial<Artifact>): Artifact {
  return {
    created_at: "2026-01-01T00:00:00.000Z",
    created_by: "user-1",
    descripcion: null,
    id: "artifact-1",
    idea_central: "Curso",
    state: "DRAFT",
    ...overrides,
  };
}

describe("artifact pipeline progress", () => {
  it("uses six equally weighted approved phases", () => {
    assert.equal(getArtifactProgress(artifact({ state: "APPROVED" })).percent, 17);
    assert.equal(getArtifactProgress(artifact({ state: "APPROVED", syllabus_state: "STEP_APPROVED" })).percent, 33);
    assert.equal(getArtifactProgress(artifact({ state: "APPROVED", syllabus_state: "STEP_APPROVED", plan_state: "STEP_APPROVED" })).percent, 50);
    assert.equal(getArtifactProgress(artifact({ state: "APPROVED", syllabus_state: "STEP_APPROVED", plan_state: "STEP_APPROVED", curation_state: "PHASE2_APPROVED", materials_state: "PHASE3_APPROVED" })).percent, 83);
  });

  it("reflects validation and real production completion", () => {
    assert.equal(getArtifactProgress(artifact({ state: "APPROVED", syllabus_state: "STEP_APPROVED", plan_state: "STEP_APPROVED", curation_state: "PHASE2_VALIDATING" })).percent, 60);
    assert.equal(getArtifactProgress(artifact({ state: "APPROVED", production_status: { total: 4, completed: 2 } })).percent, 92);
    assert.equal(getArtifactProgress(artifact({ state: "APPROVED", production_complete: true })).percent, 100);
  });

  it("does not report a rejected first phase as complete", () => {
    assert.equal(getArtifactProgress(artifact({ state: "REJECTED" })).percent, 13);
  });
});
