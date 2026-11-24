import assert from "node:assert/strict";
import test from "node:test";
import { documentFixture } from "./delivery-documents.fixture";
import { assignLessonDestination, lessonAssignment } from "../lib/hybrid-lesson-assignment";
import { deliveryProductionScope } from "../lib/delivery-production-scope";

function fixture() {
  const { workspace, id, context } = documentFixture();
  const agenda = workspace.document.agenda;
  const route = [{ kind: "SYNCHRONOUS" as const, sessionId: id }, {
    kind: "ASYNCHRONOUS" as const, id: "10000000-0000-4000-8000-000000000002", title: "Estudio", minutes: 60, lessonIds: ["lesson"],
  }];
  return { workspace, agenda, route, lesson: context.lessons[0], id };
}

test("destino explícito transforma compartida en solo Hub sin mutar el borrador anterior", () => {
  const { workspace, agenda, route, lesson } = fixture();
  const before = JSON.stringify({ agenda, route });
  assert.equal(lessonAssignment(agenda, route, lesson.id).destination, "SHARED");
  const next = assignLessonDestination(agenda, route, lesson, "SYNCHRONOUS");
  assert.equal(lessonAssignment(next.agenda, next.route, lesson.id).destination, "SYNCHRONOUS");
  assert.equal(JSON.stringify({ agenda, route }), before);
  workspace.document.config.mode = "HYBRID";
  Object.assign(workspace.document, { agenda: next.agenda, hybridRoute: next.route });
  assert.deepEqual(deliveryProductionScope(workspace.document).academyIds, []);
  assert.ok(Object.values(workspace.document.materials).length > 0, "Conserva los materiales previos al cambiar el borrador");
});

test("solo Academy retira cobertura en vivo; compartida restaura ambas selecciones sin duplicados", () => {
  const { agenda, route, lesson } = fixture();
  const next = assignLessonDestination(agenda, route, lesson, "ASYNCHRONOUS");
  assert.equal(lessonAssignment(next.agenda, next.route, lesson.id).destination, "ASYNCHRONOUS");
  const shared = assignLessonDestination(next.agenda, next.route, lesson, "SHARED");
  const repeated = assignLessonDestination(shared.agenda, shared.route, lesson, "SHARED");
  assert.deepEqual(shared, repeated);
  assert.equal(lessonAssignment(shared.agenda, shared.route, lesson.id).destination, "SHARED");
});

test("no inventa sesiones ni tramos y conserva alcance y repaso al cambiar la asignación", () => {
  const { agenda, route, lesson, id } = fixture();
  agenda[0].coverage[0].scope = "Alcance revisado"; agenda[0].coverage[0].review = true;
  const next = assignLessonDestination(agenda, route, lesson, "SYNCHRONOUS", { sessionIds: [id] });
  assert.deepEqual(next.agenda[0].coverage[0], agenda[0].coverage[0]);
  assert.throws(() => assignLessonDestination(agenda, route, lesson, "SHARED", { sessionIds: ["ajena"] }), /sesión/);
  assert.throws(() => assignLessonDestination(agenda, [], lesson, "SHARED"), /tramo/);
  assert.throws(() => assignLessonDestination([], route, lesson, "SYNCHRONOUS"), /sesión/);
});
