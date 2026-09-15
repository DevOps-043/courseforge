import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GoogleGenAI } from "@google/genai";
import type OpenAI from "openai";
import { requestGeminiJson, requestOpenAiJson } from "../materials-model-client";
import { saveGeneratedComponents } from "../material-components.repository";
import { loadAptaSources, processGenerationResult } from "../materials-generation-runtime";
import { generateWithRetry } from "../materials-generation-helpers";
import type { MaterialsGenerationInput, MaterialsGenerationOutput } from "../../../../src/domains/materials/types/materials.types";

const content: MaterialsGenerationOutput = { components: { EXERCISE: { title: "Práctica", body_html: "Texto", instructions: "Comparar", expected_outcome: "Resultado" } }, source_refs_used: [] };
const runtime = { temperature: 0.7, thinkingLevel: "medium" };

function databaseStub(writeError: { message: string } | null = null) {
  const writes: Array<{ table: string; operation: string; payload: unknown; options?: unknown }> = [];
  const database = {
    from(table: string) {
      return {
        upsert(payload: unknown, options: unknown) { writes.push({ table, operation: "upsert", payload, options }); return Promise.resolve({ error: writeError }); },
        update(payload: unknown) { writes.push({ table, operation: "update", payload }); return { eq: () => Promise.resolve({ error: null }) }; },
      };
    },
  } as unknown as SupabaseClient;
  return { database, writes };
}

test("component replacement is one atomic upsert scoped to the generated types", async () => {
  const { database, writes } = databaseStub();
  await saveGeneratedComponents(database, "lesson-1", content, 2, "[test]", ["EXERCISE"]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].operation, "upsert");
  assert.deepEqual(writes[0].options, { onConflict: "material_lesson_id,type" });
  const rows = writes[0].payload as Array<{ type: string }>;
  assert.deepEqual(rows.map((row) => row.type), ["EXERCISE"]);
});

test("persistence failure never marks the lesson GENERATED", async () => {
  const { database, writes } = databaseStub({ message: "write failed" });
  await assert.rejects(processGenerationResult({ supabase: database, lessonId: "lesson-1", lessonTitle: "Lección", result: { success: true, content }, iterationNumber: 2, logPrefix: "[test]" }));
  assert.equal(writes.some((write) => write.table === "material_lessons"), false);
});

test("partial failure saves successful materials and marks the lesson NEEDS_FIX", async () => {
  const { database, writes } = databaseStub();
  const result = await processGenerationResult({ supabase: database, lessonId: "lesson-1", lessonTitle: "Lección", result: { success: false, content, error: "VIDEO_DEMO/GENERATION_FAILED" }, iterationNumber: 2, logPrefix: "[test]" });
  assert.equal(result.success, false);
  assert.deepEqual(writes.map((write) => write.operation), ["upsert", "update"]);
  assert.equal((writes[1].payload as { state: string }).state, "NEEDS_FIX");
});

test("successful regeneration clears obsolete lesson errors before QA", async () => {
  const { database, writes } = databaseStub();
  await processGenerationResult({ supabase: database, lessonId: "lesson-1", lessonTitle: "Lección", result: { success: true, content }, iterationNumber: 2, logPrefix: "[test]" });
  const lesson = writes[1].payload as { state: string; dod: { errors: string[] } };
  assert.equal(lesson.state, "GENERATED");
  assert.deepEqual(lesson.dod.errors, []);
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
