import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { SupabaseClient } from "@supabase/supabase-js";
import { executeDeliveryRun } from "../services/delivery-generation";
import { deliveryHash } from "../lib/delivery-hash";
import { emptyDeliveryDocument, type SessionPlan } from "../types/delivery.schemas";
import { CourseSourceError } from "../../course-sources/course-source-error";
import { documentFixture } from "./delivery-documents.fixture";

test("worker conserva unidades guardadas y reanuda solo pendientes con la configuración fijada", async () => {
  const previous = process.env.SYNCHRONOUS_COURSES_ENABLED;
  process.env.SYNCHRONOUS_COURSES_ENABLED = "true";
  const modules = [{ title: "Módulo", lessons: [{ id: "lesson", title: "Lección", objective_specific: "Aplicar" }] }];
  const document = emptyDeliveryDocument();
  document.config.mode = "SYNCHRONOUS"; document.syllabusHash = deliveryHash(modules);
  document.agenda = ["first", "second"].map((id, index) => ({
    id: `10000000-0000-4000-8000-00000000000${index + 1}`, title: id, minutes: 90,
    objectives: ["Aplicar"], evidence: "Caso", coverage: [{ lessonId: "lesson", scope: id, review: false }],
  }));
  const workspace = { artifact_id: "course", organization_id: "org", revision: 1, document };
  const run = {
    id: "run", artifact_id: "course", organization_id: "org", operation: "PLAN",
    status: "QUEUED", lease_token: null as string | null, expected_revision: 1,
    snapshot: { document: structuredClone(document), context: { title: "Curso", modules, lessons: [], syllabusHash: deliveryHash(modules), nexusHash: deliveryHash(null), sourcesHash: deliveryHash([]), sources: [] },
      settings: { model: { model_name: "gpt-4o", fallback_model: null, temperature: 0.3, thinking_level: "medium" }, settingType: "SYNCHRONOUS_PLAN", inherited: false, modelSource: "organization", prompt: { content: "PROMPT_FIJADO", version: "1.0.1", source: "organization", code: "SYNCHRONOUS_PLAN" }, hash: "original" } },
    units: document.agenda.map(session => ({ id: session.id, ready: false })),
  };
  const database = {
    from(table: string) {
      let patch: Record<string, unknown> | null = null;
      const filters: Record<string, unknown> = {};
      const result = () => {
        if (patch) {
          if (Object.entries(filters).every(([key, value]) => (run as unknown as Record<string, unknown>)[key] === value)) Object.assign(run, patch);
          return { data: null, error: null };
        }
        const records: Record<string, unknown> = { artifacts: { id: "course", organization_id: "org", idea_central: "Curso" }, syllabus: { modules, state: "STEP_APPROVED" }, instructional_plans: null, materials: null, curation: null, course_delivery_workspaces: workspace, course_delivery_runs: run };
        return { data: structuredClone(records[table] || null), error: null };
      };
      const query = {
        select() { return query; }, update(value: Record<string, unknown>) { patch = value; return query; },
        eq(key: string, value: unknown) { filters[key] = value; return query; },
        async single() { return result(); }, async maybeSingle() { return result(); },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve); },
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "claim_course_delivery_run") {
        if (run.status !== "QUEUED") return { data: false, error: null };
        run.status = "RUNNING"; run.lease_token = String(args.p_token);
        return { data: true, error: null };
      }
      if (name === "commit_course_delivery_unit") {
        if (run.lease_token !== args.p_token || run.expected_revision !== workspace.revision) return { data: null, error: { message: "STALE" } };
        workspace.document = structuredClone(args.p_document) as typeof document;
        workspace.revision++; run.expected_revision++;
        run.units = structuredClone(args.p_units) as typeof run.units;
        return { data: workspace.revision, error: null };
      }
      throw new Error("RPC no esperada");
    },
  } as unknown as SupabaseClient;
  const plan: SessionPlan = { blocks: [{ id: "case", purpose: "Aplicar", minutes: 90, explanation: "Explicación", activity: "Caso", criteria: ["Justifica"], resources: ["Fuente"] }], nexusLinks: [] };
  const generated: string[] = [];
  try {
    await executeDeliveryRun(database, "run", async (_admin, snapshot, unit) => {
      assert.equal(snapshot.snapshot.settings.prompt.content, "PROMPT_FIJADO");
      generated.push(unit.id);
      if (unit.id === document.agenda[1].id) throw new DOMException("Texto privado del proveedor", "TimeoutError");
      return { output: plan, model: "gpt-4o" };
    });
    assert.equal(run.status, "FAILED");
    const failure = (run as typeof run & { last_error: string }).last_error;
    assert.match(failure, /Generación de contenido · TIMEOUT/);
    assert.match(failure, /90 segundos/);
    assert.doesNotMatch(failure, /Texto privado/);
    assert.equal(run.units[0].ready, true); assert.equal(run.units[1].ready, false);
    assert.ok(workspace.document.plans[document.agenda[0].id]);
    run.status = "QUEUED";
    await executeDeliveryRun(database, "run", async (_admin, snapshot, unit) => {
      assert.equal(snapshot.snapshot.settings.prompt.version, "1.0.1");
      generated.push(unit.id); return { output: plan, model: "gpt-4o" };
    });
    assert.equal(run.status, "COMPLETED");
    assert.equal(generated.filter(id => id === document.agenda[0].id).length, 1);
    assert.equal(generated.filter(id => id === document.agenda[1].id).length, 2);
    assert.ok(run.units.every(unit => unit.ready));
  } finally {
    if (previous === undefined) delete process.env.SYNCHRONOUS_COURSES_ENABLED;
    else process.env.SYNCHRONOUS_COURSES_ENABLED = previous;
  }
});

test("el worker de sesiones guarda la versión corregida junto con el progreso confirmado", async (testContext) => {
  const requireSibling = createRequire(__filename);
  const sourceService = requireSibling("../../course-sources/course-source-generation.service");
  const repository = requireSibling("../services/delivery-repository");
  const { id, context, workspace, material } = documentFixture();
  const run = { id, operation: "MATERIALS", artifact_id: id, organization_id: id,
    expected_revision: workspace.revision, units: [{ id, ready: false }], snapshot: { document: workspace.document,
      context: structuredClone(context), settings: { model: { model_name: "gpt-4o", fallback_model: null } } } };
  const receipt = "10000000-0000-4000-8000-000000000002";
  const rejected = structuredClone(material);
  rejected.concepts[0].explanation = "Afirmación sin respaldo";
  const reviewed: unknown[] = [];
  testContext.mock.method(requireSibling("../config/delivery-enabled"), "deliveryEnabled", () => true);
  testContext.mock.method(repository, "readDeliveryContext", async () => context);
  testContext.mock.method(repository, "readDeliveryWorkspace", async () => workspace);
  testContext.mock.method(sourceService, "prepareCourseGeneration", async () => ({ sources: [] }));
  testContext.mock.method(sourceService, "attestCourseGeneration", async (_admin: unknown, _context: unknown, output: typeof material) => {
    reviewed.push(output);
    if (output.concepts[0].explanation === rejected.concepts[0].explanation) throw new CourseSourceError(409, "Rechazado", "UNSUPPORTED_OUTPUT");
    return receipt;
  });
  const updates = { eq: () => updates, select: () => updates, maybeSingle: async () => ({ data: { id }, error: null }) };
  const database = {
    from() {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: run, error: null }) }) }),
        update: () => updates };
    },
    async rpc(name: string, payload: Record<string, unknown>) {
      if (name === "claim_course_delivery_run") return { data: true, error: null };
      if (name === "take_delivery_material_retry") return { data: null, error: null };
      if (name === "finish_delivery_material_run") return { data: payload.p_status, error: null };
      assert.equal(name, "commit_course_source_delivery_unit");
      assert.equal(payload.p_receipt, receipt);
      assert.deepEqual(payload.p_units, [{ id, ready: true, model: "gpt-4o", generating: false, attempts: 1 }]);
      assert.deepEqual((payload.p_document as typeof workspace.document).materials[id], material);
      return { data: workspace.revision + 1, error: null };
    },
  } as unknown as SupabaseClient;
  const corrections: (string | undefined)[] = [];
  const result = await executeDeliveryRun(database, id, async (_admin, _run, _unit, _deadline, correction) => {
    corrections.push(correction);
    return { output: correction ? material : rejected, model: "gpt-4o" };
  });
  assert.equal(corrections.length, 2);
  assert.equal(corrections[0], undefined);
  assert.match(corrections[1] || "", /sin respaldo/);
  assert.deepEqual(reviewed, [rejected, material]);
  assert.equal(run.units[0].ready, true);
  assert.equal(result.status, "COMPLETED");
});
