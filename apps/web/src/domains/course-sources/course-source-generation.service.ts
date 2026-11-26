import { randomUUID } from "node:crypto";
import { createOperationalLogger } from "../../lib/server/operational-logger";
import type { DocumentaryBatchCounts } from "./course-source-base-progress";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateObject } from "ai";
import {
  BASE_BATCH_LIMITS,
  baseBatchFindingsSchema,
  planBaseBatches,
  readBaseBatches,
} from "./course-source-base-batches";
import { resolveAiModel } from "../../../netlify/functions/shared/bootstrap";
import {
  recordAiSdkUsage,
  recordAiFailure,
} from "../../shared/ai/usage-telemetry";
import {
  readCourseSourcePolicy,
  readSourceReview,
} from "./course-source-review.service";
import {
  CourseSourceError,
  DocumentaryBasePendingError,
  sourcePersistenceError,
  sourceGroundingFailure,
  type CourseSourceGroundingRejection,
} from "./course-source-error";
import {
  checkGenerationBudget,
  groundingPrompt,
  sourceGroundingSchema,
  sourceTextHash,
  validateSourceGrounding,
  SOURCE_GENERATION_LIMITS,
  type CourseGenerationContext,
  type GenerationSource,
} from "./course-source-generation";
import { allMaterialSnapshotSchema, materialSourceSetAvailability } from "./course-source-material-set";

function baseBatchPersistenceFailure(error: { code?: string; message: string }, durable: boolean): never {
  if (durable && /^(08|PGRST00|40001|40P01|57014|57P0|53)/.test(error.code ?? "")) {
    throw new DocumentaryBasePendingError("La base de datos no confirmó el estado del lote. Se conservará el avance confirmado.", true);
  }
  sourcePersistenceError(error);
}

/** Resuelve identidad desde el curso. El llamante debe haber autorizado el recurso o verificado su job firmado. */
export async function prepareCourseGeneration(
  admin: SupabaseClient,
  artifactId: string,
  stage: CourseGenerationContext["stage"],
  lessonId: string | null = null,
  lessonIds?: string[],
  executionKey?: string,
  expectedInputs?: { modules?: unknown; plans?: unknown; objectives?: unknown },
  baseBatch?: {
    purpose: string; model: string; deadline: number; revision?: number; recoverExpiredBatch?: boolean;
    onProgress?: (counts: DocumentaryBatchCounts) => Promise<void>;
  },
): Promise<CourseGenerationContext | null> {
  const settings = await readCourseSourcePolicy(admin, artifactId);
  if (baseBatch?.revision !== undefined && settings?.revision !== baseBatch.revision)
    throw new CourseSourceError(409, "Las fuentes cambiaron durante la lectura de Base. Actualiza el curso y vuelve a generar.");
  if (!settings || settings.policy === "WEB_ONLY") return null;
  if (!settings.policy)
    throw new CourseSourceError(
      409,
      "Elige la política de fuentes del curso antes de generar.",
    );
  const { data: fingerprint, error: fingerprintError } = await admin.rpc(
    "course_source_generation_fingerprint",
    { p_artifact: artifactId, p_stage: stage },
  );
  if (fingerprintError) sourcePersistenceError(fingerprintError);
  let syllabusVersion: number | undefined;
  if (expectedInputs) {
    const current = await admin.rpc("course_source_curriculum", {
      p_artifact: artifactId,
    });
    if (current.error) sourcePersistenceError(current.error);
    const matches = (expected: unknown, actual: unknown) =>
      expected === undefined ||
      JSON.stringify(expected) === JSON.stringify(actual);
    if (
      !matches(expectedInputs.modules, current.data.modules) ||
      !matches(expectedInputs.plans, current.data.plans) ||
      !matches(expectedInputs.objectives, current.data.base?.objetivos)
    ) {
      throw new CourseSourceError(
        409,
        "Las entradas curriculares cambiaron antes de preparar el contexto. Actualiza desde la etapa anterior antes de generar.",
      );
    }
    syllabusVersion = Number(current.data.syllabusVersion || 0);
  }
  if (stage === "MATERIALS") {
    const review = await readSourceReview(admin, artifactId);
    const availability = materialSourceSetAvailability(review.policy, review.planReady, review.lessons, review.evidence);
    if (!availability.ready) throw new CourseSourceError(409, availability.issues.join(" "));
    const scope = [...new Set((lessonId ? [lessonId] : lessonIds || review.lessons.map(item => item.id)).map(id => id.replace(/-G\d+$/i, "")))].sort();
    const result = await admin.rpc("snapshot_all_course_source_materials", {
      p_artifact: artifactId, p_organization: settings.organization_id,
      p_execution: executionKey ? executionIdentifier(artifactId, stage, executionKey) : randomUUID(), p_lessons: scope,
    });
    if (result.error) sourcePersistenceError(result.error);
    const parsed = allMaterialSnapshotSchema.safeParse(result.data);
    if (!parsed.success || parsed.data.artifactId !== artifactId || parsed.data.fingerprint !== fingerprint || parsed.data.revision !== settings.revision
      || JSON.stringify([...parsed.data.scope].sort()) !== JSON.stringify(scope)) throw new CourseSourceError(409, "El conjunto de fuentes cambió o no cumple el contrato. Actualiza antes de generar.");
    checkGenerationBudget(parsed.data.sources, true);
    return parsed.data;
  }
  const { data: fragments, count, error } = await admin
    .from("course_source_fragments")
    .select(
      "id,document_id,text_content,content_sha256,locator,ordinal,course_source_documents!inner(status,filename)",
      { count: "exact" },
    )
    .eq("artifact_id", artifactId)
    .eq("course_source_documents.status", "READY")
    .order("document_id")
    .order("ordinal")
    .limit(1001);
  if (error) sourcePersistenceError(error);
  if ((count ?? fragments?.length ?? 0) > 1000)
    throw new CourseSourceError(
      413,
      "Demasiados fragmentos para generar. Divide el alcance del curso.",
    );
  const sources: GenerationSource[] = (fragments || []).map((fragment) => ({
    id: fragment.id,
    documentId: fragment.document_id,
    kind: "DOCUMENT",
    title: (Array.isArray(fragment.course_source_documents)
      ? fragment.course_source_documents[0]
      : fragment.course_source_documents
    ).filename,
    text: fragment.text_content,
    hash: fragment.content_sha256,
    locator: fragment.locator,
  }));
  const canonicalLesson = lessonId?.replace(/-G\d+$/i, "") || null;
  const useBaseBatches = stage === "BASE" && baseBatch && sources.reduce(
    (length, source) => length + source.text.length, 0,
  ) > SOURCE_GENERATION_LIMITS.structureCharacters;
  if (!useBaseBatches) checkGenerationBudget(sources);
  const { data: snapshotId, error: snapshotError } = await admin.rpc(
    "snapshot_course_source_generation",
    {
      p_artifact: artifactId,
      p_organization: settings.organization_id,
      p_execution: executionKey
        ? executionIdentifier(artifactId, stage, executionKey)
        : randomUUID(),
      p_stage: stage,
      p_revision: settings.revision,
      p_fingerprint: fingerprint,
      p_lesson: canonicalLesson,
      p_context_hash: sourceTextHash(JSON.stringify(sources)),
      p_manifest: sources.map(({ text, ...source }) =>
        source.kind === "WEB" ? { ...source, text } : source,
      ),
    },
  );
  if (snapshotError) sourcePersistenceError(snapshotError);
  const context: CourseGenerationContext = {
    snapshotId,
    artifactId,
    stage,
    revision: settings.revision,
    fingerprint,
    lessonId: canonicalLesson,
    policy: settings.policy,
    sources,
    ...(syllabusVersion !== undefined ? { syllabusVersion } : {}),
  };
  if (useBaseBatches) {
    const { purpose, model, deadline } = baseBatch;
    const durable = baseBatch.revision !== undefined;
    const planningStartedAt = Date.now();
    const { batches, limits, findingsPerBatch } = planBaseBatches(purpose, sources);
    const metrics = {
      planningMs: Date.now() - planningStartedAt, providerRequests: 0, providerMs: 0, databaseMs: 0,
    };
    const batchRunStartedAt = Date.now();
    const { data: batchRun, error: batchError } = await admin.rpc("create_course_source_batch_run", {
      p_artifact: artifactId, p_organization: settings.organization_id, p_revision: settings.revision,
      p_purpose_hash: sourceTextHash(JSON.stringify({ purpose, model })), p_planner: limits.planner, p_plan: batches,
      p_deadline: new Date(Date.now() + BASE_BATCH_LIMITS.lifetimeMs).toISOString(),
      p_attempts: limits.attempts, p_splits: limits.splits, p_tokens: limits.totalUnits,
    });
    if (batchError) baseBatchPersistenceFailure(batchError, durable);
    const batchRunMs = Date.now() - batchRunStartedAt;
    const batchScope = { p_run: batchRun, p_organization: settings.organization_id };
    if (baseBatch.recoverExpiredBatch) {
      const { error } = await admin.rpc("recover_documentary_base_batch_run", { ...batchScope, p_artifact: artifactId });
      if (error) baseBatchPersistenceFailure(error, durable);
    }
    const readingStartedAt = Date.now();
    try {
      context.sources = await readBaseBatches({
        purpose, sources, deadline, resume: true, findingsPerBatch, onProgress: baseBatch.onProgress,
        automatic: durable,
        command: async (action, path, lease, payload, reason) => {
          const startedAt = Date.now();
          const persistReason = reason && durable;
          if (reason) console.warn("[Fuentes] Salida inválida de lote de Base.", {
            artifactId, batchRunId: batchRun, path, reason,
          });
          const { data, error: commandError } = await admin.rpc(persistReason
            ? "record_documentary_base_invalid_output" : "command_course_source_batch", {
            ...batchScope, p_action: action, p_path: path ?? null, p_lease: lease ?? null, p_payload: payload ?? {},
            ...(persistReason ? { p_reason: reason } : {}),
          });
          metrics.databaseMs += Date.now() - startedAt;
          if (commandError) baseBatchPersistenceFailure(commandError, durable);
          return data;
        },
        progress: async () => {
          const startedAt = Date.now();
          const { data, error: progressError } = await admin.rpc(durable
            ? "read_documentary_base_batch_status" : "read_course_source_base_batch_progress", {
            ...batchScope, p_artifact: artifactId,
          });
          metrics.databaseMs += Date.now() - startedAt;
          if (progressError) baseBatchPersistenceFailure(progressError, durable);
          return data;
        },
        generate: async (prompt, timeoutMs) => {
          const startedAt = Date.now();
          const telemetry = { artifactId, organizationId: settings.organization_id,
            pipelineStep: "BASE", operation: "read_course_source_base_batch", runId: batchRun };
          try {
            const providerModel = resolveAiModel(model);
            metrics.providerRequests++;
            const { object, usage } = await generateObject({
              model: providerModel, schema: baseBatchFindingsSchema, prompt,
              maxRetries: 0, maxOutputTokens: BASE_BATCH_LIMITS.outputTokens,
              abortSignal: AbortSignal.timeout(timeoutMs),
            }).finally(() => { metrics.providerMs += Date.now() - startedAt; });
            await recordAiSdkUsage({ supabase: admin, usage, model, startedAt, context: telemetry });
            return object;
          } catch (error) {
            await recordAiFailure({ supabase: admin, model, startedAt, context: telemetry,
              provider: "openai",
              error: new Error("Falló la lectura de un lote documental; no se registra el contenido."),
            });
            throw error;
          }
        },
      });
    } finally {
      console.info("[Fuentes] Duración de lectura de Base", {
        artifactId, runId: batchRun, batches: batches.length,
        ...metrics, batchRunMs, readingMs: Date.now() - readingStartedAt,
        concurrentBatches: BASE_BATCH_LIMITS.concurrentBatches,
      });
    }
    await assertCourseGenerationCurrent(admin, context);
  }
  return context;
}
function executionIdentifier(artifactId: string, stage: string, key: string) {
  const hash = sourceTextHash(`${artifactId}:${stage}:${key}`);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

export async function attestCourseGeneration(
  admin: SupabaseClient,
  context: CourseGenerationContext | null,
  output: unknown,
  models: string | string[],
  deadlineMs = Date.now() + SOURCE_GENERATION_LIMITS.timeoutMs,
) {
  if (!context) return null;
  await assertCourseGenerationCurrent(admin, context);
  const settings = await readCourseSourcePolicy(admin, context.artifactId);
  const telemetry = {
    artifactId: context.artifactId,
    organizationId: settings?.organization_id,
    pipelineStep: context.stage,
    operation: "validate_course_source_grounding",
    runId: context.snapshotId,
  };
  let grounding: ReturnType<typeof validateSourceGrounding> | undefined;
  let unavailable = { code: "GROUNDING_TIMEOUT", message: "Se agotó el tiempo disponible para comprobar el respaldo." };
  const reviewers = [...new Set(Array.isArray(models) ? models : [models])];
  let citationFailure: CourseSourceGroundingRejection | undefined;
  for (let index = 0; index < reviewers.length; index++) {
    const model = reviewers[index];
    const startedAt = Date.now();
    const timeoutMs = Math.min(
      SOURCE_GENERATION_LIMITS.timeoutMs,
      deadlineMs - startedAt,
    );
    if (timeoutMs < 1000) break;
    try {
      const { object, usage } = await generateObject({
        model: resolveAiModel(model),
        schema: sourceGroundingSchema,
        prompt: groundingPrompt(context, output, citationFailure),
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(timeoutMs),
      });
      await recordAiSdkUsage({
        supabase: admin,
        usage,
        model,
        startedAt,
        context: telemetry,
      });
      grounding = validateSourceGrounding(context, output, object);
      break;
    } catch (error) {
      if (error instanceof CourseSourceError) {
        createOperationalLogger("fuentes.respaldo", { runId: context.snapshotId }).error(
          "revision_contenido_rechazada", sourceGroundingFailure(error),
          { artifactId: context.artifactId, stage: context.stage, model, sourceCount: context.sources.length },
        );
        if (context.stage === "MATERIALS" && !citationFailure && error.groundingReason && error.groundingReason !== "UNSUPPORTED_OUTPUT") {
          citationFailure = error.groundingReason;
          reviewers.splice(index + 1, 0, model);
          continue;
        }
        throw error;
      }
      unavailable = sourceGroundingFailure(error);
      createOperationalLogger("fuentes.respaldo", { runId: context.snapshotId }).error(
        "revision_proveedor_fallida", unavailable,
        { artifactId: context.artifactId, stage: context.stage, model, timeoutMs },
      );
      await recordAiFailure({
        supabase: admin,
        model,
        startedAt,
        context: telemetry,
        provider: "openai",
        error: new Error(
          "Falló la comprobación documental; no se registra contenido privado.",
        ),
      });
    }
  }
  if (!grounding)
    throw new CourseSourceError(
      503,
      `${unavailable.message} Se conserva el trabajo existente.`,
      undefined,
      unavailable.code,
    );
  const { data, error } = await admin.rpc("attest_course_source_generation", {
    p_snapshot: context.snapshotId,
    p_output: output,
    p_citations: grounding.citations,
  });
  if (error) sourcePersistenceError(error);
  if (typeof data !== "string" || !data) throw new CourseSourceError(503, "La base de datos no confirmó el recibo de respaldo.");
  return data;
}
export async function assertCourseGenerationCurrent(
  admin: SupabaseClient,
  context: CourseGenerationContext | null,
) {
  if (!context) return;
  const current = await admin.rpc("course_source_snapshot_current", {
    p_snapshot: context.snapshotId,
  });
  if (current.error || current.data !== true)
    throw new CourseSourceError(
      409,
      "Las fuentes cambiaron durante la generación. Actualiza antes de reintentar.",
    );
}
