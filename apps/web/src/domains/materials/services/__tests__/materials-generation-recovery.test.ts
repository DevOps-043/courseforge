import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recoverExpiredMaterialLessons, MATERIAL_LESSON_EXPIRED_MESSAGE } from "../materials-generation-recovery";

const now = Date.parse("2026-09-15T22:00:00Z");
const expired = { id: "lesson-1", state: "GENERATING", iteration_count: 4,
  updated_at: "2026-09-15T17:00:00Z", dod: { errors: ["Video requires correction"], control4_sources: "PASS" } };

function database(accepted = true, failure: unknown = null) {
  const filters: Array<[string, unknown]> = [];
  const writes: unknown[] = [];
  const query = {
    update: (value: unknown) => { writes.push(value); return query; },
    eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
    select: () => query,
    maybeSingle: async () => ({ data: accepted ? { id: expired.id } : null, error: failure }),
  };
  return { client: { from: () => query } as unknown as SupabaseClient, filters, writes };
}

test("expires individual retries without depending on parent GENERATING state", async () => {
  const db = database();
  const [lesson] = await recoverExpiredMaterialLessons(db.client, "materials-1", [expired], now);
  assert.equal(lesson.state, "NEEDS_FIX");
  assert.equal(lesson.dod.control4_sources, "PASS");
  assert.deepEqual(lesson.dod.errors, ["Video requires correction", MATERIAL_LESSON_EXPIRED_MESSAGE]);
  assert.deepEqual(db.filters, [["materials_id", "materials-1"], ["id", "lesson-1"], ["state", "GENERATING"],
    ["iteration_count", 4], ["updated_at", expired.updated_at]]);
});

test("does not expire fresh, completed or pending lessons", async () => {
  const db = database();
  const lessons = [{ ...expired, updated_at: new Date(now - 60_000).toISOString() },
    { ...expired, state: "APPROVABLE" }, { ...expired, state: "PENDING" }];
  assert.deepEqual(await recoverExpiredMaterialLessons(db.client, "materials-1", lessons, now), lessons);
  assert.equal(db.writes.length, 0);
});

test("concurrent newer iteration is neither overwritten nor reported as recovered", async () => {
  const db = database(false);
  assert.deepEqual(await recoverExpiredMaterialLessons(db.client, "materials-1", [expired], now), [expired]);
});

test("database failure is visible instead of reporting an empty course", async () => {
  const db = database(false, new Error("database unavailable"));
  await assert.rejects(recoverExpiredMaterialLessons(db.client, "materials-1", [expired], now), /database unavailable/);
});
