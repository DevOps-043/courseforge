import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { readSourceReview } from "../../../../src/domains/course-sources/course-source-review.service";
import { isUsableMaterialWebSource, materialSourceSetAvailability } from "../../../../src/domains/course-sources/course-source-material-set";
import { searchLessonCandidates } from "./search";
import { validateUrlSource } from "./validation";
import { runWebSourceSearch, normalizedSourceUrls } from "./web-workflow";
import { PIPELINE_GENERATION_LIMITS } from "../../../../src/lib/pipeline-generation-policy";
import type { CurationRowInsert } from "../../../../src/shared/types/curation.types";

export async function runDocumentCuration(params: {
  artifactId: string;
  curationId: string;
  attemptNumber: number;
  supabase: SupabaseClient;
  openAiApiKey: string;
  model: string;
  fallbackModel?: string;
  customPrompt?: string;
  courseContext?: string;
  systemPrompt?: string;
  reasoningEffort?: string;
  search?: typeof searchLessonCandidates;
  validate?: typeof validateUrlSource;
}) {
  const snapshot = await readSourceReview(params.supabase, params.artifactId);
  if (!snapshot.policy)
    throw new Error("Elige la política documental antes de curar fuentes.");
  const availableEvidence = [...snapshot.evidence];
  const checkpoint = async (
    rows: CurationRowInsert[] = [],
    completion: Record<string, unknown> | null = null,
  ) => {
    const result = await params.supabase.rpc(
      "commit_course_source_curation_progress",
      {
        p_curation_id: params.curationId,
        p_attempt: params.attemptNumber,
        p_revision: snapshot.revision,
        p_curriculum: snapshot.curriculumHash,
        p_rows: rows,
        p_completion: completion,
      },
    );
    if (result.error)
      throw new Error("No se pudo confirmar la curaduría documental.");
    return result.data === true;
  };
  if (!(await checkpoint())) return 0;
  let inserted = 0;
  let searchNotes = "";
  if (snapshot.policy === "DOCUMENTS_AND_WEB") {
    let client: OpenAI | undefined;
    const lessons = snapshot.lessons.map(lesson => ({ lesson_id: lesson.id, lesson_title: lesson.title,
      lesson_objective: lesson.requirements[0]?.label || lesson.title, module_title: "Curso",
      topics: lesson.requirements.map(item => item.label), required_sources: lesson.webRequired, video_target_seconds: 0 }));
    const urls = new Map(lessons.map(lesson => [lesson.lesson_id, normalizedSourceUrls(snapshot.evidence
      .filter(item => item.type === "WEB" && item.lessonId === lesson.lesson_id && item.sourceRef).map(item => item.sourceRef!))]));
    const result = await runWebSourceSearch({
      lessons, existingUrls: urls, existingCounts: new Map([...urls].map(([id, values]) => [id, values.size])),
      artifactId: params.artifactId, organizationId: snapshot.organizationId, supabase: params.supabase,
      model: params.model, fallbackModel: params.fallbackModel, customPrompt: params.customPrompt, courseContext: params.courseContext,
      systemPrompt: params.systemPrompt, reasoningEffort: params.reasoningEffort,
      deadline: Date.now() + PIPELINE_GENERATION_LIMITS.curationRunMs,
      getClient: () => client ||= new OpenAI({ apiKey: params.openAiApiKey, maxRetries: 0, timeout: PIPELINE_GENERATION_LIMITS.requestTimeoutMs }),
      search: params.search || searchLessonCandidates,
      validate: async (url, options) => {
        const result = await (params.validate || validateUrlSource)(url, options);
        if (result.isValid && !isUsableMaterialWebSource(result.report.content_excerpt, result.normalizedUrl)) {
          return { ...result, isValid: false, report: { ...result.report, status: "invalid" as const,
            reason: "La fuente no aporta evidencia utilizable por la política documental." } };
        }
        return result;
      },
      checkpoint: () => checkpoint(),
      save: async (lesson, candidate, validation) => {
        const row: CurationRowInsert = {
          curation_id: params.curationId, lesson_id: lesson.lesson_id, lesson_title: lesson.lesson_title,
          component: "LESSON_SOURCE", is_critical: true, source_ref: validation.normalizedUrl,
          source_title: candidate.title, source_rationale: candidate.rationale, apta: true,
          cobertura_completa: true, url_status: "OK", auto_evaluated: true, auto_reason: validation.report.reason,
          origin: "automatic", source_kind: "url", validation_report: validation.report,
        };
        if (!await checkpoint([row])) return false;
        availableEvidence.push({ id: row.source_ref, type: "WEB", lessonId: lesson.lesson_id,
          title: row.source_title || row.source_ref, sourceRef: row.source_ref, text: validation.report.content_excerpt || "" });
        return true;
      },
    });
    inserted = result.inserted;
    searchNotes = result.notes;
    if (result.cancelled) return inserted;
  }
  const availability = materialSourceSetAvailability(snapshot.policy, snapshot.planReady, snapshot.lessons, availableEvidence);
  const approved = availability.ready;
  await checkpoint([], {
    state: approved ? "PHASE2_APPROVED" : "PHASE2_BLOCKED",
    qa_decision: {
      decision: approved ? "APPROVED" : "BLOCKED",
      notes: approved
        ? "Conjunto completo de fuentes válidas disponible. Los materiales comprobarán su respaldo y citas al generarse."
        : [searchNotes, ...availability.issues].filter(Boolean).join(" "),
    },
  });
  return inserted;
}
