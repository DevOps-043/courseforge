import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateObject } from "ai";
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
  sourcePersistenceError,
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

/** Resuelve identidad desde el curso. El llamante debe haber autorizado el recurso o verificado su job firmado. */
export async function prepareCourseGeneration(
  admin: SupabaseClient,
  artifactId: string,
  stage: CourseGenerationContext["stage"],
  lessonId: string | null = null,
  lessonIds?: string[],
  executionKey?: string,
  expectedInputs?: { modules?: unknown; plans?: unknown; objectives?: unknown },
): Promise<CourseGenerationContext | null> {
  const settings = await readCourseSourcePolicy(admin, artifactId);
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
  const { data: fragments, error } = await admin
    .from("course_source_fragments")
    .select(
      "id,document_id,text_content,content_sha256,locator,ordinal,course_source_documents!inner(status,filename)",
    )
    .eq("artifact_id", artifactId)
    .eq("course_source_documents.status", "READY")
    .order("document_id")
    .order("ordinal")
    .limit(1001);
  if (error) sourcePersistenceError(error);
  if ((fragments?.length || 0) > 1000)
    throw new CourseSourceError(
      413,
      "Demasiados fragmentos para generar. Divide el alcance del curso.",
    );
  let sources: GenerationSource[] = (fragments || []).map((fragment) => ({
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
  if (stage === "MATERIALS") {
    const review = await readSourceReview(admin, artifactId);
    if (
      !review.approved ||
      !review.coverage.length ||
      !review.coverage.every((item) => item.complete) ||
      review.revision !== settings.revision
    )
      throw new CourseSourceError(
        409,
        "Aprueba la cobertura vigente antes de generar materiales.",
      );
    const associations = review.associations.filter(
      (item) =>
        (!canonicalLesson || item.lessonId === canonicalLesson) &&
        (!lessonIds || lessonIds.includes(item.lessonId)),
    );
    const ids = new Set(associations.map((item) => item.evidenceId));
    sources = sources.filter((source) => ids.has(source.id));
    for (const evidence of review.evidence
      .filter((item) => item.type === "WEB" && ids.has(item.id))
      .sort((a, b) => a.id.localeCompare(b.id))) {
      if (settings.policy === "DOCUMENTS_ONLY")
        throw new CourseSourceError(
          409,
          "La política exclusiva no permite evidencia web.",
        );
      let url: URL;
      try {
        url = new URL(evidence.sourceRef || "");
      } catch {
        throw new CourseSourceError(
          409,
          "La fuente web no tiene una URL válida. Corrige la evidencia antes de generar.",
        );
      }
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new CourseSourceError(
          409,
          "La fuente web necesita una referencia pública sin credenciales ni firma.",
        );
      sources.push({
        id: evidence.id,
        kind: "WEB",
        title: evidence.title,
        text: evidence.text,
        hash: sourceTextHash(evidence.text),
        url: evidence.sourceRef!,
        locator: { url: evidence.sourceRef! },
      });
    }
    sources = sources.map((source) => ({
      ...source,
      lessonIds: [
        ...new Set(
          associations
            .filter((item) => item.evidenceId === source.id)
            .map((item) => item.lessonId),
        ),
      ],
    }));
  }
  checkGenerationBudget(sources, stage === "MATERIALS");
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
  return {
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
  for (const model of [...new Set(Array.isArray(models) ? models : [models])]) {
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
        prompt: groundingPrompt(context, output),
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
      if (error instanceof CourseSourceError) throw error;
      await recordAiFailure({
        supabase: admin,
        model,
        startedAt,
        context: telemetry,
        provider: model.startsWith("gemini-") ? "gemini" : "openai",
        error: new Error(
          "Falló la comprobación documental; no se registra contenido privado.",
        ),
      });
    }
  }
  if (!grounding)
    throw new CourseSourceError(
      503,
      "No se pudo comprobar el respaldo dentro del presupuesto de tiempo. Se conserva el trabajo existente; reintenta los pendientes.",
    );
  const { data, error } = await admin.rpc("attest_course_source_generation", {
    p_snapshot: context.snapshotId,
    p_output: output,
    p_citations: grounding.citations,
  });
  if (error) sourcePersistenceError(error);
  return data as string;
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
