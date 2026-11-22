import OpenAI from "openai";
import { readCourseSourcePolicy } from "../../../../src/domains/course-sources/course-source-review.service";
import { runDocumentCuration } from "./document-workflow";
import { readSyllabusWithOrigin } from "../../../../src/domains/syllabus/services/syllabus-workflow-read";
import { PIPELINE_GENERATION_LIMITS } from "../../../../src/lib/pipeline-generation-policy";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurationRowInsert } from "../../../../src/shared/types/curation.types";
import {
  buildCourseContextSummary,
  buildLessonsToProcess,
} from "../unified-curation-helpers";
import { calculateLessonCoverage } from "./coverage";
import { searchLessonCandidates } from "./search";
import { validateUrlSource } from "./validation";
import { runWebSourceSearch, normalizedSourceUrls } from "./web-workflow";
import type {
  CurationLesson,
} from "./types";

export { validateAutomaticCandidates } from "./candidate-validation";

export async function runCurationWorkflowV2(params: {
  artifactId: string;
  curationId: string;
  customPrompt?: string;
  courseContext?: string;
  systemPrompt?: string;
  openAiApiKey: string;
  model: string;
  fallbackModel?: string;
  reasoningEffort?: string;
  supabase: SupabaseClient;
  resume?: boolean;
  attemptNumber: number;
  search?: typeof searchLessonCandidates;
  validate?: typeof validateUrlSource;
}) {
  const sourcePolicy = await readCourseSourcePolicy(params.supabase, params.artifactId);
  if (sourcePolicy && sourcePolicy.policy !== "WEB_ONLY") return runDocumentCuration(params);
  const {
    artifactId,
    curationId,
    customPrompt,
    systemPrompt,
    openAiApiKey,
    model,
    reasoningEffort = "low",
    supabase,
  } = params;
  const deadline = Date.now() + PIPELINE_GENERATION_LIMITS.curationRunMs;
  const checkpoint = async (rows: CurationRowInsert[] = [], completion: Record<string, unknown> | null = null) => {
    const { data, error } = await supabase.rpc("commit_curation_progress", {
      p_curation_id: curationId, p_attempt: params.attemptNumber, p_rows: rows, p_completion: completion,
    });
    if (error) throw error;
    return data === true;
  };
  if (!await checkpoint()) return 0;
  const [planResult, artifactResult, syllabusResult] = await Promise.all([
    supabase
      .from("instructional_plans")
      .select("lesson_plans")
      .eq("artifact_id", artifactId)
      .maybeSingle(),
    supabase
      .from("artifacts")
      .select(
        "idea_central, nombres, objetivos, descripcion, generation_metadata, organization_id",
      )
      .eq("id", artifactId)
      .single(),
    readSyllabusWithOrigin(supabase, artifactId, "modules,state"),
  ]);
  if (planResult.error) throw new Error(planResult.error.message);
  if (artifactResult.error) throw new Error(artifactResult.error.message);
  if (syllabusResult.error) throw new Error(syllabusResult.error.message);
  const effectivePlan = await mergeDeliveryCurationPlan(supabase, artifactId, planResult.data?.lesson_plans);
  if (syllabusResult.data?.input_mode === "PROVIDED_SYLLABUS" && planResult.data) {
    const { data: version, error } = await supabase.from("instructional_plans").select("syllabus_content_version").eq("artifact_id", artifactId).single();
    if (error) throw error;
    if (syllabusResult.data.state !== "STEP_APPROVED" || version?.syllabus_content_version !== syllabusResult.data.content_version) {
      throw new Error("El plan no corresponde al temario importado aprobado. Regenera el plan antes de buscar fuentes.");
    }
  }
  const sourceLessons = new Map<string, { topics?: string[] }>();
  for (const [mi, module] of (syllabusResult.data?.modules || []).entries()) {
    for (const [li, lesson] of (module.lessons || []).entries()) sourceLessons.set(lesson.id || `lesson-${mi + 1}-${li + 1}`, lesson);
  }

  const lessons = buildLessonsToProcess(effectivePlan).map(
    (lesson): CurationLesson => ({
      lesson_id: lesson.lesson_id,
      topics: sourceLessons.get(lesson.lesson_id)?.topics || [],
      lesson_title: lesson.lesson_title,
      lesson_objective: lesson.lesson_objective,
      module_title: lesson.module_title,
      required_sources: lesson.required_sources,
      video_target_seconds: lesson.video_target_seconds,
    }),
  );
  const { data: existingRows, error: existingError } = await supabase
    .from("curation_rows")
    .select(
      "id, lesson_id, source_ref, source_kind, origin, apta, validation_report, content_sha256, storage_path",
    )
    .eq("curation_id", curationId);
  if (existingError) throw new Error(existingError.message);

  const automaticRows: Array<{
    id?: string;
    lesson_id: string;
    source_ref?: string | null;
    source_kind?: string | null;
    origin?: string | null;
    apta: boolean | null;
    validation_report?: { status?: string } | null;
    content_sha256?: string | null;
    storage_path?: string | null;
  }> = (existingRows || []).filter(
    (row) =>
      (!row.origin || row.origin === "automatic") && row.source_kind !== "pdf",
  );
  let client: OpenAI | undefined;
  const result = await runWebSourceSearch({
    lessons, existingCounts: new Map(calculateLessonCoverage(lessons, automaticRows).map(item => [item.lessonId, item.validCount])),
    existingUrls: new Map(lessons.map(lesson => [lesson.lesson_id, normalizedSourceUrls(automaticRows.filter(row => row.lesson_id === lesson.lesson_id && row.source_ref).map(row => row.source_ref!))])),
    artifactId, organizationId: artifactResult.data.organization_id, supabase, model, fallbackModel: params.fallbackModel,
    customPrompt, systemPrompt, reasoningEffort, deadline, search: params.search, validate: params.validate,
    courseContext: params.courseContext || buildCourseContextSummary(artifactResult.data, syllabusResult.data).fullCourseContext,
    getClient: () => client ||= new OpenAI({ apiKey: openAiApiKey, maxRetries: 0, timeout: PIPELINE_GENERATION_LIMITS.requestTimeoutMs }),
    checkpoint: () => checkpoint(),
    save: async (lesson, candidate, validation) => checkpoint([{
      curation_id: curationId, lesson_id: lesson.lesson_id, lesson_title: lesson.lesson_title,
      component: "LESSON_SOURCE", is_critical: true, source_ref: validation.normalizedUrl,
      source_title: candidate.title || validation.report.detected_title, source_rationale: candidate.rationale,
      url_status: "OK", apta: true, cobertura_completa: true, auto_evaluated: true,
      auto_reason: validation.report.reason, origin: "automatic", source_kind: "url", validation_report: validation.report,
    }]),
  });
  if (result.cancelled) return result.inserted;

  const { data: finalRows, error: finalRowsError } = await supabase
    .from("curation_rows")
    .select(
      "id, lesson_id, apta, validation_report, source_ref, source_kind, origin, content_sha256, storage_path",
    )
    .eq("curation_id", curationId);
  if (finalRowsError) throw new Error(finalRowsError.message);
  const finalAutomaticRows = (finalRows || []).filter(
    (row) =>
      (!row.origin || row.origin === "automatic") && row.source_kind !== "pdf",
  );
  const coverage = calculateLessonCoverage(lessons, finalAutomaticRows);
  const missing = coverage.filter((item) => !item.isCovered);
  const isComplete = missing.length === 0 && lessons.length > 0;
  const stopReason = result.notes;
  await checkpoint([], {
      state: isComplete ? "PHASE2_APPROVED" : "PHASE2_BLOCKED",
      qa_decision: {
        decision: isComplete ? "APPROVED" : "BLOCKED",
        notes: isComplete
          ? `Curaduria autonoma completada: ${coverage.reduce((total, item) => total + item.validCount, 0)} fuentes web validas para ${lessons.length} lecciones.`
          : `${stopReason} Se conservaron las fuentes válidas. Lecciones pendientes: ${missing.map((item) => `${item.lessonTitle} (${item.validCount}/${item.targetCount})`).join(", ")}`,
        reviewed_by: "gpt:auto",
        reviewed_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    });
  return result.inserted;
}
import { mergeDeliveryCurationPlan } from "../../../../src/domains/course-delivery/services/delivery-curation";
