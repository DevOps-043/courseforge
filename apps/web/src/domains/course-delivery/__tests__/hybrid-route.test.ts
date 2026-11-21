import { test } from "node:test";
import assert from "node:assert/strict";
import * as hybridPolicy from "../lib/hybrid-route";
import * as academyPolicy from "../lib/academy-scope";
import { hybridRouteIssues, routeTotals } from "../lib/hybrid-route";
import * as deliveryPolicy from "../lib/delivery-policy";
import * as schemas from "../types/delivery.schemas";
import { deliveryHash } from "../lib/delivery-hash";
import { load } from "../../../app/login/__tests__/source-test-loader";
import { agendaIssues } from "../lib/delivery-policy";
import { hybridRouteSchema, deliveryDocumentSchema, emptyDeliveryDocument, type AgendaSession, type HybridRoute } from "../types/delivery.schemas";
import { planContentHash, sessionPlanInputHash } from "../services/delivery-readiness";

const id = "10000000-0000-4000-8000-000000000001", second = "10000000-0000-4000-8000-000000000002";
const lessons = ["live", "study"].map(id => ({ id, title: id, module: "Módulo", objective: "Aplicar" }));
const agenda: AgendaSession[] = [{ id, title: "Encuentro", minutes: 180, objectives: ["Aplicar"], evidence: "Práctica", coverage: [{ lessonId: "live", scope: "Aplicar", review: false }] }];
const route: HybridRoute = [{ kind: "SYNCHRONOUS", sessionId: id }, { kind: "ASYNCHRONOUS", id: second, title: "Estudio", minutes: 300, lessonIds: ["study"] }];

test("el híbrido cubre el currículo entre ambas modalidades sin duplicarlo en vivo", () => {
  assert.deepEqual(agendaIssues(agenda, lessons, null, false), []);
  assert.ok(agendaIssues(agenda, lessons).length);
  assert.deepEqual(hybridRouteIssues(route, agenda, lessons), []);
  assert.deepEqual(routeTotals(route, agenda), { synchronous: 180, asynchronous: 300 });
});
test("el recorrido rechaza cobertura incompleta, referencias ajenas y duplicados", () => {
  assert.ok(hybridRouteIssues([route[0]], agenda, lessons).length);
  assert.ok(hybridRouteIssues([route[1]], agenda, lessons).length);
  assert.ok(hybridRouteIssues([...route, route[0]], agenda, lessons).length);
  assert.ok(hybridRouteIssues([...route, route[1]], agenda, lessons).length);
  assert.ok(hybridRouteIssues([{ kind: "SYNCHRONOUS", sessionId: second }, route[1]], agenda, lessons).length);
  assert.ok(hybridRouteIssues([route[0], { ...route[1], kind: "ASYNCHRONOUS", id: second, title: "Estudio", minutes: 1, lessonIds: ["foreign"] }], agenda, lessons).length);
});
test("el esquema conserva orden y contratos antiguos y valida tamaño y minutos", () => {
  assert.equal(deliveryDocumentSchema.safeParse(emptyDeliveryDocument()).success, true);
  assert.deepEqual(hybridRouteSchema.parse(route), route);
  assert.equal(hybridRouteSchema.safeParse([{ kind: "ASYNCHRONOUS", id: second, title: "Estudio", minutes: 0, lessonIds: ["study"] }]).success, false);
  assert.equal(hybridRouteSchema.safeParse(Array(325).fill(route[0])).success, false);
});
test("cambiar el orden invalida las huellas de planes sin modificar sus contenidos", () => {
  const document = { ...emptyDeliveryDocument(), agenda, hybridRoute: route };
  const previous = planContentHash(document);
  const input = sessionPlanInputHash(document, agenda[0], { syllabusHash: "syllabus" } as Parameters<typeof sessionPlanInputHash>[2]);
  document.hybridRoute = [...route].reverse();
  assert.notEqual(planContentHash(document), previous);
  assert.notEqual(sessionPlanInputHash(document, agenda[0], { syllabusHash: "syllabus" } as Parameters<typeof sessionPlanInputHash>[2]), input);
});

test("los vínculos de estudio respetan el orden de las modalidades", () => {
  const document = { ...emptyDeliveryDocument(), agenda, hybridRoute: route };
  document.config.mode = "HYBRID";
  const plan = { blocks: [], nexusLinks: [{ lessonId: "study", timing: "AFTER" as const, purpose: "Refuerzo" }] };
  assert.deepEqual(hybridPolicy.hybridPlanIssues(document, agenda[0], plan), []);
  assert.ok(hybridPolicy.hybridPlanIssues(document, agenda[0], { ...plan, nexusLinks: [{ ...plan.nexusLinks[0], timing: "BEFORE" }] }).length);
});

test("guardar el recorrido valida antes de persistir y conserva revisión y contenido previo", async () => {
  const document = emptyDeliveryDocument(); document.config.mode = "HYBRID";
  document.materialsApproval = { revision: 3, syllabus: "syllabus", nexus: "nexus", sources: "sources", content: "content", userId: "reviewer" };
  const workspace = { artifact_id: id, organization_id: second, revision: 3, document };
  const writes: typeof document[] = [];
  const service = load<{ editDelivery: (admin: object, current: typeof workspace, kind: string, value: unknown) => Promise<number> }>("src/domains/course-delivery/services/delivery-commands.ts", {
    "../../course-sources/course-source-settings": {}, "../config/delivery.config": {},
    "../types/delivery.schemas": schemas, "../lib/delivery-policy": deliveryPolicy,
    "../lib/delivery-hash": { deliveryHash }, "./delivery-settings": {},
    "../lib/hybrid-route": hybridPolicy, "./delivery-readiness": {},
    "../lib/academy-scope": academyPolicy,
    "./academy-scope.server": {},
    "../../plan/lib/plan-completeness": {}, "../../plan/actions/plan.actions": {}, "../../materials/actions/materials.actions": {},
    "./delivery-repository": {
      readDeliveryContext: async () => ({ syllabusApproved: true, syllabusHash: "syllabus", lessons }),
      saveDeliveryWorkspace: async (_admin: object, previous: typeof workspace, next: typeof document) => {
        assert.equal(previous.organization_id, second); assert.equal(previous.revision, 3); writes.push(next); return 4;
      },
    },
  }, { structuredClone });
  await assert.rejects(service.editDelivery({}, workspace, "HYBRID_ROUTE", { agenda, route: [route[0]] }));
  assert.equal(writes.length, 0);
  assert.equal(await service.editDelivery({}, workspace, "HYBRID_ROUTE", { agenda, route }), 4);
  assert.equal(writes.length, 1); assert.equal(writes[0].materialsApproval, null);
  assert.deepEqual(Array.from(writes[0].stalePlans), [id]);
  assert.equal(workspace.document.agenda.length, 0); assert.ok(workspace.document.materialsApproval);
  assert.equal(await service.editDelivery({}, { ...workspace, revision: 4, document: writes[0] }, "HYBRID_ROUTE", { agenda, route }), 4);
  assert.equal(writes.length, 1);
  assert.equal(await service.editDelivery({}, { ...workspace, document: { ...document, agenda } }, "HYBRID_ROUTE", { agenda, route }), 4);
  assert.equal(writes.length, 2);
});
