import assert from "node:assert/strict";
import test from "node:test";
import { load } from "../../../app/login/__tests__/source-test-loader";
import { ArtifactBaseGenerationSchema } from "../../artifacts/lib/artifact-base-generation.schema";
import { markArtifactGenerationFailed } from "../../artifacts/lib/artifact-generation-failure";
import { BASE_BATCH_LIMITS } from "../course-source-base-batches";
import { CourseSourceError, DocumentaryBaseBatchError, DocumentaryBasePendingError } from "../course-source-error";
import {
  courseSourcePrompt,
  validateSourceGrounding,
  type CourseGenerationContext,
} from "../course-source-generation";

async function runDocumentaryBase(outcome: "success" | "reject" | "continue" | "duplicate" | "provider_error" = "success") {
  const writes: Record<string, unknown>[] = [];
  const requests: Record<string, unknown>[] = [];
  const providerErrors: unknown[] = [];
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
        id: "10000000-0000-4000-8000-000000000001",
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
  const queued = outcome === "continue" || outcome === "duplicate";
  const invocationActions: string[] = [];
  const dispatches: unknown[] = [];
  const scoped = {
    organization_id: "organization",
    state: "GENERATING",
    generation_metadata: {
      run_id: "run",
      ...(queued ? { base_queue: { revision: 2 }, original_input: { title: "Accesos", description: "Seguridad" } } : {}),
    },
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
    rpc: async (name: string, input: Record<string, unknown>) => {
      assert.equal(name, "record_documentary_base_progress");
      assert.equal(input.p_execution, "run");
      assert.equal(input.p_organization, "organization");
      assert.equal(input.p_artifact, "artifact");
      phases.push(input.p_phase);
      return { data: true, error: null };
    },
    from: (table: string) => {
      assert.equal(table, "artifacts");
      return query;
    },
  };
  const phases: unknown[] = [];
  const worker = load<{
    handler: (event: unknown) => Promise<{ statusCode: number }>;
  }>(
    "netlify/functions/generate-artifact-background.ts",
    {
      "../../src/domains/course-sources/course-source-base-batches": { BASE_BATCH_LIMITS },
      "../../src/domains/course-sources/course-source-error": { CourseSourceError, DocumentaryBaseBatchError, DocumentaryBasePendingError },
      "../../src/domains/course-sources/course-source-base-continuation": {
        commandDocumentaryBaseInvocation: async (_admin: unknown, _execution: unknown, _owner: string, action: string) => {
          invocationActions.push(action);
          return outcome !== "duplicate";
        },
        dispatchDocumentaryBase: async (execution: unknown) => { dispatches.push(execution); },
      },
      "../../src/domains/artifacts/lib/artifact-generation-failure": {
        markArtifactGenerationFailed,
      },
      "../../src/lib/pipeline-generation-policy": {
        PIPELINE_GENERATION_LIMITS: { requestTimeoutMs: 10000 },
      },
      ai: {
        generateObject: async (request: Record<string, unknown>) => {
          requests.push(request);
          assert.equal(request.tools, undefined);
          assert.match(String(request.prompt), /Verifica permisos antes/);
          if (outcome === "provider_error") throw Object.assign(new Error("API key invalid. Respuesta privada."), { statusCode: 400 });
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
        recordAiFailure: async ({ error }: { error: unknown }) => { providerErrors.push(error); },
        recordAiSdkUsage: async () => {},
        recordGeminiUsage: async () => {},
      },
      "../../src/domains/course-sources/course-source-generation.service": {
        prepareCourseGeneration: async (...args: unknown[]) => {
          const options = args.at(-1) as { onProgress: (counts: { confirmed: number; total: number }) => Promise<void> };
          await options.onProgress({ confirmed: 16, total: 23 });
          if (outcome === "continue") throw new DocumentaryBasePendingError("Quedan lotes pendientes.");
          await options.onProgress({ confirmed: 23, total: 23 });
          return context;
        },
        attestCourseGeneration: async (
          _admin: unknown,
          received: unknown,
          output: unknown,
        ) => {
          assert.equal(received, context);
          assert.deepEqual(JSON.parse(JSON.stringify(output)), content);
          checked++;
          if (outcome === "reject") {
            validateSourceGrounding(context, output, {
              supported: true,
              explanation: "Detalle privado del auditor",
              citations: [{
                sourceId: context.sources[0].id,
                quote: "Cita privada que no coincide con el fragmento.",
                claim: content.objetivos[0],
              }],
            });
          }
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
      ...(queued ? { continuation: true, documentary: true } : { formData: { title: "Accesos", description: "Seguridad" } }),
    }),
  });
  return { result, searches, requests, checked, writes, phases, invocationActions, dispatches, providerErrors };
}

test("Base conserva un diagnóstico seguro de Gemini y descarta el mensaje original", async () => {
  const { result, writes, providerErrors } = await runDocumentaryBase("provider_error");
  assert.equal(result.statusCode, 500);
  assert.equal(providerErrors.length, 2);
  for (const error of providerErrors as Error[]) {
    assert.match(error.message, /^El proveedor no pudo generar la base documental\.$/);
    assert.deepEqual(JSON.parse(JSON.stringify(error)), { status: 400, code: "PROVIDER_API_KEY" });
  }
  const report = JSON.stringify(writes.at(-1));
  assert.match(report, /"status":400/);
  assert.doesNotMatch(report, /Respuesta privada/i);
});

test("Base documental omite investigación en principal/fallback incluso con prompt configurado que pide navegar", async () => {
  const { result, searches, requests, checked, writes, phases } = await runDocumentaryBase();
  assert.equal(result.statusCode, 200);
  assert.equal(searches, 0);
  assert.equal(requests.length, 2);
  assert.equal(checked, 1);
  assert.equal(writes.at(-1)!.source_evidence_id, "receipt");
  assert.deepEqual(phases, ["reading", "reading", "writing", "verifying"]);
  const { started_at, ...progress } = JSON.parse(JSON.stringify(writes.at(-1)!.generation_metadata)).base_progress;
  assert.ok(Number.isFinite(Date.parse(started_at)));
  assert.deepEqual(progress, { phase: "verifying", confirmed: 23, total: 23 });
});

test("Base registra el motivo de verificación sin guardar la salida rechazada ni texto privado", async () => {
  const { result, checked, writes, phases } = await runDocumentaryBase("reject");
  assert.equal(result.statusCode, 500);
  assert.equal(checked, 1);
  assert.equal(phases.at(-1), "verifying");
  assert.ok(writes.every((write) => !("source_evidence_id" in write) && !("objetivos" in write)));
  assert.deepEqual(writes.at(-1), {
    state: "ESCALATED",
    validation_report: {
      all_passed: false,
      results: [{
        code: "GENERATION_FAILED",
        passed: false,
        message: "La salida no superó la revisión de respaldo y citas. Revisa las fuentes o reduce el alcance antes de reintentar.",
      }],
      diagnostics: {
        stage: "verification",
        model: "gpt-fallback",
        errorName: "CourseSourceError",
        status: 409,
        groundingReason: "QUOTE_NOT_IN_SOURCE",
      },
    },
  });
});

test("Base cede el lease y despacha el mismo curso cuando quedan lotes pendientes", async () => {
  const { result, writes, phases, requests, invocationActions, dispatches } = await runDocumentaryBase("continue");
  assert.equal(result.statusCode, 200);
  assert.deepEqual(invocationActions, ["claim", "yield"]);
  assert.deepEqual(JSON.parse(JSON.stringify(dispatches)), [{ artifactId: "artifact", runId: "run", organizationId: "organization" }]);
  assert.deepEqual(phases, ["reading"]);
  assert.equal(requests.length, 0);
  assert.equal(writes.length, 0);
});

test("un despacho duplicado queda fuera de lectura y redacción", async () => {
  const { result, writes, phases, requests, invocationActions, dispatches } = await runDocumentaryBase("duplicate");
  assert.equal(result.statusCode, 200);
  assert.deepEqual(invocationActions, ["claim"]);
  for (const effects of [writes, phases, requests, dispatches]) assert.equal(effects.length, 0);
});
