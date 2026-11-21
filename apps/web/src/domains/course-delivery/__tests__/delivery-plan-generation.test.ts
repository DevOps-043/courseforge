import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { SupabaseClient } from "@supabase/supabase-js";
import { documentFixture } from "./delivery-documents.fixture";
import { planGenerationRequirements, validateGeneratedSessionPlan } from "../lib/delivery-plan-generation";
import { deliveryGenerationFailure } from "../lib/delivery-generation-failure";
import { executeDeliveryRun } from "../services/delivery-generation";
import { CourseSourceError } from "../../course-sources/course-source-error";

function hybridFixture() {
  const fixture = documentFixture();
  fixture.workspace.document.config.mode = "HYBRID";
  fixture.workspace.document.hybridRoute = [
    { kind: "ASYNCHRONOUS", id: "10000000-0000-4000-8000-000000000002", title: "Preparación", minutes: 30, lessonIds: ["lesson"] },
    { kind: "SYNCHRONOUS", sessionId: fixture.id },
  ];
  fixture.session.title = "TITULO_PRIVADO";
  return fixture;
}

test("los requisitos híbridos derivan orden y vínculos obligatorios, conservando los validadores", () => {
  const { workspace, session, plan } = hybridFixture();
  const requirements = planGenerationRequirements(workspace.document, session);
  assert.equal(requirements.totalMinutes, 60);
  assert.deepEqual(requirements.allowedLinks, [{ lessonId: "lesson", timing: "BEFORE" }]);
  assert.deepEqual(requirements.requiredLessonIds, ["lesson"]);
  assert.throws(() => validateGeneratedSessionPlan(plan, workspace.document, session), /Relaciona/);
  const valid = { ...plan, nexusLinks: [{ lessonId: "lesson", timing: "BEFORE", purpose: "Aplicar preparación" }] };
  assert.deepEqual(validateGeneratedSessionPlan(valid, workspace.document, session), valid);
  assert.throws(() => validateGeneratedSessionPlan({ ...valid, nexusLinks: [{ ...valid.nexusLinks[0], timing: "AFTER" }] }, workspace.document, session), /orden/);
  assert.throws(() => validateGeneratedSessionPlan({ ...valid, nexusLinks: [{ ...valid.nexusLinks[0], lessonId: "foreign" }] }, workspace.document, session), /orden/);
  workspace.document.hybridRoute!.reverse();
  assert.deepEqual(planGenerationRequirements(workspace.document, session).allowedLinks, [{ lessonId: "lesson", timing: "AFTER" }]);
});

test("el diagnóstico de plan informa reglas sin textos privados ni valores de una salida inválida", () => {
  const { workspace, session, plan } = hybridFixture();
  for (const output of [
    { ...plan, blocks: [{ ...plan.blocks[0], minutes: 50, purpose: "CONTENIDO_PRIVADO" }] },
    { secreto: "CONTENIDO_PRIVADO" },
  ]) {
    try {
      validateGeneratedSessionPlan(output, workspace.document, session);
      assert.fail("Debió rechazar el plan");
    } catch (failure) {
      const diagnostic = deliveryGenerationFailure(failure, "VALIDATION", 90_000);
      assert.equal(diagnostic.code, "INVALID_OUTPUT");
      assert.doesNotMatch(diagnostic.message, /TITULO_PRIVADO|CONTENIDO_PRIVADO|secreto/);
      assert.match(diagnostic.message, /50 minutos|estructura/);
    }
  }
});

for (const scenario of ["corregido", "rechazado", "sin-respaldo", "sin-tiempo"] as const) {
  test(`worker de plan híbrido: ${scenario}, una corrección y guardado solo tras validación y respaldo`, async context => {
    const requireSibling = createRequire(__filename);
    let now = Date.now();
    if (scenario === "sin-tiempo") context.mock.method(Date, "now", () => now);
    const sourceService = requireSibling("../../course-sources/course-source-generation.service");
    const repository = requireSibling("../services/delivery-repository");
    const fixture = hybridFixture();
    const { workspace, id, plan } = fixture;
    const original = structuredClone(workspace.document);
    const valid = { ...plan, nexusLinks: [{ lessonId: "lesson", timing: "BEFORE" as const, purpose: "Aplicar preparación" }] };
    const run = { id, artifact_id: id, organization_id: id, operation: "PLAN", expected_revision: workspace.revision,
      snapshot: { document: structuredClone(workspace.document), context: fixture.context,
        settings: { model: { model_name: "gpt-5.6-luna", fallback_model: null }, prompt: { version: "fijado" } } },
      units: [{ id, ready: false }], status: "QUEUED", last_error: "" };
    context.mock.method(requireSibling("../config/delivery-enabled"), "deliveryEnabled", () => true);
    context.mock.method(repository, "readDeliveryContext", async () => fixture.context);
    context.mock.method(repository, "readDeliveryWorkspace", async () => workspace);
    context.mock.method(sourceService, "prepareCourseGeneration", async () => ({ sources: [] }));
    let reviews = 0, commits = 0, calls = 0;
    context.mock.method(sourceService, "attestCourseGeneration", async (_admin: unknown, _sources: unknown, output: unknown) => {
      reviews++;
      assert.deepEqual(output, valid);
      if (scenario === "sin-respaldo") throw new CourseSourceError(409, "Sin respaldo", "UNSUPPORTED_OUTPUT");
      return id;
    });
    const database = {
      from() {
        let patch: object | undefined;
        const query = { select: () => query, eq: () => query,
          update(value: object) { patch = value; return query; },
          single: async () => ({ data: run, error: null }),
          then(resolve: (result: unknown) => unknown) { Object.assign(run, patch); return Promise.resolve({ error: null }).then(resolve); } };
        return query;
      },
      async rpc(name: string, args: Record<string, unknown>) {
        if (name === "claim_course_delivery_run") return { data: true, error: null };
        assert.equal(name, "commit_course_source_delivery_unit");
        assert.equal(reviews, 1); assert.equal(args.p_receipt, id);
        commits++; workspace.document = args.p_document as typeof workspace.document;
        return { data: workspace.revision + 1, error: null };
      },
    } as unknown as SupabaseClient;
    await executeDeliveryRun(database, id, async (_admin, snapshot, _unit, _deadline, correction) => {
      calls++;
      if (scenario === "sin-tiempo") now += 400_000;
      assert.equal(snapshot.snapshot.settings.model.model_name, "gpt-5.6-luna");
      assert.equal(snapshot.snapshot.settings.prompt.version, "fijado");
      if (calls === 1) assert.equal(correction, undefined);
      else assert.match(correction || "", /Relaciona/);
      return { output: calls === 1 || scenario === "rechazado" ? plan : valid, model: "gpt-5.6-luna" };
    });
    assert.equal(calls, scenario === "sin-tiempo" ? 1 : 2);
    assert.equal(commits, scenario === "corregido" ? 1 : 0);
    assert.equal(reviews, scenario === "rechazado" || scenario === "sin-tiempo" ? 0 : 1);
    assert.equal(run.status, scenario === "corregido" ? "COMPLETED" : "FAILED");
    if (scenario !== "corregido") assert.deepEqual(workspace.document, original);
    if (scenario === "rechazado") assert.match(run.last_error, /INVALID_OUTPUT.*Relaciona/);
    if (scenario === "sin-respaldo") assert.match(run.last_error, /UNSUPPORTED_OUTPUT/);
  });
}
