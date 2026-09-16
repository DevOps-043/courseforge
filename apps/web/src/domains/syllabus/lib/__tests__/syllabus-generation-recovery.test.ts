import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SyllabusRow } from "../../types/syllabus.types";
import {
  recoverStaleSyllabusGeneration,
  STALE_SYLLABUS_GENERATION_MESSAGE,
} from "../syllabus-generation-recovery";

const NOW = Date.parse("2026-09-15T20:00:00.000Z");
const STALE_AT = new Date(NOW - (16 * 60_000)).toISOString();
const FRESH_AT = new Date(NOW - 60_000).toISOString();

function buildSyllabus(overrides: Partial<SyllabusRow> = {}): SyllabusRow {
  return {
    artifact_id: "66630878-4017-402b-ad46-4f10cc56f61d",
    route: "B_NO_SOURCE",
    modules: [],
    state: "STEP_GENERATING",
    updated_at: STALE_AT,
    ...overrides,
  } as SyllabusRow;
}

/** Records the filters applied so the concurrency guard can be asserted. */
function buildDatabase(result: { data: unknown; error: unknown }) {
  const filters: Array<[string, unknown]> = [];
  let payload: Record<string, unknown> | null = null;
  const chain = {
    update(values: Record<string, unknown>) {
      payload = values;
      return chain;
    },
    eq(column: string, value: unknown) {
      filters.push([column, value]);
      return chain;
    },
    select() {
      return chain;
    },
    maybeSingle() {
      return Promise.resolve(result);
    },
  };
  const database = { from: () => chain } as unknown as SupabaseClient;
  return {
    database,
    filters,
    getPayload: () => payload,
  };
}

test("a stale generating syllabus is escalated with a readable reason", async () => {
  const syllabus = buildSyllabus();
  const escalated = { ...syllabus, state: "STEP_ESCALATED" };
  const { database, filters, getPayload } = buildDatabase({ data: escalated, error: null });

  const result = await recoverStaleSyllabusGeneration(
    database,
    syllabus.artifact_id,
    syllabus,
    NOW,
  );

  assert.equal(result?.state, "STEP_ESCALATED");
  const payload = getPayload() as Record<string, unknown>;
  assert.equal(payload.state, "STEP_ESCALATED");
  assert.equal(
    (payload.source_summary as { error?: string }).error,
    STALE_SYLLABUS_GENERATION_MESSAGE,
  );
  // The lease guard must pin both the state and the exact row version that was read.
  assert.deepEqual(filters, [
    ["artifact_id", syllabus.artifact_id],
    ["state", "STEP_GENERATING"],
    ["updated_at", STALE_AT],
  ]);
});

test("a generation still within its lease is left untouched", async () => {
  const syllabus = buildSyllabus({ updated_at: FRESH_AT });
  const { database, getPayload } = buildDatabase({ data: null, error: null });

  const result = await recoverStaleSyllabusGeneration(
    database,
    syllabus.artifact_id,
    syllabus,
    NOW,
  );

  assert.equal(result?.state, "STEP_GENERATING");
  assert.equal(getPayload(), null);
});

test("states other than generating are never rewritten", async () => {
  const syllabus = buildSyllabus({ state: "STEP_READY_FOR_QA" });
  const { database, getPayload } = buildDatabase({ data: null, error: null });

  const result = await recoverStaleSyllabusGeneration(
    database,
    syllabus.artifact_id,
    syllabus,
    NOW,
  );

  assert.equal(result?.state, "STEP_READY_FOR_QA");
  assert.equal(getPayload(), null);
});

test("losing the guard race returns the row that was read", async () => {
  const syllabus = buildSyllabus();
  const { database } = buildDatabase({ data: null, error: null });

  const result = await recoverStaleSyllabusGeneration(
    database,
    syllabus.artifact_id,
    syllabus,
    NOW,
  );

  assert.equal(result, syllabus);
});

test("a missing syllabus is returned as-is", async () => {
  const { database, getPayload } = buildDatabase({ data: null, error: null });

  const result = await recoverStaleSyllabusGeneration(database, "any-id", null, NOW);

  assert.equal(result, null);
  assert.equal(getPayload(), null);
});
