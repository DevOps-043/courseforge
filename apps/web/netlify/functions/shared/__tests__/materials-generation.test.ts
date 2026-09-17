import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GoogleGenAI } from "@google/genai";
import type OpenAI from "openai";
import { requestGeminiJson, requestOpenAiJson } from "../materials-model-client";
import { commitGeneratedLesson } from "../material-components.repository";
import { generateLessonMaterials, loadAptaSources, processGenerationResult, triggerNextLesson } from "../materials-generation-runtime";
import { resolveVideoDurationPolicy } from "../../../../src/domains/video-duration/video-duration-policy";
import { generateWithRetry, matchesLesson } from "../materials-generation-helpers";
import { generationFailureMessage, isGenerationStale, isPermanentProviderFailure } from "../../../../src/lib/pipeline-generation-policy";
import { markArtifactGenerationFailed } from "../../../../src/domains/artifacts/lib/artifact-generation-failure";
import type { MaterialsGenerationInput, MaterialsGenerationOutput } from "../../../../src/domains/materials/types/materials.types";

const content: MaterialsGenerationOutput = { components: { EXERCISE: { title: "Práctica", body_html: "Texto", instructions: "Comparar", expected_outcome: "Resultado" } }, source_refs_used: [] };
const runtime = { temperature: 0.7, thinkingLevel: "medium" };

const execution = { materialsId: "materials-1", version: 3 };

test("chained jobs await HTTP acceptance when Netlify build flags are absent", async (context) => {
  const keys = ["NODE_ENV", "NETLIFY", "URL", "NEXT_PUBLIC_SUPABASE_URL", "BACKGROUND_FUNCTION_SECRET"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Reflect.deleteProperty(process.env, "NODE_ENV");
  delete process.env.NETLIFY;
  process.env.URL = "https://courseforge.example.com";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.BACKGROUND_FUNCTION_SECRET = "test-background-secret-at-least-32-characters";
  context.after(() => {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) Reflect.deleteProperty(process.env, key);
      else Reflect.set(process.env, key, previous[key]);
    }
  });
  let localCalls = 0;
  let remoteCalls = 0;
  const fallback = async () => { localCalls++; };
  globalThis.fetch = async (url, options) => {
    remoteCalls++;
    assert.equal(url, "https://courseforge.example.com/.netlify/functions/materials-generation-background");
    const signed = JSON.parse(String(options?.body)) as { payload: string; signature: string };
    const envelope = JSON.parse(Buffer.from(signed.payload, "base64url").toString("utf8"));
    assert.deepEqual(envelope.value, { materialsId: "materials-1", artifactId: "artifact-1", version: 3, mode: "process-next" });
    assert.ok(signed.signature);
    return new Response(null, { status: 202 });
  };
  await triggerNextLesson("materials-1", "artifact-1", "[test]", 3, fallback);
  assert.equal(remoteCalls, 1);
  assert.equal(localCalls, 0);

  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  await assert.rejects(triggerNextLesson("materials-1", "artifact-1", "[test]", 3, fallback), /fetch failed/);
  globalThis.fetch = async () => new Response(null, { status: 503 });
  await assert.rejects(triggerNextLesson("materials-1", "artifact-1", "[test]", 3, fallback), /HTTP 503/);
  // An HTTP failure must never be reported as a successful timer-based dispatch.
  assert.equal(localCalls, 0);
});

function databaseStub(writeError: { message: string } | null = null, accepted = true) {
  const writes: Array<Record<string, unknown>> = [];
  const database = { rpc: async (name: string, payload: Record<string, unknown>) => {
    assert.equal(name, "commit_material_generation");
    writes.push(payload);
    return { error: writeError, data: accepted };
  } } as unknown as SupabaseClient;
  return { database, writes };
}

test("component replacement and lesson state are committed atomically with execution ownership", async () => {
  const { database, writes } = databaseStub();
  await commitGeneratedLesson(database, "lesson-1", content, 2, "[test]", ["EXERCISE"], {}, { ...execution, success: true });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].p_version, 3);
  assert.equal(writes[0].p_iteration, 2);
  assert.equal(writes[0].p_success, true);
  assert.deepEqual((writes[0].p_rows as Array<{ type: string }>).map(row => row.type), ["EXERCISE"]);
});

test("persistence failure never marks the lesson GENERATED", async () => {
  const { database, writes } = databaseStub({ message: "write failed" });
  await assert.rejects(processGenerationResult({ execution, supabase: database, lessonId: "lesson-1", lessonTitle: "Lección", result: { success: true, content }, iterationNumber: 2, logPrefix: "[test]" }));
  assert.equal(writes.length, 1);
});

test("partial failure commits successful materials with NEEDS_FIX", async () => {
  const { database, writes } = databaseStub();
  const result = await processGenerationResult({ execution, supabase: database, lessonId: "lesson-1", lessonTitle: "Lección", result: { success: false, content, error: "VIDEO_DEMO/GENERATION_FAILED" }, iterationNumber: 2, logPrefix: "[test]" });
  assert.equal(result.success, false);
  assert.equal(writes[0].p_success, false);
  assert.equal(writes[0].p_error, "VIDEO_DEMO/GENERATION_FAILED");
  assert.equal((writes[0].p_rows as unknown[]).length, 1);
});

test("cancelled or replaced executions never report success", async () => {
  const { database } = databaseStub(null, false);
  const result = await processGenerationResult({ execution, supabase: database, lessonId: "lesson-1", lessonTitle: "Lección", result: { success: true, content }, iterationNumber: 2, logPrefix: "[test]" });
  assert.deepEqual(result, { success: false, superseded: true });
});

test("Gemini requests are bounded and report termination and usage", async () => {
  let received: Record<string, unknown> | undefined;
  const client = { models: { generateContent: async (request: Record<string, unknown>) => { received = request; return { text: '{"title":"Complete"}', candidates: [{ finishReason: "STOP" }], usageMetadata: { candidatesTokenCount: 80 } }; } } } as unknown as GoogleGenAI;
  const response = await requestGeminiJson(client, "gemini-test", "prompt", runtime, 5_000);
  assert.deepEqual(response, { content: { title: "Complete" }, finishReason: "STOP", outputTokens: 80 });
  const config = received?.config as { abortSignal: AbortSignal; httpOptions: { timeout: number }; maxOutputTokens: number };
  assert.ok(config.abortSignal instanceof AbortSignal);
  assert.equal(config.httpOptions.timeout, 5_000);
  assert.equal(config.maxOutputTokens, 16_000);
});

test("OpenAI requests disable hidden retries and reject truncated JSON", async () => {
  let options: { maxRetries: number; timeout: number; signal: AbortSignal } | undefined;
  const client = { responses: { create: async (_request: unknown, settings: typeof options) => { options = settings; return { output_text: '{}', status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }; } } } as unknown as OpenAI;
  await assert.rejects(requestOpenAiJson(client, "gpt-test", "prompt", runtime, 5_000), /TRUNCATED_MODEL_JSON/);
  assert.equal(options?.maxRetries, 0);
  assert.equal(options?.timeout, 5_000);
  assert.ok(options?.signal instanceof AbortSignal);
});

test("courses without external curation keep an empty source list", async () => {
  const database = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) } as unknown as SupabaseClient;
  assert.deepEqual(await loadAptaSources(database, "artifact-1"), []);
});

test("an exhausted lesson budget prevents non-video provider calls", async () => {
  const result = await generateWithRetry({} as MaterialsGenerationInput, "[test]", ["gemini-test"], runtime, undefined, undefined, undefined, Date.now() - 1);
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /MATERIALS_TIME_BUDGET_EXHAUSTED/);
});

test("matching titles never assign another identified lesson's sources", () => {
  assert.equal(matchesLesson({ lesson_id: "lesson-1", lesson_title: "Introduction" }, { lesson_id: "undefined-G1", lesson_title: "Introduction" }), true);
  assert.equal(matchesLesson({ lesson_id: "lesson-2", lesson_title: "Introduction" }, { lesson_id: "lesson-1-G1", lesson_title: "Introduction" }), false);
  assert.equal(matchesLesson({ lesson_id: "lesson-1", lesson_title: "Introduction" }, { lesson_id: "lesson-1-G1", lesson_title: "Introduction" }), true);
});

test("source-required lessons fail before spending provider tokens when coverage is missing", async () => {
  const { database, writes } = databaseStub();
  const result = await generateLessonMaterials({ execution, supabase: database,
    lesson: { id: "lesson-1", lesson_id: "lesson-1-G1", lesson_title: "Lesson", module_id: "module-1", module_title: "Module", expected_components: ["EXERCISE"], iteration_count: 1 },
    generationContext: { artifactId: "artifact", lessonPlans: [], lessonSources: [], requiresSources: true, videoDurationPolicy: resolveVideoDurationPolicy(undefined) },
    logPrefix: "[test]", models: ["invalid-model-must-never-be-called"], modelRuntimeConfig: runtime,
  });
  assert.equal(result.success, false);
  assert.match(String(writes[0].p_error), /Fuentes insuficientes/);
  assert.deepEqual(writes[0].p_rows, []);
});

test("provider failures are actionable without leaking response bodies", () => {
  assert.match(generationFailureMessage({ status: 404 }), /modelo.*no está disponible/);
  assert.match(generationFailureMessage(new Error("No object generated: response did not match schema")), /formato inválido/);
  assert.match(generationFailureMessage({ code: "23514", message: "secret payload" }), /base de datos/);
  assert.match(generationFailureMessage({ status: 429, code: "insufficient_quota", message: "secret" }), /saldo/);
  assert.equal(isPermanentProviderFailure({ status: 429, code: "insufficient_quota" }), true);
  assert.equal(isPermanentProviderFailure({ status: 429 }), false);
  assert.equal(generationFailureMessage(new Error("secret")).includes("secret"), false);
  assert.equal(isGenerationStale(new Date(0).toISOString(), 16 * 60_000), true);
  assert.equal(isGenerationStale("invalid"), false);
});

test("initial generation failures are persisted only for the owning running execution", async () => {
  const filters: Array<[string, unknown]> = [];
  let update: { state?: string; validation_report?: { results: Array<{ message: string }> } } = {};
  const query = {
    update: (payload: typeof update) => { update = payload; return query; },
    eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
    then: (resolve: (value: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve),
  };
  const database = { from: () => query } as unknown as SupabaseClient;
  await markArtifactGenerationFailed(database, "artifact-1", "run-1", { status: 429, code: "insufficient_quota" });
  assert.equal(update.state, "ESCALATED");
  assert.match(update.validation_report!.results[0].message, /saldo/);
  assert.deepEqual(filters, [["id", "artifact-1"], ["state", "GENERATING"], ["generation_metadata->>run_id", "run-1"]]);
});
