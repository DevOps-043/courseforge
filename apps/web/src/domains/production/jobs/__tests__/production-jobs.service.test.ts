import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  claimPendingProductionJob,
  claimQueuedSlideJob,
  reserveSlideJobDispatch,
  SLIDE_DISPATCH_RECOVERY_MS,
  failQueuedSlideDispatch,
  createOrReuseProductionJob,
  failProductionJob,
  preserveRetryableProviderCheckpoint,
} from "../production-jobs.service";

test("slides reclama sólo un trabajo pendiente/en cola y no repite el proveedor", async () => {
  const filters: unknown[] = [];
  let claimed = false;
  const query = {
    update() { return this; }, select() { return this; },
    eq(key: string, value: string) { filters.push([key, value]); return this; },
    in(key: string, value: string[]) { filters.push([key, value]); return this; },
    async maybeSingle() { const data = claimed ? null : { id: "slide" }; claimed = true; return { data, error: null }; },
  };
  const supabase = { from() { return query; } } as unknown as SupabaseClient;
  assert.equal(await claimQueuedSlideJob({ componentId: "component", jobId: "slide", supabase }), true);
  assert.equal(await claimQueuedSlideJob({ componentId: "component", jobId: "slide", supabase }), false);
  assert.deepEqual(filters.slice(0, 4), [["id", "slide"], ["material_component_id", "component"], ["job_type", "SLIDE_DECK_GENERATION"], ["status", ["PENDING", "QUEUED"]]]);
});

test("una cola antigua permite reenviar el mismo job, sin reenviar trabajos recientes o en ejecución", async () => {
  const now = Date.parse("2026-11-23T21:00:00Z");
  let stored = { status: "QUEUED", updated: now - SLIDE_DISPATCH_RECOVERY_MS - 1 };
  let expected = "";
  let cutoff = Infinity;
  let writes = 0;
  const query = {
    update() { writes++; cutoff = Infinity; return this; }, select() { return this; },
    eq(key: string, value: string) { if (key === "status") expected = value; return this; },
    lt(_key: string, value: string) { cutoff = Date.parse(value); return this; },
    async maybeSingle() {
      const won = stored.status === expected && stored.updated < cutoff;
      if (won) stored = { status: "QUEUED", updated: now };
      return { data: won ? { id: "same-job" } : null, error: null };
    },
  };
  const supabase = { from() { return query; } } as unknown as SupabaseClient;
  const params = { componentId: "component", jobId: "same-job", status: "QUEUED", supabase, now };
  assert.equal(await reserveSlideJobDispatch(params), true);
  assert.equal(await reserveSlideJobDispatch(params), false);
  assert.equal(await reserveSlideJobDispatch({ ...params, status: "RUNNING" }), false);
  assert.equal(writes, 2);
  stored = { status: "RUNNING", updated: now - SLIDE_DISPATCH_RECOVERY_MS - 1 };
  assert.equal(await reserveSlideJobDispatch(params), false);
  stored = { status: "PENDING", updated: now };
  assert.equal(await reserveSlideJobDispatch({ ...params, status: "PENDING" }), true);
  assert.equal(await reserveSlideJobDispatch({ ...params, status: "PENDING" }), false);
});

test("un ACK perdido no convierte un worker activo o terminado en un fallo reintentable", async () => {
  let stored = "RUNNING";
  let expected = "";
  let next = "";
  const query = {
    update(value: { status: string }) { next = value.status; return this; },
    eq(key: string, value: string) { if (key === "status") { expected = value; if (stored === expected) stored = next; } return this; },
    then(resolve: (value: { error: null }) => unknown) { return Promise.resolve({ error: null }).then(resolve); },
  };
  const supabase = { from() { return query; } } as unknown as SupabaseClient;
  const params = { componentId: "component", jobId: "same-job", supabase };
  await failQueuedSlideDispatch(params);
  assert.equal(stored, "RUNNING");
  stored = "SUCCEEDED"; await failQueuedSlideDispatch(params);
  assert.equal(stored, "SUCCEEDED");
  stored = "QUEUED"; await failQueuedSlideDispatch(params);
  assert.equal(stored, "FAILED");
});

test("claims a pending billable job only when the conditional update wins", async () => {
  const filters: Array<[string, string]> = [];
  const query = {
    eq(column: string, value: string) { filters.push([column, value]); return this; },
    maybeSingle() { return Promise.resolve({ data: { id: "job-1" }, error: null }); },
    select() { return this; },
    update() { return this; },
  };
  const supabase = { from(table: string) { return table === "course_source_settings" ? absentSourceSettings() : query; } } as unknown as SupabaseClient;

  assert.equal(await claimPendingProductionJob({ jobId: "job-1", supabase }), true);
  assert.deepEqual(filters, [["id", "job-1"], ["status", "PENDING"]]);
});

function absentSourceSettings() { return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: null, error: null }) }; }
const context = {
  artifactId: "artifact-1",
  componentId: "component-1",
  componentType: "VIDEO_DEMO",
  lessonId: "lesson-1",
  materialLessonId: "material-lesson-1",
  moduleId: "module-1",
  organizationId: "organization-1",
};

test("reopens a failed provider job when an explicit retry is requested", async () => {
  const updates: Record<string, unknown>[] = [];
  let readCount = 0;
  const query = {
    eq() { return this; },
    from() { return this; },
    insert() { throw new Error("retry must not insert a duplicate job"); },
    maybeSingle() {
      readCount += 1;
      if (readCount === 1) {
        return Promise.resolve({
          data: {
            attempt: 1,
            id: "job-1",
            output_snapshot: {},
            provider_job_id: null,
            status: "FAILED",
          },
          error: null,
        });
      }
      return Promise.resolve({
        data: {
          attempt: 2,
          id: "job-1",
          output_snapshot: {},
          provider_job_id: null,
          status: "PENDING",
        },
        error: null,
      });
    },
    select() { return this; },
    update(value: Record<string, unknown>) {
      updates.push(value);
      return this;
    },
  };
  const supabase = {
    from(table: string) { return table === "course_source_settings" ? absentSourceSettings() : query; },
  } as unknown as SupabaseClient;

  const result = await createOrReuseProductionJob(supabase, {
    context,
    idempotencyKey: "same-provider-request",
    inputSnapshot: { clip: "scene-2" },
    jobType: "HEYGEN_AVATAR_CLIP",
    provider: "heygen",
    retryFailed: true,
  });

  assert.equal(result.status, "PENDING");
  assert.equal(result.attempt, 2);
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.status, "PENDING");
  assert.equal(updates[0]?.provider_error, null);
});

test("keeps the existing failed job when retry was not requested", async () => {
  const existing = {
    attempt: 1,
    id: "job-1",
    output_snapshot: {},
    provider_job_id: null,
    status: "FAILED",
  };
  const query = {
    eq() { return this; },
    maybeSingle() { return Promise.resolve({ data: existing, error: null }); },
    select() { return this; },
  };
  const supabase = {
    from(table: string) { return table === "course_source_settings" ? absentSourceSettings() : query; },
  } as unknown as SupabaseClient;

  const result = await createOrReuseProductionJob(supabase, {
    context,
    idempotencyKey: "same-provider-request",
    inputSnapshot: { clip: "scene-2" },
    jobType: "HEYGEN_AVATAR_CLIP",
    provider: "heygen",
  });

  assert.equal(result.status, "FAILED");
});

test("preserves only the generated speech checkpoint across a retry", () => {
  assert.deepEqual(preserveRetryableProviderCheckpoint({
    provider_job_id: "discard-me",
    speech_checkpoint: {
      audio_url: "https://resource.heygen.ai/audio.mp3",
      duration_seconds: 8.4,
    },
  }), {
    speech_checkpoint: {
      audio_url: "https://resource.heygen.ai/audio.mp3",
      duration_seconds: 8.4,
    },
  });
  assert.deepEqual(preserveRetryableProviderCheckpoint({ provider_job_id: "discard-me" }), {});
});

test("persists a structured QA diagnostic when a production job fails", async () => {
  const updates: Record<string, unknown>[] = [];
  const query = {
    eq() { return Promise.resolve({ error: null }); },
    update(value: Record<string, unknown>) { updates.push(value); return this; },
  };
  const supabase = { from(table: string) { return table === "course_source_settings" ? absentSourceSettings() : query; } } as unknown as SupabaseClient;

  await failProductionJob({
    error: new Error("QA estructural fallida"),
    jobId: "job-qa",
    outputSnapshot: { qa_status: "FAIL", slide_count: 9 },
    supabase,
  });

  assert.equal(updates[0]?.status, "FAILED");
  assert.deepEqual(updates[0]?.output_snapshot, { qa_status: "FAIL", slide_count: 9 });
});

test("la reserva concurrente recupera la clave completa con versión documental", async () => {
  const organization = "10000000-0000-4000-8000-000000000001";
  const keys: string[] = [];
  let inserted = false;
  const jobs = {
    select() { return this; }, eq(key: string, value: string) { if (key === "idempotency_key") keys.push(value); return this; },
    maybeSingle: async () => ({ data: null, error: null }),
    insert() { inserted = true; return this; },
    single: async () => inserted && keys.length === 1 ? { data: null, error: { code: "23505" } } : { data: { id: "concurrent", status: "QUEUED" }, error: null },
  };
  const supabase = {
    from(table: string) {
      if (table === "production_jobs") return jobs;
      return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: table === "artifacts" ? { organization_id: organization } : { policy: "DOCUMENTS_AND_WEB", revision: 2, approved_revision: 2, organization_id: organization }, error: null }) };
    },
    rpc: async (name: string) => ({ data: name === "course_source_generation_fingerprint" ? "fingerprint" : null, error: null }),
  } as unknown as SupabaseClient;
  const result = await createOrReuseProductionJob(supabase, { context: { ...context, organizationId: organization }, idempotencyKey: "request", inputSnapshot: {}, jobType: "SLIDE_DECK_GENERATION", provider: "soflia_engine_slides" });
  assert.equal(result.id, "concurrent");
  assert.deepEqual(keys, ["request:sources:2:fingerprint", "request:sources:2:fingerprint"]);
});
