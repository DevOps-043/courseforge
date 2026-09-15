// Explicit opt-in: this smoke test consumes provider tokens, but writes no course data.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
assert.ok(process.argv.includes("--live"), "Use --live to authorize provider smoke requests.");
require("dotenv").config({ path: "apps/web/.env.local", quiet: true });
const { generateObject } = require("ai");
const { createGoogleGenerativeAI } = require("@ai-sdk/google");
const OpenAI = require("openai");
const { ArtifactBaseGenerationSchema } = require("../apps/web/.tmp/model-json-response-tests/domains/artifacts/lib/artifact-base-generation.schema.js");
const { searchLessonCandidates } = require("../apps/web/.tmp/curation-tests/netlify/functions/shared/curation-v2/search.js");
const { validateAutomaticCandidates } = require("../apps/web/.tmp/curation-tests/netlify/functions/shared/curation-v2/workflow.js");
const { generateWithRetry } = require("../apps/web/.tmp/materials-generation-tests/netlify/functions/shared/materials-generation-helpers.js");

try {
  const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY });
  const base = await generateObject({
    model: google(process.env.PIPELINE_SMOKE_BASE_MODEL || "gemini-2.5-flash"),
    schema: ArtifactBaseGenerationSchema,
    prompt: "Define un curso introductorio de Python para adultos: exactamente tres nombres, tres objetivos iniciados con Identificar, Aplicar y Analizar, y una descripción de más de 30 caracteres. No generes módulos.",
    abortSignal: AbortSignal.timeout(60_000), maxRetries: 0,
  });
  assert.ok(ArtifactBaseGenerationSchema.safeParse(base.object).success);
  assert.equal(base.object.nombres.length, 3);
  console.log("PASS live artifact base schema");

  const candidates = await searchLessonCandidates({
    client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 }),
    model: process.env.PIPELINE_SMOKE_SEARCH_MODEL || "gpt-5.4-mini",
    courseContext: "Curso de fundamentos de Python.",
    lessons: [{ lesson_id: "smoke-1", lesson_title: "Listas y diccionarios de Python",
      lesson_objective: "Distinguir listas y diccionarios usando documentación oficial.",
      module_title: "Fundamentos", required_sources: 2, video_target_seconds: 0 }],
  });
  const selected = await validateAutomaticCandidates({ candidates, existingNormalizedUrls: new Set(), limit: 2 });
  assert.equal(selected.length, 2);
  console.log("PASS live source search and HTTP/content validation");

  const result = await generateWithRetry({
    lesson: { lesson_id: "smoke-1", lesson_title: "Listas de Python", module_id: "mod-1",
      module_title: "Fundamentos", oa_text: "Aplicar operaciones básicas de listas",
      components: [{ type: "EXERCISE", summary: "Crear y ordenar una lista de tres números" }],
      quiz_spec: { min_questions: 3, max_questions: 5, types: ["MULTIPLE_CHOICE"] }, requires_demo_guide: false },
    sources: selected.map(({ candidate, validation }, index) => ({ id: `source-${index}`,
      source_title: candidate.title, source_ref: validation.normalizedUrl, cobertura_completa: true })),
    iteration_number: 1,
  }, "[Live smoke]", [process.env.PIPELINE_SMOKE_MATERIALS_MODEL || "gemini-3.6-flash", "gemini-3.5-flash"],
  { temperature: 0.7, thinkingLevel: "medium" }, undefined, undefined, undefined, Date.now() + 90_000);
  assert.ok(result.success, "Material generation failed; inspect provider diagnostics.");
  assert.ok(result.content.components.EXERCISE);
  console.log("PASS live material exercise");
} catch (error) {
  // Do not emit provider response bodies or request contents.
  console.error("Provider smoke failed", { name: error.name, status: error.status, code: error.code });
  process.exitCode = 1;
}
