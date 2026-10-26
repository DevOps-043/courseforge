import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { executeDeliveryRun } from "../services/delivery-generation";
import { deliveryHash } from "../lib/delivery-hash";
import { emptyDeliveryDocument, type SessionPlan } from "../types/delivery.schemas";

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
      if (unit.id === document.agenda[1].id) throw new Error("Fallo simulado del proveedor");
      return { output: plan, model: "gpt-4o" };
    });
    assert.equal(run.status, "FAILED");
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
