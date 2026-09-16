import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapProductionCourseContext,
  type ProductionCourseContextRow,
} from "../production-course-context";

function buildRow(organizationId: string): ProductionCourseContextRow {
  return {
    id: "component-1",
    type: "VIDEO_THEORETICAL",
    material_lessons: {
      lesson_title: "Introducción a los avatares",
      materials: {
        artifact_id: "artifact-1",
        artifacts: {
          idea_central: "Taller de producción audiovisual",
          organization_id: organizationId,
        },
      },
    },
  };
}

describe("production course context", () => {
  it("maps the verified workshop and lesson names", () => {
    assert.deepEqual(mapProductionCourseContext(buildRow("org-1"), "org-1"), {
      artifactId: "artifact-1",
      componentId: "component-1",
      componentType: "VIDEO_THEORETICAL",
      lessonTitle: "Introducción a los avatares",
      workshopTitle: "Taller de producción audiovisual",
    });
  });

  it("rejects a component belonging to another organization", () => {
    assert.equal(mapProductionCourseContext(buildRow("org-2"), "org-1"), null);
  });
});
