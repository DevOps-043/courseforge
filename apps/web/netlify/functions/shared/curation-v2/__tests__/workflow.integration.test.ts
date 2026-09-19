import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SYSTEM_GENERATED_CURATION_ROW_FILTER,
  isSystemGeneratedCurationRow,
} from "../../../../../src/domains/curation/lib/curation-row-rules";
import type { CurationRow } from "../../../../../src/domains/curation/types/curation.types";
import { runCurationWorkflowV2, validateAutomaticCandidates } from "../workflow";
import type { CurationValidationReport, UrlValidationResult } from "../types";

function report(
  status: CurationValidationReport["status"],
): CurationValidationReport {
  return {
    status,
    checked_at: new Date(0).toISOString(),
    reason: status === "valid" ? "ok" : "invalid",
    checks: {
      blocked_domain: false,
      duplicate: false,
      http_ok: status === "valid",
      minimum_content: status === "valid",
      paywall: false,
      soft_404: false,
      valid_mime: status === "valid",
    },
  };
}

async function run() {
  const existing = new Set(["https://existing.example/"]);
  const selected = await validateAutomaticCandidates({
    candidates: [
      {
        lesson_id: "lesson-1",
        url: "https://invalid.example/",
        title: "Invalid",
        rationale: "",
      },
      {
        lesson_id: "lesson-1",
        url: "https://valid-one.example/",
        title: "Valid one",
        rationale: "",
      },
      {
        lesson_id: "lesson-1",
        url: "https://valid-two.example/",
        title: "Valid two",
        rationale: "",
      },
      {
        lesson_id: "lesson-1",
        url: "https://valid-three.example/",
        title: "Valid three",
        rationale: "",
      },
    ],
    existingNormalizedUrls: existing,
    limit: 3,
    validate: async (url): Promise<UrlValidationResult> => ({
      isValid: !url.includes("invalid"),
      normalizedUrl: url,
      report: report(url.includes("invalid") ? "invalid" : "valid"),
    }),
  });

  assert.deepEqual(
    selected.map((item) => item.candidate.title),
    ["Valid one", "Valid two", "Valid three"],
  );
  assert.equal(existing.has("https://valid-one.example/"), true);
  assert.equal(existing.has("https://valid-three.example/"), true);
  assert.equal(
    existing.has("https://invalid.example/"),
    true,
    "invalid candidates must be excluded from later autonomous rounds",
  );

  const automatic = {
    origin: "automatic",
    auto_evaluated: true,
  } as CurationRow;
  const manual = { origin: "manual", auto_evaluated: true } as CurationRow;
  assert.equal(SYSTEM_GENERATED_CURATION_ROW_FILTER, "origin.eq.automatic");
  assert.equal(isSystemGeneratedCurationRow(automatic), true);
  assert.equal(isSystemGeneratedCurationRow(manual), false);
}

void run().then(() => {
  console.log("curation-v2 workflow integration tests passed");
});

function workflowDatabase(options: { lessonCount?: number; rows?: Record<string, unknown>[] } = {}) {
  let active = true;
  let completion: { state?: string; qa_decision?: { notes?: string } } | null = null;
  const saved: Record<string, unknown>[] = [...(options.rows || [])];
  const database = {
    from(table: string) {
      const result = () => ({ error: null, data: table === "instructional_plans"
        ? { lesson_plans: Array.from({ length: options.lessonCount || 1 }, (_, index) => ({ lesson_id: `lesson-${index + 1}`, lesson_title: `Lesson ${index + 1}`, module_title: "Module", oa_text: "Apply", components: [{ type: "READING" }] })) }
        : table === "artifacts" ? { idea_central: "Course", nombres: [], objetivos: [], descripcion: {} }
        : table === "syllabus" ? { modules: [] } : saved });
      const query = { select: () => query, eq: () => query, single: async () => result(),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
      return query;
    },
    async rpc(_name: string, payload: { p_rows: Record<string, unknown>[]; p_completion: { state?: string } | null }) {
      if (!active) return { data: false, error: null };
      saved.push(...payload.p_rows);
      completion = payload.p_completion || completion;
      return { data: true, error: null };
    },
  } as unknown as SupabaseClient;
  return { database, saved, cancel: () => { active = false; }, completion: () => completion };
}

const workflowOptions = { artifactId: "artifact", curationId: "curation", attemptNumber: 1, openAiApiKey: "test-key", model: "test-model" };
const candidates = [1, 2].map((index) => ({ lesson_id: "lesson-1", title: `Source ${index}`, url: `https://example.org/${index}`, rationale: "Relevant" }));
const validate = async (url: string): Promise<UrlValidationResult> => ({ normalizedUrl: url, isValid: true, report: report("valid") });

test("complete curation persists sources before approving", async () => {
  const fixture = workflowDatabase();
  await runCurationWorkflowV2({ ...workflowOptions, supabase: fixture.database, search: async () => candidates, validate });
  assert.equal(fixture.saved.length, 2);
  assert.equal(fixture.completion()?.state, "PHASE2_APPROVED");
});

test("incomplete coverage is blocked instead of approved", async () => {
  const fixture = workflowDatabase();
  await runCurationWorkflowV2({ ...workflowOptions, supabase: fixture.database, search: async () => [], validate });
  assert.equal(fixture.completion()?.state, "PHASE2_BLOCKED");
});

test("cancellation during provider response prevents source writes and completion", async () => {
  const fixture = workflowDatabase();
  await runCurationWorkflowV2({ ...workflowOptions, supabase: fixture.database, search: async () => { fixture.cancel(); return candidates; }, validate });
  assert.equal(fixture.saved.length, 0);
  assert.equal(fixture.completion(), null);
});

test("billing rejection is not retried for every lesson", async () => {
  const fixture = workflowDatabase();
  let calls = 0;
  await assert.rejects(runCurationWorkflowV2({ ...workflowOptions, supabase: fixture.database,
    search: async () => { calls++; throw Object.assign(new Error("insufficient_quota"), { status: 429 }); }, validate }), /insufficient_quota/);
  assert.equal(calls, 1);
  assert.equal(fixture.completion(), null);
});

test("resuming partial curation preserves valid sources and searches only missing coverage", async () => {
  const fixture = workflowDatabase({ lessonCount: 2 });
  const partial = [...candidates, { ...candidates[0], lesson_id: "lesson-2" }];
  await runCurationWorkflowV2({ ...workflowOptions, supabase: fixture.database, search: async () => partial, validate });
  assert.equal(fixture.saved.length, 3);
  assert.equal(fixture.completion()?.state, "PHASE2_BLOCKED");
  assert.match(fixture.completion()?.qa_decision?.notes || "", /no encontraron nuevas fuentes/);
  const originalRows = [...fixture.saved];
  let searches = 0;
  await runCurationWorkflowV2({
    ...workflowOptions, attemptNumber: 2, resume: true, supabase: fixture.database,
    search: async ({ lessons }) => {
      searches++;
      assert.equal(lessons.length, 1, "completed lesson must not be regenerated");
      assert.equal(lessons[0].lesson_id, "lesson-2");
      assert.equal(lessons[0].remaining_sources, 1);
      assert.deepEqual(lessons[0].excluded_urls, [candidates[0].url]);
      return candidates.map((candidate) => ({ ...candidate, lesson_id: "lesson-2" }));
    }, validate,
  });
  assert.equal(searches, 1);
  assert.equal(fixture.saved.length, 4);
  assert.deepEqual(fixture.saved.slice(0, 3), originalRows);
  assert.equal(fixture.completion()?.state, "PHASE2_APPROVED");
});

test("resuming a complete curation does not call the search provider", async () => {
  const fixture = workflowDatabase();
  await runCurationWorkflowV2({ ...workflowOptions, supabase: fixture.database, search: async () => candidates, validate });
  await runCurationWorkflowV2({ ...workflowOptions, attemptNumber: 2, resume: true, supabase: fixture.database,
    search: async () => { throw new Error("complete lessons must be skipped"); }, validate });
  assert.equal(fixture.saved.length, 2);
  assert.equal(fixture.completion()?.state, "PHASE2_APPROVED");
});

test("redirect aliases cannot count as multiple valid sources or be retried indefinitely", async () => {
  const excluded = new Set<string>();
  let validations = 0;
  const selected = await validateAutomaticCandidates({
    candidates: [...candidates, candidates[0]], existingNormalizedUrls: excluded,
    validate: async () => {
      validations++;
      return { normalizedUrl: "https://example.org/canonical", isValid: true, report: report("valid") };
    },
  });
  assert.equal(selected.length, 1);
  assert.equal(validations, 2);
  assert.ok(excluded.has(candidates[0].url));
  assert.ok(excluded.has(candidates[1].url));
  assert.ok(excluded.has("https://example.org/canonical"));
});

test("exhausting the deadline saves a resumable state without starting more provider retries", async () => {
  const fixture = workflowDatabase();
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  let searches = 0;
  try {
    await runCurationWorkflowV2({ ...workflowOptions, supabase: fixture.database,
      search: async ({ deadlineMs }) => {
        searches++;
        assert.ok(deadlineMs && deadlineMs > now);
        now = deadlineMs!;
        throw new Error("timeout");
      }, validate });
  } finally {
    Date.now = originalNow;
  }
  assert.equal(searches, 1);
  assert.equal(fixture.completion()?.state, "PHASE2_BLOCKED");
  assert.match(fixture.completion()?.qa_decision?.notes || "", /tiempo disponible/);
});
