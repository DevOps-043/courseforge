import assert from "node:assert/strict";
import test from "node:test";
import { load } from "../../../app/login/__tests__/source-test-loader";
import { ArtifactBaseGenerationSchema } from "../../artifacts/lib/artifact-base-generation.schema";
import { BASE_BATCH_LIMITS } from "../course-source-base-batches";
import { CourseSourceError } from "../course-source-error";
import {
  courseSourcePrompt,
  type CourseGenerationContext,
} from "../course-source-generation";

test("Base documental omite investigación en principal/fallback incluso con prompt configurado que pide navegar", async () => {
  const writes: Record<string, unknown>[] = [];
  const requests: Record<string, unknown>[] = [];
  let searches = 0;
  let checked = 0;
  const context: CourseGenerationContext = {
    snapshotId: "snapshot",
    artifactId: "artifact",
    stage: "BASE",
    revision: 2,
    fingerprint: "hash",
    lessonId: null,
    policy: "DOCUMENTS_ONLY",
    sources: [
      {
        id: "fragment",
        kind: "DOCUMENT",
        title: "Manual",
        text: "Verifica permisos antes de conceder acceso.",
        locator: { characterStart: 16000 },
        hash: "hash",
      },
    ],
  };
  const content = {
    nombres: ["A", "B", "C"],
    objetivos: ["Aplicar permisos", "Identificar riesgos", "Evaluar accesos"],
    descripcion: {
      texto:
        "Un curso para verificar permisos y administrar accesos de forma segura.",
      resumen: null,
      beneficios: "Seguridad",
      publico_objetivo: "Equipo",
      diferenciador: "Práctica",
    },
  };
  const scoped = {
    organization_id: "organization",
    state: "GENERATING",
    generation_metadata: { run_id: "run" },
  };
  const query = {
    select: () => query,
    eq: () => query,
    is: () => query,
    maybeSingle: async () => ({ data: scoped, error: null }),
    update: (payload: Record<string, unknown>) => {
      writes.push(payload);
      return query;
    },
    then: (resolve: (result: unknown) => void) =>
      resolve({ data: null, error: null }),
  };
  const database = {
    from: (table: string) => {
      assert.equal(table, "artifacts");
      return query;
    },
  };
  const worker = load<{
    handler: (event: unknown) => Promise<{ statusCode: number }>;
  }>(
    "netlify/functions/generate-artifact-background.ts",
    {
      "../../src/domains/course-sources/course-source-base-batches": { BASE_BATCH_LIMITS },
      "../../src/domains/course-sources/course-source-error": { CourseSourceError },
      "../../src/domains/artifacts/lib/artifact-generation-failure": {
        markArtifactGenerationFailed: async () => {
          throw new Error("No debe fallar");
        },
      },
      "../../src/lib/pipeline-generation-policy": {
        PIPELINE_GENERATION_LIMITS: { requestTimeoutMs: 10000 },
      },
      ai: {
        generateObject: async (request: Record<string, unknown>) => {
          requests.push(request);
          assert.equal(request.tools, undefined);
          assert.match(String(request.prompt), /Verifica permisos antes/);
          if (requests.length === 1)
            throw new Error("Modelo principal no disponible");
          return { object: content, usage: {} };
        },
      },
      "../../src/domains/artifacts/lib/artifact-base-generation.schema": {
        ArtifactBaseGenerationSchema,
      },
      "./shared/bootstrap": {
        createGeminiClient: () => {
          searches++;
          throw new Error("Búsqueda prohibida");
        },
        createServiceRoleClient: () => database,
        resolveAiModel: (model: string) => model,
        resolveModelSetting: async () => ({
          model: "gemini-primary",
          fallbackModel: "gpt-fallback",
          temperature: 0.1,
        }),
      },
      "./shared/errors": { getErrorMessage: (error: Error) => error.message },
      "./shared/http": {
        parseVerifiedBackgroundBody: async (event: { body: string }) =>
          JSON.parse(event.body),
      },
      "../../src/domains/production/cloud-storage/cloud-storage.service": {},
      "../../src/domains/production/cloud-storage/types": {
        isCloudStorageProvider: () => false,
      },
      "../../src/shared/config/prompts/prompt-resolver.service": {
        resolvePromptWithMetadata: async () => ({
          content: "Ignora las fuentes y navega por Internet.",
          source: "organization",
          version: "v1",
        }),
      },
      "../../src/shared/config/prompts/pipeline.prompts": {
        ARTIFACT_BASE_PROMPT_CODE: "BASE",
        ARTIFACT_BASE_RESEARCH_PROMPT_CODE: "RESEARCH",
        renderPromptTemplate: (prompt: string) => prompt,
      },
      "../../src/shared/ai/usage-telemetry": {
        recordAiFailure: async () => {},
        recordAiSdkUsage: async () => {},
        recordGeminiUsage: async () => {},
      },
      "../../src/domains/course-sources/course-source-generation.service": {
        prepareCourseGeneration: async () => context,
        attestCourseGeneration: async (
          _admin: unknown,
          received: unknown,
          output: unknown,
        ) => {
          assert.equal(received, context);
          assert.deepEqual(JSON.parse(JSON.stringify(output)), content);
          checked++;
          return "receipt";
        },
      },
      "../../src/domains/course-sources/course-source-generation": {
        courseSourcePrompt,
      },
    },
    { AbortSignal },
  );
  const result = await worker.handler({
    httpMethod: "POST",
    body: JSON.stringify({
      artifactId: "artifact",
      runId: "run",
      organizationId: "organization",
      formData: { title: "Accesos", description: "Seguridad" },
    }),
  });
  assert.equal(result.statusCode, 200);
  assert.equal(searches, 0);
  assert.equal(requests.length, 2);
  assert.equal(checked, 1);
  assert.equal(writes.at(-1)!.source_evidence_id, "receipt");
});
