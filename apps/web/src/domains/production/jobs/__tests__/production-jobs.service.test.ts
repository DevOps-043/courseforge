import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createOrReuseProductionJob } from "../production-jobs.service";

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
