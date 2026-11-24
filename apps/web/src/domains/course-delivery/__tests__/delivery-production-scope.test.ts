import assert from "node:assert/strict";
import test from "node:test";
import { documentFixture } from "./delivery-documents.fixture";
import { deliveryProductionScope, isAcademyProductionLesson } from "../lib/delivery-production-scope";

test("las sesiones no habilitan producción de video ni eliminan su contenido", () => {
  const { workspace } = documentFixture();
  const before = JSON.stringify(workspace);
  const scope = deliveryProductionScope(workspace.document);
  assert.deepEqual(scope.academyIds, []);
  assert.deepEqual(scope.liveOnlyIds, ["lesson"]);
  assert.equal(isAcademyProductionLesson("lesson", scope.academyIds), false);
  assert.equal(JSON.stringify(workspace), before);
});

test("híbrido distingue exclusivas de Hub y compartidas sin retirar videos de Academy", () => {
  const { workspace, id } = documentFixture();
  workspace.document.config.mode = "HYBRID";
  workspace.document.agenda[0].coverage.push({ lessonId: "solo-hub", scope: "Aplicación", review: false });
  workspace.document.hybridRoute = [{ kind: "SYNCHRONOUS", sessionId: id }, {
    kind: "ASYNCHRONOUS", id, title: "Estudio", minutes: 60, lessonIds: ["lesson", "solo-academy"],
  }];
  const scope = deliveryProductionScope(workspace.document);
  assert.deepEqual(scope.sharedIds, ["lesson"]);
  assert.deepEqual(scope.liveOnlyIds, ["solo-hub"]);
  assert.equal(isAcademyProductionLesson("lesson-G2", scope.academyIds), true);
  assert.equal(isAcademyProductionLesson("solo-academy", scope.academyIds), true);
  assert.equal(isAcademyProductionLesson("solo-hub", scope.academyIds), false);
});

test("Nexus conserva producción y un híbrido sin recorrido no abre videos por defecto", () => {
  const { workspace } = documentFixture();
  workspace.document.config.mode = "NEXUS";
  assert.equal(isAcademyProductionLesson("lesson", deliveryProductionScope(workspace.document).academyIds), true);
  workspace.document.config.mode = "HYBRID";
  assert.equal(isAcademyProductionLesson("lesson", deliveryProductionScope(workspace.document).academyIds), false);
});
