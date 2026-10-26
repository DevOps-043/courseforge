import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { agendaIssues, completeSessionPlan, curriculumLessons, deliveryRequirements, materialIssues, participantMaterials, planIssues, sessionSources } from "../lib/delivery-policy";
import { deliveryHash } from "../lib/delivery-hash";
import { agendaSchema, deliveryConfigSchema, emptyDeliveryDocument, type AgendaSession, type SessionMaterials, type SessionPlan } from "../types/delivery.schemas";
import { renderDeliveryExport } from "../services/delivery-export";
import { deliveryReadiness, planContentHash, sessionPlanInputHash, sessionMaterialInputHash } from "../services/delivery-readiness";
import type { DeliveryContext } from "../services/delivery-repository";
import { resolveDeliverySettings } from "../services/delivery-settings";
import { nexusGenerationRequired } from "../lib/delivery-nexus-policy";
import { deliveryEnabled } from "../config/delivery-enabled";

const id = "b1986264-1265-478a-b25d-b6b49a2cdd13";
const session: AgendaSession = {
  id, title: "Aplicación", minutes: 90, objectives: ["Aplicar el concepto"], evidence: "Caso escrito",
  coverage: [{ lessonId: "lesson-1-1", scope: "Aplicar", review: false }],
};
const plan: SessionPlan = {
  blocks: [{ id: "case", minutes: 90, purpose: "Aplicar", explanation: "Explicar concepto", activity: "Resolver caso", criteria: ["Justifica"], resources: ["Fuente"] }],
  nexusLinks: [],
};
const material: SessionMaterials = {
  concepts: [{ title: "Concepto", explanation: "Explicación", example: "Ejemplo", misconceptions: ["Confusión"], sourceRefs: ["source-1"] }],
  activities: [{ id: "case", title: "Caso", instructions: "Resuelve", template: "Plantilla", answer: "RESPUESTA_PRIVADA", criteria: ["Criterio privado"], sourceRefs: ["source-1"] }],
  preparation: { understand: "PREPARACION_PRIVADA", explain: "Explicar", conduct: "Conducir", deepen: "Fuente aprobada", expand: "Ampliar" },
  slides: [{ title: "Slide", points: ["Punto"], notes: "NOTA_PRIVADA", sourceRefs: ["source-1"] }],
};
function fixture() {
  const document = emptyDeliveryDocument();
  document.config = deliveryConfigSchema.parse({ mode: "SYNCHRONOUS" });
  document.syllabusHash = "syllabus";
  document.agenda = structuredClone([session]); document.plans[id] = structuredClone(plan); document.materials[id] = structuredClone(material);
  const context: DeliveryContext = {
    title: "Curso", modules: [], lessons: [{ id: "lesson-1-1", title: "Lección", module: "Módulo", objective: "Aplicar" }],
    syllabusApproved: true, syllabusHash: "syllabus", nexus: null, nexusHash: "nexus", nexusState: undefined, materials: null,
    curation: { id: "curation", state: "PHASE2_APPROVED", qa_decision: null }, allSources: [], sourcesHash: "sources",
    sources: [{ id: "source-1", lessonId: "lesson-1-1", reference: "https://example.com/source", title: "Fuente", rationale: "", evidence: {}, notes: null }],
  };
  document.planApproval = { revision: 1, userId: "reviewer", syllabus: "syllabus", nexus: "nexus", sources: "sources", content: planContentHash(document) };
  document.planInputHashes[id] = sessionPlanInputHash(document, session, context);
  document.materialInputHashes[id] = sessionMaterialInputHash(document, session, context);
  document.materialsApproval = { ...document.planApproval, content: deliveryHash(document.materials) };
  return { document, context, workspace: { artifact_id: id, organization_id: id, revision: 3, document } };
}
test("legacy conserva Nexus y sincrónico no exige ensamble", () => {
  assert.equal(deliveryConfigSchema.parse({}).mode, "NEXUS");
  assert.deepEqual(deliveryRequirements("SYNCHRONOUS"), { nexus: false, sessions: true, assembly: false });
  assert.equal(deliveryRequirements("HYBRID").nexus, true);
});
test("habilitación por organización no se deriva del payload ni se activa por defecto", () => {
  assert.equal(deliveryEnabled("org", {}), false);
  assert.equal(deliveryEnabled("org", { SYNCHRONOUS_COURSES_ENABLED: "true", SYNCHRONOUS_COURSES_ORGANIZATIONS: "otra" }), false);
  assert.equal(deliveryEnabled("org", { SYNCHRONOUS_COURSES_ENABLED: "true", SYNCHRONOUS_COURSES_ORGANIZATIONS: "otra, org" }), true);
});
test("coordinación híbrida reutiliza Nexus listo o en proceso y no inicia esa rama en sincrónico", () => {
  assert.equal(nexusGenerationRequired("SYNCHRONOUS", "PLAN"), false);
  assert.equal(nexusGenerationRequired("HYBRID", "AGENDA"), false);
  assert.equal(nexusGenerationRequired("HYBRID", "PLAN", "STEP_APPROVED"), false);
  assert.equal(nexusGenerationRequired("HYBRID", "PLAN", "STEP_PROCESSING"), false);
  assert.equal(nexusGenerationRequired("HYBRID", "MATERIALS", "PHASE3_READY_FOR_QA"), false);
  assert.equal(nexusGenerationRequired("HYBRID", "MATERIALS", "PHASE3_NEEDS_FIX"), true);
});
test("normaliza identidad curricular con el fallback existente", () => {
  assert.equal(curriculumLessons([{ title: "Módulo", lessons: [{ title: "Lección" }] }])[0].id, "lesson-1-1");
});
test("rechaza referencias ajenas, cobertura solo de repaso y cantidad incompatible", () => {
  const { context } = fixture();
  assert.equal(agendaIssues([session], context.lessons).length, 0);
  assert.ok(agendaIssues([session], context.lessons, 2).length);
  assert.ok(agendaIssues([{ ...session, coverage: [{ lessonId: "ajena", scope: "Completa", review: false }] }], context.lessons).length);
  assert.ok(agendaIssues([{ ...session, coverage: [{ ...session.coverage[0], review: true }] }], context.lessons).length);
});
test("agenda permite dividir alcance sin duplicar identidad dentro de una sesión", () => {
  assert.equal(agendaSchema.safeParse([session]).success, true);
  const { context } = fixture();
  assert.ok(agendaIssues([{ ...session, coverage: [...session.coverage, ...session.coverage] }], context.lessons).length);
});
test("plan comprueba tiempo e identidad de bloques y coordinación híbrida", () => {
  const config = deliveryConfigSchema.parse({ mode: "SYNCHRONOUS" });
  assert.equal(planIssues(session, plan, config).length, 0);
  assert.ok(planIssues({ ...session, minutes: 60 }, plan, config).length);
  assert.ok(planIssues(session, plan, { ...config, mode: "HYBRID" }).length);
  assert.equal(planIssues(session, { ...plan, nexusLinks: [{ lessonId: "lesson-1-1", timing: "BEFORE", purpose: "Preparación" }] }, { ...config, mode: "HYBRID" }).length, 0);
});
test("no aprueba un conjunto con sesiones pendientes", () => {
  const { document, context } = fixture();
  delete document.plans[id];
  assert.ok(completeSessionPlan(document, context.lessons).length);
  assert.equal(deliveryReadiness(document, context).planReady, false);
});
test("fuentes ajenas y actividades sin correspondencia se rechazan", () => {
  assert.equal(materialIssues(plan, material, ["source-1"]).length, 0);
  assert.ok(materialIssues(plan, material, ["otra-fuente"]).length);
  assert.ok(materialIssues({ ...plan, blocks: [{ ...plan.blocks[0], id: "ausente" }] }, material, ["source-1"]).length);
});
test("una fuente aprobada para otra lección no se concede a la sesión", () => {
  const sources = [{ id: "source-1", lessonId: "lesson-1-1" }, { id: "other", lessonId: "lesson-2-1" }];
  assert.deepEqual(sessionSources(session, sources).map(source => source.id), ["source-1"]);
});
test("aprobación depende del currículo, plan, fuentes y contenido vigentes", () => {
  const { document, context } = fixture();
  assert.equal(deliveryReadiness(document, context).materialsReady, true);
  assert.equal(deliveryReadiness(document, { ...context, syllabusHash: "nuevo" }).planReady, false);
  assert.equal(deliveryReadiness(document, { ...context, sourcesHash: "nuevo" }).materialsReady, false);
  document.plans[id].blocks[0].minutes = 80;
  assert.equal(deliveryReadiness(document, context).planReady, false);
});
test("cambiar una consigna invalida su aprobación sin borrar contenidos", () => {
  const { document, context } = fixture();
  document.materials[id].activities[0].instructions = "Consigna corregida";
  assert.equal(deliveryReadiness(document, context).materialsReady, false);
  assert.equal(document.materials[id].activities[0].answer, "RESPUESTA_PRIVADA");
});
test("marca pendiente de actualización conserva contenido y bloquea aprobación vigente", () => {
  const { document, context } = fixture();
  document.staleMaterials = [id];
  assert.equal(deliveryReadiness(document, context).materialsReady, false);
  assert.equal(document.materials[id].activities[0].answer, "RESPUESTA_PRIVADA");
  document.stalePlans = [id];
  assert.equal(deliveryReadiness(document, context).planReady, false);
});
test("proyección de participante excluye campos privados desde el servidor", () => {
  const projection = JSON.stringify(participantMaterials(material));
  for (const secret of ["RESPUESTA_PRIVADA", "NOTA_PRIVADA", "PREPARACION_PRIVADA", "Criterio privado"]) assert.equal(projection.includes(secret), false);
});
test("exportaciones coherentes, escapadas y distintas por audiencia", () => {
  const { workspace, context } = fixture();
  context.title = '<script>alert("x")</script>';
  const participant = renderDeliveryExport(workspace, context, "participant");
  assert.ok(participant.includes("&lt;script&gt;"));
  assert.ok(!participant.includes("<script>"));
  for (const secret of ["RESPUESTA_PRIVADA", "NOTA_PRIVADA", "PREPARACION_PRIVADA"]) assert.ok(!participant.includes(secret));
  assert.ok(renderDeliveryExport(workspace, context, "facilitator").includes("RESPUESTA_PRIVADA"));
  assert.ok(renderDeliveryExport(workspace, context, "presentation").includes("NOTA_PRIVADA"));
});
test("hash canónico es independiente del orden de claves", () => {
  assert.equal(deliveryHash({ a: 1, b: [2] }), deliveryHash({ b: [2], a: 1 }));
  assert.notEqual(deliveryHash([1, 2]), deliveryHash([2, 1]));
});

type Row = Record<string, unknown>;
function settingsDatabase(rows: { models?: Row[]; prompts?: Row[]; fail?: boolean }) {
  const scopes: string[] = [];
  const db = {
    from(table: string) {
      const filters: Row = {};
      const query = {
        select() { return query; }, order() { return query; }, limit() { return query; },
        eq(key: string, value: unknown) { filters[key] = value; return query; },
        is(key: string, value: unknown) { filters[key] = value; return query; },
        async maybeSingle() {
          scopes.push(String(filters.organization_id));
          if (rows.fail) return { data: null, error: { code: "unavailable" } };
          const source = table === "model_settings" ? rows.models || [] : rows.prompts || [];
          return { data: source.find(row => Object.entries(filters).every(([key, value]) => row[key] === value)) || null, error: null };
        },
      };
      return query;
    },
  };
  return { admin: db as unknown as SupabaseClient, scopes };
}
const baseModel = { setting_type: "SYLLABUS", organization_id: null, is_active: true, model_name: "gemini-3.5-flash", fallback_model: "gpt-4o-mini", temperature: 0.3, thinking_level: "medium" };
test("configuración hereda etapa y nunca lee organizaciones ajenas", async () => {
  const database = settingsDatabase({ models: [baseModel, { ...baseModel, organization_id: "otra", model_name: "gpt-4o" }] });
  const resolved = await resolveDeliverySettings(database.admin, "org", "AGENDA");
  assert.equal(resolved.inherited, true); assert.equal(resolved.settingType, "SYLLABUS");
  assert.ok(!database.scopes.includes("otra"));
});
test("configuración propia global precede a herencia; prompt de organización precede global", async () => {
  const database = settingsDatabase({
    models: [baseModel, { ...baseModel, setting_type: "SYNCHRONOUS_AGENDA", model_name: "gpt-4o" }],
    prompts: [{ code: "SYNCHRONOUS_AGENDA", organization_id: "org", is_active: true, content: "Mi prompt", version: "1.0.2" }],
  });
  const resolved = await resolveDeliverySettings(database.admin, "org", "AGENDA");
  assert.equal(resolved.inherited, false); assert.equal(resolved.model.model_name, "gpt-4o");
  assert.equal(resolved.prompt.source, "organization"); assert.equal(resolved.prompt.version, "1.0.2");
});
test("error de lectura no permite fallback silencioso ni defaults de modelo", async () => {
  await assert.rejects(resolveDeliverySettings(settingsDatabase({ fail: true }).admin, "org", "AGENDA"), /consultar/);
  await assert.rejects(resolveDeliverySettings(settingsDatabase({}).admin, "org", "AGENDA"), /Configura/);
});
test("configuración rechaza proveedor no implementado y respaldo idéntico", async () => {
  await assert.rejects(resolveDeliverySettings(settingsDatabase({ models: [{ ...baseModel, model_name: "proveedor-ajeno" }] }).admin, "org", "AGENDA"));
  await assert.rejects(resolveDeliverySettings(settingsDatabase({ models: [{ ...baseModel, fallback_model: baseModel.model_name }] }).admin, "org", "AGENDA"));
});
test("instantánea de configuración conserva prompt y hash aunque se cambie el registro", async () => {
  const prompt = { code: "SYNCHRONOUS_AGENDA", organization_id: "org", is_active: true, content: "Primero", version: "1.0.1" };
  const database = settingsDatabase({ models: [baseModel], prompts: [prompt] });
  const original = await resolveDeliverySettings(database.admin, "org", "AGENDA");
  prompt.content = "Segundo"; prompt.version = "1.0.2";
  const next = await resolveDeliverySettings(database.admin, "org", "AGENDA");
  assert.equal(original.prompt.content, "Primero"); assert.notEqual(original.hash, next.hash);
});
