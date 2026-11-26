import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SYSTEM_GENERATED_CURATION_ROW_FILTER,
  isSystemGeneratedCurationRow,
} from "../../../../../src/domains/curation/lib/curation-row-rules";
import type { CurationRow } from "../../../../../src/domains/curation/types/curation.types";
import { runCurationWorkflowV2, validateAutomaticCandidates } from "../workflow";
import { runDocumentCuration } from "../document-workflow";
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

function workflowDatabase(options: { lessonCount?: number; rows?: Record<string, unknown>[]; imported?: boolean; planVersion?: number; videoSeconds?: number } = {}) {
  let active = true;
  let completion: { state?: string; qa_decision?: { notes?: string } } | null = null;
  const saved: Record<string, unknown>[] = [...(options.rows || [])];
  const checkpoints: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const database = {
    from(table: string) {
      const result = () => ({ error: null, data: table === "instructional_plans"
        ? { syllabus_content_version: options.planVersion ?? 2, lesson_plans: Array.from({ length: options.lessonCount || 1 }, (_, index) => ({ lesson_id: `lesson-${index + 1}`, lesson_title: `Lesson ${index + 1}`, module_title: "Module", oa_text: "Apply", components: options.videoSeconds ? [{ type: "VIDEO_DEMO", duration_contract: { targetDurationSeconds: options.videoSeconds } }] : [{ type: "READING" }] })) }
        : table === "artifacts" ? { idea_central: "Course", nombres: [], objetivos: [], descripcion: {} }
        : table === "syllabus" ? { input_mode: options.imported ? "PROVIDED_SYLLABUS" : "IDEA", content_version: 2, state: "STEP_APPROVED", modules: options.imported ? [{ title: "Module", lessons: [{ id: "lesson-1", topics: ["Tipos", "Límites"] }] }] : [] } : table === "course_source_settings" ? null : saved });
      const query = { select: () => query, eq: () => query, single: async () => result(), maybeSingle: async () => result(),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
      return query;
    },
    async rpc(name: string, payload: { p_rows: Record<string, unknown>[]; p_completion: { state?: string } | null } & Record<string, unknown>) {
      if (!active) return { data: false, error: null };
      checkpoints.push({ name, payload });
      saved.push(...payload.p_rows);
      completion = payload.p_completion || completion;
      return { data: true, error: null };
    },
  } as unknown as SupabaseClient;
  return { database, saved, checkpoints, cancel: () => { active = false; }, completion: () => completion };
}

const workflowOptions = { artifactId: "artifact", curationId: "curation", attemptNumber: 1, openAiApiKey: "test-key", model: "test-model" };
const candidates = [1, 2].map((index) => ({ lesson_id: "lesson-1", title: `Source ${index}`, url: `https://example.org/${index}`, rationale: "Relevant" }));
const validate = async (url: string): Promise<UrlValidationResult> => ({ normalizedUrl: url, isValid: true, report: report("valid") });

test("imported lesson topics and learning objective reach source search", async () => {
  const fixture = workflowDatabase({ imported: true });
  let searchedTopics: string[] | undefined;
  let searchedObjective = "";
  await runCurationWorkflowV2({ ...workflowOptions, supabase: fixture.database, search: async input => {
    searchedTopics = input.lessons[0].topics;
    searchedObjective = input.lessons[0].lesson_objective;
    return candidates;
  }, validate });
  assert.deepEqual(searchedTopics, ["Apply", "Tipos", "Límites"]);
  assert.equal(searchedObjective, "Apply");
  assert.equal(fixture.saved.length, 2);
});

test("stale imported plan is rejected before searching or saving sources", async () => {
  const fixture = workflowDatabase({ imported: true, planVersion: 1 });
  await assert.rejects(runCurationWorkflowV2({ ...workflowOptions, supabase: fixture.database, search: async () => {
    assert.fail("Search must not run for an obsolete plan");
  }, validate }), /plan no corresponde/);
  assert.equal(fixture.saved.length, 0);
});

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

for (const mode of ["WEB_ONLY", "DOCUMENTS_AND_WEB"] as const) {
  for (const previousCount of [0, 2]) {
    test(`${mode}: cuota de tres sin documentos y reanudación desde ${previousCount}/3`, async context => {
      const initial = [1, 2, 3].slice(0, previousCount).map(index => ({
        lesson_id: "lesson-1", source_ref: `https://example.org/${index}`, source_kind: "url",
        origin: "automatic", apta: true, validation_report: { ...report("valid"), content_excerpt: "Evidencia validada" },
      }));
      const fixture = workflowDatabase({ rows: initial, videoSeconds: 420 });
      const calls: Array<{ count: number; remaining: number | undefined; required: number | undefined }> = [];
      const contexts: string[] = [];
      const imports = createRequire(__filename);
      context.mock.method(imports("../../../../../src/domains/course-sources/course-source-review.service"), "readSourceReview", async () => ({
        policy: "DOCUMENTS_AND_WEB", revision: 3, curriculumHash: "hash", organizationId: "org", planReady: true,
        lessons: [{ id: "lesson-1", title: "Lesson 1", requirements: [{ id: "objective", label: "Apply" }], webRequired: 3 }],
        evidence: initial.map((row, index) => ({ id: `web-${index}`, type: "WEB", lessonId: row.lesson_id,
          title: "Fuente", text: "Evidencia validada", sourceRef: row.source_ref })),
      }));
      const options = { ...workflowOptions, supabase: fixture.database, courseContext: "Curso de gestión del tiempo para principiantes",
        search: async (input: Parameters<NonNullable<Parameters<typeof runCurationWorkflowV2>[0]["search"]>>[0]) => {
          calls.push({ count: input.lessons.length, remaining: input.lessons[0].remaining_sources, required: input.lessons[0].required_sources });
          contexts.push(input.courseContext);
          return ["https://invalid.example/", "https://alias.example/", ...[1, 2, 3].map(index => `https://example.org/${index}`)]
            .map(url => ({ ...candidates[0], url }));
        },
        validate: async (url: string): Promise<UrlValidationResult> => ({ normalizedUrl: url.includes("alias") ? "https://example.org/1" : url,
          isValid: !url.includes("invalid"), report: { ...report(url.includes("invalid") ? "invalid" : "valid"), content_excerpt: "Evidencia validada" } }),
      };
      const inserted = mode === "WEB_ONLY" ? await runCurationWorkflowV2(options) : await runDocumentCuration(options);
      assert.equal(inserted, 3 - previousCount);
      assert.ok(contexts.every(value => value.includes(options.courseContext)));
      assert.deepEqual(calls, [{ count: 1, remaining: 3 - previousCount, required: 3 }]);
      assert.equal(fixture.saved.length, 3);
      assert.deepEqual(fixture.saved.slice(0, previousCount), initial);
      assert.equal(fixture.completion()?.state, "PHASE2_APPROVED");
      assert.ok(fixture.checkpoints.every(({ name, payload }) => payload.p_attempt === 1 &&
        (mode === "WEB_ONLY" ? name === "commit_curation_progress" :
          name === "commit_course_source_curation_progress" && payload.p_revision === 3 && payload.p_curriculum === "hash")));
    });
  }
}

test("el respaldo común recupera la búsqueda sin duplicar fuentes ni exponer el error", async () => {
  const fixture = workflowDatabase();
  const models: string[] = [];
  await runCurationWorkflowV2({ ...workflowOptions, fallbackModel: "fallback-model", supabase: fixture.database,
    search: async input => {
      models.push(input.model);
      if (input.model !== "fallback-model") throw Object.assign(new Error("CONTENIDO_PRIVADO"), { status: 503 });
      return candidates;
    }, validate });
  assert.deepEqual(models, ["test-model", "fallback-model"]);
  assert.equal(fixture.saved.length, 2);
  assert.equal(fixture.completion()?.state, "PHASE2_APPROVED");
});

for (const mode of ["WEB_ONLY", "DOCUMENTS_AND_WEB"] as const) {
  test(`${mode}: conserva 49/60 fuentes de veinte lecciones y completa solo las once faltantes`, async context => {
    const counts = [...Array<number>(15).fill(3), 1, 1, 1, 1, 0];
    const initial = counts.flatMap((count, index) => Array.from({ length: count }, (_, source) => ({
      lesson_id: `lesson-${index + 1}`, source_ref: `https://example.org/lesson-${index + 1}/${source + 1}`,
      source_kind: "url", origin: "automatic", apta: true,
      validation_report: { ...report("valid"), content_excerpt: "Evidencia validada" },
    })));
    const fixture = workflowDatabase({ rows: initial, lessonCount: 20, videoSeconds: 420 });
    const imports = createRequire(__filename);
    context.mock.method(imports("../../../../../src/domains/course-sources/course-source-review.service"), "readSourceReview", async () => ({
      policy: "DOCUMENTS_AND_WEB", revision: 3, curriculumHash: "hash", organizationId: "org", planReady: true,
      lessons: counts.map((_, index) => ({ id: `lesson-${index + 1}`, title: `Lesson ${index + 1}`,
        requirements: [{ id: "objective", label: "Apply" }], webRequired: 3 })),
      evidence: initial.map((row, index) => ({ id: `web-${index}`, type: "WEB", lessonId: row.lesson_id,
        title: "Fuente", text: "Evidencia validada", sourceRef: row.source_ref })),
    }));
    const searched: string[] = [];
    const options = { ...workflowOptions, supabase: fixture.database,
      search: async ({ lessons }: Parameters<NonNullable<Parameters<typeof runCurationWorkflowV2>[0]["search"]>>[0]) => {
        assert.equal(lessons.length, 1);
        const id = lessons[0].lesson_id;
        searched.push(id);
        return [1, 2, 3].map(index => ({ lesson_id: id, title: "Fuente", rationale: "Objetivo",
          url: `https://example.org/${id}/${index}` }));
      },
      validate: async (url: string): Promise<UrlValidationResult> => ({ normalizedUrl: url, isValid: true,
        report: { ...report("valid"), content_excerpt: "Evidencia validada" } }),
    };
    const inserted = mode === "WEB_ONLY" ? await runCurationWorkflowV2(options) : await runDocumentCuration(options);
    assert.equal(initial.length, 49);
    assert.equal(inserted, 11);
    assert.equal(fixture.saved.length, 60);
    assert.deepEqual(fixture.saved.slice(0, 49), initial);
    assert.deepEqual(searched, ["lesson-16", "lesson-17", "lesson-18", "lesson-19", "lesson-20"]);
    assert.equal(fixture.completion()?.state, "PHASE2_APPROVED");
  });
}

test("la búsqueda por lección conserva el progreso de otra lección tras agotarse un formato inválido", async () => {
  const fixture = workflowDatabase({ lessonCount: 2 });
  await runCurationWorkflowV2({ ...workflowOptions, supabase: fixture.database,
    search: async ({ lessons }) => {
      if (lessons[0].lesson_id === "lesson-1") throw Object.assign(new SyntaxError("RESPUESTA_PRIVADA"), { status: 503 });
      return candidates.map(item => ({ ...item, lesson_id: "lesson-2" }));
    }, validate });
  assert.equal(fixture.saved.length, 2);
  assert.ok(fixture.saved.every(row => row.lesson_id === "lesson-2"));
  assert.equal(fixture.completion()?.state, "PHASE2_BLOCKED");
  assert.match(fixture.completion()?.qa_decision?.notes || "", /JSON inválida/);
  assert.doesNotMatch(fixture.completion()?.qa_decision?.notes || "", /RESPUESTA_PRIVADA/);
});
