import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertSlideWorkerJob, assertSlideWorkerMembership, failSlideWorkerBeforeGeneration, loadSlideWorkerComponent } from "../generation/slide-worker-access.server";

const scope = { componentId: "component", jobId: "job", organizationId: "org", createdBy: "creator" };
test("membresía y rol vigentes son obligatorios y conservan los aliases canónicos", async () => {
  await assertSlideWorkerMembership(database({ platform_role: "BUILDER" }).admin, scope, [{ id: "org" }]);
  await assert.rejects(assertSlideWorkerMembership(database({ platform_role: "ADMIN" }).admin, scope, [{ id: "other" }]), /ACCESS_DENIED/);
  await assert.rejects(assertSlideWorkerMembership(database(null).admin, scope, [{ id: "org" }]), /ACCESS_DENIED/);
  await assert.rejects(assertSlideWorkerMembership(database(null, {}).admin, scope, [{ id: "org" }]), /ROLE_UNAVAILABLE/);
});
function database(data: unknown, error: unknown = null) {
  const filters: unknown[] = []; const updates: unknown[] = [];
  const query = {
    select() { return this; }, eq(key: string, value: unknown) { filters.push([key, value]); return this; },
    in(key: string, value: unknown) { filters.push([key, value]); return this; },
    update(value: unknown) { updates.push(value); return this; },
    maybeSingle: async () => ({ data, error }),
    then(resolve: (value: unknown) => unknown) { return Promise.resolve({ error }).then(resolve); },
  };
  return { admin: { from() { return query; } } as unknown as SupabaseClient, filters, updates };
}
test("worker verifica job, creador, tenant, componente, tipo y proveedor sin sesión HTTP", async () => {
  const db = database({ id: "job", artifact_id: "course" });
  assert.equal((await assertSlideWorkerJob(db.admin, scope)).artifact_id, "course");
  assert.deepEqual(db.filters, [["id", "job"], ["organization_id", "org"], ["created_by", "creator"], ["material_component_id", "component"], ["job_type", "SLIDE_DECK_GENERATION"], ["provider", "soflia_engine_slides"]]);
});
test("worker rechaza reserva inexistente y fallo de autoridad sin inventar acceso", async () => {
  await assert.rejects(assertSlideWorkerJob(database(null).admin, scope), /SLIDES_JOB_SCOPE_MISMATCH/);
  await assert.rejects(assertSlideWorkerJob(database(null, { message: "privado" }).admin, scope), /SLIDES_JOB_LOOKUP_UNAVAILABLE/);
});
test("componente queda limitado al curso y organización de la reserva", async () => {
  const db = database({ id: "component", assets: {}, content: {}, type: "VIDEO_DEMO" });
  const value = await loadSlideWorkerComponent(db.admin, scope, "course");
  assert.equal(value.artifactId, "course");
  assert.deepEqual(db.filters, [["id", "component"], ["material_lessons.materials.artifact_id", "course"], ["material_lessons.materials.artifacts.organization_id", "org"]]);
  await assert.rejects(loadSlideWorkerComponent(database(null).admin, scope, "course"), /SLIDES_COMPONENT_SCOPE_MISMATCH/);
});
test("el fallo previo a autorización se guarda sólo en la reserva pendiente; no sobrescribe RUNNING", async () => {
  const db = database(null);
  await failSlideWorkerBeforeGeneration(db.admin, scope);
  assert.deepEqual(db.filters.at(-1), ["status", ["PENDING", "QUEUED"]]);
  assert.ok(db.filters.some(value => JSON.stringify(value) === JSON.stringify(["organization_id", "org"])));
  assert.equal((db.updates[0] as { status: string }).status, "FAILED");
  await assert.rejects(failSlideWorkerBeforeGeneration(database(null, {}).admin, scope), /SLIDES_FAILURE_SAVE_UNAVAILABLE/);
});
