import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createOrReuseProductionJob,
  failProductionJob,
  preserveRetryableProviderCheckpoint,
} from "../production-jobs.service";

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
    from() { return query; },
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
    from() { return query; },
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
  const supabase = { from() { return query; } } as unknown as SupabaseClient;

  await failProductionJob({
    error: new Error("QA estructural fallida"),
    jobId: "job-qa",
    outputSnapshot: { qa_status: "FAIL", slide_count: 9 },
    supabase,
  });

  assert.equal(updates[0]?.status, "FAILED");
  assert.deepEqual(updates[0]?.output_snapshot, { qa_status: "FAIL", slide_count: 9 });
});
