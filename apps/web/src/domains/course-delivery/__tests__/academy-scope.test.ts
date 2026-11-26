import { test } from "node:test";
import assert from "node:assert/strict";
import { academyScope, assertAcademyPlans, assertAcademyLesson } from "../lib/academy-scope";
import { emptyDeliveryDocument } from "../types/delivery.schemas";
import { deliveryHash } from "../lib/delivery-hash";
import * as academyPolicy from "../lib/academy-scope";
import { load } from "../../../app/login/__tests__/source-test-loader";
import { selectLatestComponentsByType } from "../../materials/lib/material-component-versions";
import type { SupabaseClient } from "@supabase/supabase-js";

function fixture() {
  const modules = [{ title: "Primero", lessons: [{ title: "En vivo" }] },
    { title: "Segundo", lessons: [{ title: "Caso en vivo" }, { title: "Estudio" }] }];
  const document = emptyDeliveryDocument();
  document.config.mode = "HYBRID";
  document.syllabusHash = deliveryHash(modules);
  const id = "10000000-0000-4000-8000-000000000001";
  document.agenda = [{ id, title: "Taller", minutes: 90, objectives: ["Aplicar"], evidence: "Caso", coverage: [
    { lessonId: "lesson-1-1", scope: "Tema", review: false }, { lessonId: "lesson-2-1", scope: "Caso", review: false },
  ] }];
  document.hybridRoute = [{ kind: "SYNCHRONOUS", sessionId: id },
    { kind: "ASYNCHRONOUS", id: "10000000-0000-4000-8000-000000000002", title: "Academy", minutes: 60, lessonIds: ["lesson-2-2"] }];
  return { document, modules };
}

test("Academy excluye temas exclusivos de Hub sin renumerar IDs posicionales", () => {
  const { document, modules } = fixture();
  const scope = academyScope(document, modules);
  assert.deepEqual(scope.lessonIds, ["lesson-2-2"]);
  assert.deepEqual(scope.modules, [{ id: "mod-1", delivery_module_index: 1, title: "Segundo", lessons: [{ id: "lesson-2-2", title: "Estudio" }] }]);
  assert.deepEqual(modules[1].lessons[1], { title: "Estudio" });
  assertAcademyLesson(scope, "lesson-2-2");
  assertAcademyLesson(scope, "lesson-2-2-G4");
  assert.throws(() => assertAcademyLesson(scope, "lesson-1-1"));
});
test("el plan asíncrono exige identidad exacta y la distribución de su generación", () => {
  const { document, modules } = fixture();
  const scope = academyScope(document, modules);
  const plan = [{ lesson_id: "lesson-2-2", delivery_route_hash: scope.routeHash }];
  assert.doesNotThrow(() => assertAcademyPlans(scope, plan));
  assert.throws(() => assertAcademyPlans(scope, [...plan, { lesson_id: "lesson-1-1" }]));
  assert.throws(() => assertAcademyPlans(scope, [{ lesson_id: "lesson-2-2" }]));
  document.hybridRoute!.reverse();
  assert.throws(() => assertAcademyPlans(academyScope(document, modules), plan));
});
test("no se deriva Academy de un recorrido ausente, ajeno o de otro temario", () => {
  const { document, modules } = fixture();
  const previous = structuredClone(document);
  delete document.hybridRoute;
  assert.throws(() => academyScope(document, modules));
  assert.throws(() => academyScope(previous, [...modules, { title: "Nuevo", lessons: [{ title: "Nueva" }] }]));
});
test("asíncrono puro conserva todas las lecciones y síncrono puro no requiere videos", () => {
  const { document, modules } = fixture();
  document.config.mode = "NEXUS";
  assert.equal(academyScope(document, modules).lessonIds.length, 3);
  assert.equal(academyScope(document, modules).routeHash, null);
  document.config.mode = "SYNCHRONOUS";
  assert.deepEqual(academyScope(document, modules).lessonIds, []);
});
test("compartir un tema con una sesión conserva una sola lección asíncrona", () => {
  const { document, modules } = fixture();
  document.agenda[0].coverage.push({ lessonId: "lesson-2-2", scope: "Aplicación", review: true });
  assert.deepEqual(academyScope(document, modules).lessonIds, ["lesson-2-2"]);
});

test("QA comprueba huella y duplicados de materiales, también con sufijos históricos", async () => {
  const { document, modules } = fixture();
  const scope = academyScope(document, modules);
  const lessons = [{ lesson_id: "lesson-2-2-G1", state: "APPROVABLE", expected_components: ["READING"],
    material_components: [{ type: "READING", iteration_number: 1, assets: { delivery_route_hash: scope.routeHash } }] }];
  const rows: Record<string, unknown> = {
    artifacts: { organization_id: "org" }, syllabus: { modules, state: "STEP_APPROVED" },
    instructional_plans: { lesson_plans: [{ lesson_id: "lesson-2-2", delivery_route_hash: scope.routeHash }] },
    materials: { id: "materials" }, material_lessons: lessons,
  };
  const admin = { from: (table: string) => {
    const query = { select: () => query, eq: () => query, single: async () => ({ data: rows[table], error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows[table], error: null }).then(resolve) };
    return query;
  } } as unknown as SupabaseClient;
  const service = load<{ assertAcademyMaterialsCurrent: (admin: SupabaseClient, artifactId: string) => Promise<void>; readAcademyScope: (admin: SupabaseClient, artifactId: string, organization: string) => Promise<unknown> }>("src/domains/course-delivery/services/academy-scope.server.ts", {
    "../lib/academy-scope": academyPolicy,
    "./delivery-repository": { readDeliveryWorkspace: async () => ({ document }) },
    "../../materials/lib/material-component-versions": { selectLatestComponentsByType },
  });
  await assert.doesNotReject(service.assertAcademyMaterialsCurrent(admin, "course"));
  lessons[0].material_components[0].assets.delivery_route_hash = "anterior";
  await assert.rejects(service.assertAcademyMaterialsCurrent(admin, "course"), /otra distribución/);
  lessons[0].material_components[0].assets.delivery_route_hash = scope.routeHash;
  lessons.push({ ...lessons[0], lesson_id: "lesson-2-2-G2" });
  await assert.rejects(service.assertAcademyMaterialsCurrent(admin, "course"), /otra distribución/);
  await assert.rejects(service.readAcademyScope(admin, "course", "otra-empresa"), /organización/);
});

test("el botón de sesiones reserva y despacha solo preparación de Hub", async () => {
  const { document } = fixture();
  const calls: string[] = [];
  const service = load<{ executeDeliveryCommand: (id: string, input: object) => Promise<unknown> }>("src/domains/course-delivery/services/delivery-api.ts", {
    "./delivery-access": { requireDeliveryAccess: async () => ({ admin: {}, tenant: { organizationId: "org" } }) },
    "./delivery-repository": { readDeliveryWorkspace: async () => ({ revision: 1, document }) },
    "./delivery-readiness": {}, "./delivery-settings": {},
    "./delivery-commands": { reserveDeliveryRun: async (_admin: object, _workspace: object, operation: string) => { calls.push(operation); return "run"; } },
    "../../../lib/server/background-function-client": { dispatchBackgroundFunctionJson: async (name: string) => { calls.push(name); } },
    "../config/delivery-enabled": { deliveryEnabled: () => true }, "./delivery-live": {},
  });
  await service.executeDeliveryCommand("course", { action: "GENERATE", revision: 1, operation: "PLAN" });
  assert.deepEqual(calls, ["PLAN", "course-delivery-background"]);
});
