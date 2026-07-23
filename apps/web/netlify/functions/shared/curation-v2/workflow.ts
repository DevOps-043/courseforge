import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurationRowInsert } from "../../../../src/shared/types/curation.types";
import { buildCourseContextSummary, buildLessonsToProcess } from "../unified-curation-helpers";
import { calculateLessonCoverage } from "./coverage";
import { searchLessonCandidates } from "./search";
import { normalizeSourceUrl, validateUrlSource } from "./validation";
import type {
  CurationCandidate,
  CurationLesson,
  UrlValidationResult,
} from "./types";

const LESSONS_PER_BATCH = 2;
const TARGET_SOURCES_PER_LESSON = 2;
const SEARCH_ATTEMPTS = 3;

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function validateAutomaticCandidates(params: {
  candidates: CurationCandidate[];
  existingNormalizedUrls: Set<string>;
  validate?: (
    url: string,
    options: { existingNormalizedUrls: Iterable<string> },
  ) => Promise<UrlValidationResult>;
  limit?: number;
}) {
  const {
    candidates,
    existingNormalizedUrls,
    validate = validateUrlSource,
    limit = TARGET_SOURCES_PER_LESSON,
  } = params;
  const selected: Array<{
    candidate: CurationCandidate;
    validation: UrlValidationResult;
  }> = [];

  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    const validation = await validate(candidate.url, {
      existingNormalizedUrls,
    });
    if (!validation.isValid) continue;
    existingNormalizedUrls.add(validation.normalizedUrl);
    selected.push({ candidate, validation });
  }
  return selected;
}

export async function runCurationWorkflowV2(params: {
  artifactId: string;
  curationId: string;
  customPrompt?: string;
  openAiApiKey: string;
  model: string;
  supabase: SupabaseClient;
  resume?: boolean;
}) {
  const {
    artifactId,
    curationId,
    customPrompt,
    openAiApiKey,
    model,
    supabase,
    resume,
  } = params;
  const [planResult, artifactResult, syllabusResult] = await Promise.all([
    supabase
      .from("instructional_plans")
      .select("lesson_plans")
      .eq("artifact_id", artifactId)
      .single(),
    supabase
      .from("artifacts")
      .select("idea_central, nombres, objetivos, descripcion, generation_metadata")
      .eq("id", artifactId)
      .single(),
    supabase.from("syllabus").select("modules").eq("artifact_id", artifactId).single(),
  ]);
  if (planResult.error) throw new Error(planResult.error.message);
  if (artifactResult.error) throw new Error(artifactResult.error.message);
  if (syllabusResult.error) throw new Error(syllabusResult.error.message);

  const context = buildCourseContextSummary(artifactResult.data, syllabusResult.data);
  const lessons = buildLessonsToProcess(planResult.data.lesson_plans).map(
    (lesson): CurationLesson => ({
      lesson_id: lesson.lesson_id,
      lesson_title: lesson.lesson_title,
      lesson_objective: lesson.lesson_objective,
      module_title: lesson.module_title,
    }),
  );
  const { data: existingRows, error: existingError } = await supabase
    .from("curation_rows")
    .select("lesson_id, source_ref, apta, validation_report")
    .eq("curation_id", curationId);
  if (existingError) throw new Error(existingError.message);

  const existing = existingRows || [];
  const lessonsToSearch = resume
    ? lessons.filter(
        (lesson) =>
          !existing.some(
            (row) => row.lesson_id === lesson.lesson_id && row.apta === true,
          ),
      )
    : lessons;
  const normalizedUrls = new Set<string>();
  for (const row of existing) {
    try {
      normalizedUrls.add(normalizeSourceUrl(row.source_ref));
    } catch {
      // Invalid legacy rows are revalidated elsewhere.
    }
  }

  const client = new OpenAI({ apiKey: openAiApiKey });
  let inserted = 0;
  let successfulBatches = 0;
  for (let offset = 0; offset < lessonsToSearch.length; offset += LESSONS_PER_BATCH) {
    const batch = lessonsToSearch.slice(offset, offset + LESSONS_PER_BATCH);
    const { data: signal } = await supabase
      .from("curation")
      .select("state")
      .eq("id", curationId)
      .single();
    if (["PAUSED", "PAUSED_REQUESTED", "STOPPED", "STOPPED_REQUESTED"].includes(signal?.state)) {
      const nextState = signal?.state === "PAUSED_REQUESTED" ? "PAUSED" : signal?.state === "STOPPED_REQUESTED" ? "STOPPED" : signal?.state;
      await supabase.from("curation").update({ state: nextState }).eq("id", curationId);
      return inserted;
    }

    let candidates: CurationCandidate[] = [];
    let lastSearchError: unknown;
    for (let attempt = 0; attempt < SEARCH_ATTEMPTS; attempt += 1) {
      try {
        candidates = await searchLessonCandidates({
          client,
          model,
          courseContext: context.fullCourseContext,
          lessons: batch,
          customPrompt,
        });
        successfulBatches += 1;
        lastSearchError = undefined;
        break;
      } catch (error) {
        lastSearchError = error;
        console.error(
          `[Curation V2] Search attempt ${attempt + 1}/${SEARCH_ATTEMPTS} failed:`,
          error,
        );
        if (attempt < SEARCH_ATTEMPTS - 1) {
          await wait(2_000 * (attempt + 1));
        }
      }
    }
    if (lastSearchError) {
      console.error(
        `[Curation V2] Batch left pending after retries: ${batch.map((lesson) => lesson.lesson_id).join(", ")}`,
      );
      continue;
    }

    for (const lesson of batch) {
      const selected = await validateAutomaticCandidates({
        candidates: candidates.filter((item) => item.lesson_id === lesson.lesson_id),
        existingNormalizedUrls: normalizedUrls,
      });
      const rows: CurationRowInsert[] = selected.map(({ candidate, validation }) => ({
          curation_id: curationId,
          lesson_id: lesson.lesson_id,
          lesson_title: lesson.lesson_title,
          component: "LESSON_SOURCE",
          is_critical: true,
          source_ref: validation.normalizedUrl,
          source_title: candidate.title || validation.report.detected_title,
          source_rationale: candidate.rationale,
          url_status: "OK",
          apta: true,
          cobertura_completa: true,
          auto_evaluated: true,
          auto_reason: validation.report.reason,
          origin: "automatic",
          source_kind: "url",
          validation_report: validation.report,
        }));
      if (rows.length > 0) {
        const { error } = await supabase.from("curation_rows").insert(rows);
        if (error) throw new Error(error.message);
        inserted += rows.length;
      }
    }
  }

  if (lessonsToSearch.length > 0 && successfulBatches === 0) {
    throw new Error("OpenAI search failed for every lesson batch.");
  }

  const { data: finalRows, error: finalRowsError } = await supabase
    .from("curation_rows")
    .select("lesson_id, apta, validation_report")
    .eq("curation_id", curationId);
  if (finalRowsError) throw new Error(finalRowsError.message);
  const coverage = calculateLessonCoverage(lessons, finalRows || []);
  const missing = coverage.filter((item) => !item.isCovered);
  await supabase
    .from("curation")
    .update({
      state: "PHASE2_READY_FOR_QA",
      qa_decision:
        missing.length > 0
          ? {
              decision: "CORRECTABLE",
              notes: `Lecciones pendientes de fuentes: ${missing.map((item) => item.lessonTitle).join(", ")}`,
              reviewed_by: "system",
              reviewed_at: new Date().toISOString(),
            }
          : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", curationId);
  return inserted;
}
