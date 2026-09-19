import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GoogleGenAI } from "@google/genai";
import type OpenAI from "openai";
import { requestGeminiJson, requestOpenAiJson } from "../materials-model-client";
import { commitGeneratedLesson } from "../material-components.repository";
import { generateLessonMaterials, loadAptaSources, processGenerationResult, triggerNextLesson } from "../materials-generation-runtime";
import { resolveVideoDurationPolicy } from "../../../../src/domains/video-duration/video-duration-policy";
import { generateWithRetry, matchesLesson, parseAndValidateMaterialsOutput } from "../materials-generation-helpers";
import { generationFailureMessage, isGenerationStale, isPermanentProviderFailure } from "../../../../src/lib/pipeline-generation-policy";
import { markArtifactGenerationFailed } from "../../../../src/domains/artifacts/lib/artifact-generation-failure";
import type { MaterialsGenerationInput, MaterialsGenerationOutput } from "../../../../src/domains/materials/types/materials.types";
import { normalizeGeneratedDialogueIdentifiers, validateDialogueIdentifiers } from "../../../../src/domains/materials/lib/dialogue-identifiers";
import { validateSofliaDialogueContent } from "../../../../src/domains/materials/validators/materials-control3.validators";
import { validateSofliaDialogueRuntimeConfig } from "../../../../src/domains/publication/lib/soflia-dialogue-runtime-contract";

const content: MaterialsGenerationOutput = { components: { EXERCISE: { title: "Práctica", body_html: "Texto", instructions: "Comparar", expected_outcome: "Resultado" } }, source_refs_used: [] };
const runtime = { temperature: 0.7, thinkingLevel: "medium" };

const execution = { materialsId: "materials-1", version: 3 };

function dialogueFixture() {
  return {
    interactionType: "soflia_dialogue", runtimeType: "SOFLIA_DIALOGUE", schemaVersion: "1.0.0",
    title: "Audio original y firma sonora", visibleGoal: "Crear una firma sonora",
    learningObjective: "Crear una estrategia de audio original con transparencia sobre IA",
    scenario: "Diseña el audio de una campaña", openingMessage: "¿Qué identidad sonora propones?",
    studentRole: "Productor", sofliaRole: "Tutora", rescueContent: "Explica la autoría y el uso de IA",
    successCriteria: [
      { id: "Firma-Sonóra", label: "Identidad", description: "Justifica la firma sonora", required: true },
      { id: "2 transparencia", label: "Transparencia", description: "Declara el uso de IA", required: true },
    ],
    hintLadder: [
      { id: "Pista-1", level: 1, targetCriterionId: "Firma-Sonóra", content: "Piensa en un motivo reconocible" },
      { id: "Pista-2", level: 2, targetCriterionId: "2 transparencia", content: "Identifica los elementos generados" },
    ],
    expectedEvidence: ["Estrategia justificada"], commonMistakes: ["Omitir la autoría"], challengePrompts: ["Adapta tu propuesta"],
    rubric: [{ id: "Calidad del Audio", label: "Calidad", description: "Coherencia de la propuesta", weight: 100 }],
    policy: { approvalMinimum: 80, maxTurns: 8, maxHints: 3 },
  };
}

const dialogueInput = {
  lesson: { lesson_id: "lesson-4-4", lesson_title: "Audio original", module_id: "module-4", module_title: "Audio", oa_text: "Crear audio original", components: [{ type: "DIALOGUE", summary: "Práctica" }], quiz_spec: null, requires_demo_guide: false },
  sources: [], iteration_number: 3,
} as MaterialsGenerationInput;

test("dialogue generation repairs ID formatting and references before persistence without changing teaching content", () => {
  const dialogue = dialogueFixture();
  const original = structuredClone(dialogue);
  const output = parseAndValidateMaterialsOutput(dialogueInput, { components: { DIALOGUE: dialogue }, source_refs_used: [] });
  const fixed = output.components.DIALOGUE as unknown as ReturnType<typeof dialogueFixture>;
  assert.deepEqual(fixed.successCriteria.map((item) => item.id), ["firma_sonora", "criterion_2_transparencia"]);
  assert.deepEqual(fixed.hintLadder.map((item) => item.targetCriterionId), ["firma_sonora", "criterion_2_transparencia"]);
  assert.deepEqual(fixed.hintLadder.map((item) => item.id), ["pista_1", "pista_2"]);
  assert.equal(fixed.rubric[0].id, "calidad_del_audio");
  assert.deepEqual(dialogue, original, "normalization must not mutate model output");
  assert.equal(fixed.successCriteria[0].description, original.successCriteria[0].description);
  assert.equal(fixed.hintLadder[1].content, original.hintLadder[1].content);
  assert.deepEqual(normalizeGeneratedDialogueIdentifiers(fixed), fixed, "normalization must be idempotent");
  assert.deepEqual(validateSofliaDialogueContent(fixed), []);
  assert.equal(validateSofliaDialogueRuntimeConfig(fixed).valid, true);
});

test("criterion normalization resolves only unambiguous equivalent references", () => {
  const dialogue = dialogueFixture();
  dialogue.hintLadder[0].targetCriterionId = "firma_sonora";
  assert.doesNotThrow(() => parseAndValidateMaterialsOutput(dialogueInput, { components: { DIALOGUE: dialogue }, source_refs_used: [] }));
  dialogue.successCriteria[1].id = "firma sonora";
  assert.throws(() => normalizeGeneratedDialogueIdentifiers(dialogue), /ambiguo/);
  dialogue.hintLadder[0].targetCriterionId = "Firma-Sonóra";
  dialogue.hintLadder[1].targetCriterionId = "firma sonora";
  const normalized = normalizeGeneratedDialogueIdentifiers(dialogue) as ReturnType<typeof dialogueFixture>;
  assert.deepEqual(normalized.successCriteria.map((item) => item.id), ["firma_sonora", "firma_sonora_2"]);
  assert.deepEqual(normalized.hintLadder.map((item) => item.targetCriterionId), ["firma_sonora", "firma_sonora_2"]);
});

test("normalization reserves already valid IDs and rejects absent or duplicated IDs", () => {
  const dialogue = dialogueFixture();
  dialogue.successCriteria[1].id = "firma_sonora";
  dialogue.hintLadder[1].targetCriterionId = "firma_sonora";
  const normalized = normalizeGeneratedDialogueIdentifiers(dialogue) as ReturnType<typeof dialogueFixture>;
  assert.deepEqual(normalized.successCriteria.map((item) => item.id), ["firma_sonora_2", "firma_sonora"]);
  assert.deepEqual(normalized.hintLadder.map((item) => item.targetCriterionId), ["firma_sonora_2", "firma_sonora"]);
  dialogue.successCriteria[1].id = dialogue.successCriteria[0].id;
  assert.throws(() => normalizeGeneratedDialogueIdentifiers(dialogue), /duplicado/);
  dialogue.successCriteria[1].id = "";
  assert.throws(() => normalizeGeneratedDialogueIdentifiers(dialogue), /no vacíos/);
});

test("unrepairable dialogues fail before being accepted as generated", () => {
  const dialogue = dialogueFixture();
  dialogue.hintLadder[0].targetCriterionId = "criterio_que_no_existe";
  assert.throws(() => parseAndValidateMaterialsOutput(dialogueInput, { components: { DIALOGUE: dialogue }, source_refs_used: [] }), /DIALOGUE_IDENTIFIER_INVALID/);
  dialogue.hintLadder[0].targetCriterionId = dialogue.successCriteria[0].id;
  dialogue.rubric[0].weight = 25;
  assert.throws(() => parseAndValidateMaterialsOutput(dialogueInput, { components: { DIALOGUE: dialogue }, source_refs_used: [] }), /DIALOGUE_CONTRACT_INVALID.*sumar 100/);
  assert.throws(() => parseAndValidateMaterialsOutput(dialogueInput, { components: { DIALOGUE: { scenes: [] } }, source_refs_used: [] }), /DIALOGUE_CONTRACT_INVALID.*legacy/);
});

test("all validation boundaries reject duplicate IDs and avoid cascading errors for later valid criteria", () => {
  const dialogue = dialogueFixture();
  dialogue.successCriteria[1].id = "valid_criterion";
  dialogue.hintLadder = [{ id: "hint_1", level: 1, content: "Pista", targetCriterionId: "valid_criterion" }];
  const errors = validateDialogueIdentifiers(dialogue);
  assert.ok(errors.some((error) => error.includes("successCriteria")));
  assert.ok(!errors.some((error) => error.includes("criterios existentes")), "a malformed first criterion must not hide valid later ones");
  dialogue.successCriteria[0].id = "valid_criterion";
  assert.ok(validateSofliaDialogueContent(dialogue).some((error) => error.includes("duplicados")));
  assert.ok(validateSofliaDialogueRuntimeConfig(dialogue).errors.some((error) => error.includes("duplicados")));
});

test("bounded model retries receive dialogue contract feedback instead of repeating the same request", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });
  const prompts: string[] = [];
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(String(options?.body)) as { input: string };
    prompts.push(payload.input);
    const dialogue = dialogueFixture();
    if (prompts.length === 1) dialogue.hintLadder[0].targetCriterionId = "unknown_criterion";
    const generated = JSON.stringify({ components: { DIALOGUE: dialogue }, source_refs_used: [] });
    return new Response(JSON.stringify({ status: "completed", output_text: generated, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: generated, annotations: [] }] }] }), { headers: { "content-type": "application/json" } });
  };
  const input = { ...dialogueInput, fix_instructions: "Conserva el objetivo de audio original" };
  const result = await generateWithRetry(input, "[dialogue test]", ["gpt-5-test"], runtime);
  assert.equal(result.success, true);
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /Contrato de identificadores DIALOGUE/);
  assert.match(prompts[1], /DIALOGUE_IDENTIFIER_INVALID/);
  assert.match(prompts[1], /Conserva el objetivo de audio original/);
  assert.equal(input.fix_instructions, "Conserva el objetivo de audio original");
});

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

test("source-required model output must cite the required validated sources", () => {
  const input = {
    lesson: { lesson_id: "lesson-1", lesson_title: "Lesson", module_id: "module-1", module_title: "Module", oa_text: "Apply", components: [{ type: "EXERCISE", summary: "Practice" }], quiz_spec: null, requires_demo_guide: false },
    sources: [
      { id: "source-1", source_title: "One", source_ref: "https://example.test/1", cobertura_completa: true },
      { id: "source-2", source_title: "Two", source_ref: "https://example.test/2", cobertura_completa: true },
    ],
    requires_sources: true,
    required_source_count: 2,
    iteration_number: 1,
  } as MaterialsGenerationInput;
  const response = { components: { EXERCISE: { title: "Practice" } }, source_refs_used: ["source-1"] };
  assert.throws(
    () => parseAndValidateMaterialsOutput(input, response),
    /INSUFFICIENT_SOURCE_USAGE/,
  );
  assert.doesNotThrow(() => parseAndValidateMaterialsOutput(input, {
    ...response,
    source_refs_used: ["source-1", "source-2"],
  }));
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
