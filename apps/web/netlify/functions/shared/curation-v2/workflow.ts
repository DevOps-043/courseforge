import OpenAI from "openai";
import { PIPELINE_GENERATION_LIMITS, isPermanentProviderFailure } from "../../../../src/lib/pipeline-generation-policy";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurationRowInsert } from "../../../../src/shared/types/curation.types";
import {
  buildCourseContextSummary,
  buildLessonsToProcess,
} from "../unified-curation-helpers";
import { calculateLessonCoverage } from "./coverage";
import { searchLessonCandidates } from "./search";
import { normalizeSourceUrl, validateUrlSource } from "./validation";
import type {
  CurationCandidate,
  CurationLesson,
  UrlValidationResult,
} from "./types";

const LESSONS_PER_BATCH = 2;
const DEFAULT_SOURCES_PER_LESSON = 2;
const SEARCH_ATTEMPTS = 3;
const MAX_AUTONOMOUS_ROUNDS = 6;
const MAX_STALLED_ROUNDS = 2;

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
  shouldContinue?: () => Promise<boolean>;
}) {
  const {
    candidates,
    existingNormalizedUrls,
    validate = validateUrlSource,
    limit = DEFAULT_SOURCES_PER_LESSON,
  } = params;
  const selected: Array<{
    candidate: CurationCandidate;
    validation: UrlValidationResult;
  }> = [];

  for (const candidate of candidates) {
    if (params.shouldContinue && !await params.shouldContinue()) break;
    if (selected.length >= limit) break;
    let candidateUrl: string;
    try {
      candidateUrl = normalizeSourceUrl(candidate.url);
    } catch {
      continue;
    }
    if (existingNormalizedUrls.has(candidateUrl)) continue;
    const validation = await validate(candidate.url, {
      existingNormalizedUrls,
    });
    // Exclude every attempted URL in later autonomous rounds, including
    // candidates rejected by the technical validator.
    existingNormalizedUrls.add(validation.normalizedUrl || candidateUrl);
    if (!validation.isValid) continue;
    selected.push({ candidate, validation });
  }
  return selected;
}

export async function runCurationWorkflowV2(params: {
  artifactId: string;
  curationId: string;
  customPrompt?: string;
  systemPrompt?: string;
  openAiApiKey: string;
  model: string;
  reasoningEffort?: string;
  supabase: SupabaseClient;
  resume?: boolean;
  attemptNumber: number;
  search?: typeof searchLessonCandidates;
  validate?: typeof validateUrlSource;
}) {
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
      .single(),
    supabase
      .from("artifacts")
      .select(
        "idea_central, nombres, objetivos, descripcion, generation_metadata",
      )
      .eq("id", artifactId)
      .single(),
    supabase
      .from("syllabus")
      .select("modules")
      .eq("artifact_id", artifactId)
      .single(),
  ]);
  if (planResult.error) throw new Error(planResult.error.message);
  if (artifactResult.error) throw new Error(artifactResult.error.message);
  if (syllabusResult.error) throw new Error(syllabusResult.error.message);

  const context = buildCourseContextSummary(
    artifactResult.data,
    syllabusResult.data,
  );
  const lessons = buildLessonsToProcess(planResult.data.lesson_plans).map(
    (lesson): CurationLesson => ({
      lesson_id: lesson.lesson_id,
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
  const normalizedUrlsByLesson = new Map<string, Set<string>>();
  for (const row of automaticRows) {
    if (!row.source_ref) continue;
    try {
      const lessonUrls =
        normalizedUrlsByLesson.get(row.lesson_id) || new Set<string>();
      lessonUrls.add(normalizeSourceUrl(row.source_ref));
      normalizedUrlsByLesson.set(row.lesson_id, lessonUrls);
    } catch {
      // Invalid legacy rows are revalidated elsewhere.
    }
  }
  const hadMissingCoverage = calculateLessonCoverage(
    lessons,
    automaticRows,
  ).some((item) => !item.isCovered);

  const client = new OpenAI({ apiKey: openAiApiKey, maxRetries: 0, timeout: PIPELINE_GENERATION_LIMITS.requestTimeoutMs });
  let inserted = 0;
  let successfulSearchCalls = 0;
  let stalledRounds = 0;

  rounds: for (let round = 1; round <= MAX_AUTONOMOUS_ROUNDS; round += 1) {
    const coverage = calculateLessonCoverage(lessons, automaticRows);
    const missingIds = new Set(
      coverage.filter((item) => !item.isCovered).map((item) => item.lessonId),
    );
    const lessonsToSearch = lessons.filter((lesson) =>
      missingIds.has(lesson.lesson_id),
    );
    if (lessonsToSearch.length === 0) break;

    console.log(
      `[Curation V2] Autonomous round ${round}/${MAX_AUTONOMOUS_ROUNDS}; ${lessonsToSearch.length} lesson(s) pending.`,
    );
    let insertedThisRound = 0;

    for (
      let offset = 0;
      offset < lessonsToSearch.length;
      offset += LESSONS_PER_BATCH
    ) {
      const batch = lessonsToSearch.slice(offset, offset + LESSONS_PER_BATCH);
      if (!await checkpoint()) return inserted;
      if (Date.now() >= deadline) break rounds;

      let candidates: CurationCandidate[] = [];
      let lastSearchError: unknown;
      for (let attempt = 0; attempt < SEARCH_ATTEMPTS; attempt += 1) {
        try {
          candidates = await (params.search || searchLessonCandidates)({
            client,
            model,
            courseContext: context.fullCourseContext,
            lessons: batch.map((lesson) => ({
              ...lesson,
              excluded_urls: [
                ...(normalizedUrlsByLesson.get(lesson.lesson_id) || []),
              ],
            })),
            customPrompt,
            systemPrompt,
            reasoningEffort,
            round,
          });
          successfulSearchCalls += 1;
          lastSearchError = undefined;
          break;
        } catch (error) {
          if (isPermanentProviderFailure(error)) throw error;
          lastSearchError = error;
          console.error(
            `[Curation V2] Search attempt ${attempt + 1}/${SEARCH_ATTEMPTS} failed:`,
            error,
          );
          if (attempt < SEARCH_ATTEMPTS - 1) await wait(2_000 * (attempt + 1));
        }
      }
      if (lastSearchError) {
        console.error(
          `[Curation V2] Batch pending after retries: ${batch.map((lesson) => lesson.lesson_id).join(", ")}`,
        );
        continue;
      }

      for (const lesson of batch) {
        const lessonNormalizedUrls =
          normalizedUrlsByLesson.get(lesson.lesson_id) || new Set<string>();
        normalizedUrlsByLesson.set(lesson.lesson_id, lessonNormalizedUrls);
        const coverageItem = calculateLessonCoverage(
          lessons,
          automaticRows,
        ).find((item) => item.lessonId === lesson.lesson_id);
        const remainingSources = Math.max(
          0,
          (lesson.required_sources || DEFAULT_SOURCES_PER_LESSON) -
            (coverageItem?.validCount || 0),
        );
        const selected = await validateAutomaticCandidates({
          candidates: candidates.filter(
            (item) => item.lesson_id === lesson.lesson_id,
          ),
          existingNormalizedUrls: lessonNormalizedUrls,
          limit: remainingSources,
          validate: params.validate,
          shouldContinue: async () => Date.now() < deadline && await checkpoint(),
        });
        const rows: CurationRowInsert[] = selected.map(
          ({ candidate, validation }) => ({
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
          }),
        );
        if (rows.length > 0) {
          if (!await checkpoint(rows)) return inserted;
          automaticRows.push(
            ...rows.map((row) => ({
              lesson_id: row.lesson_id,
              source_ref: row.source_ref,
              source_kind: row.source_kind,
              origin: row.origin,
              apta: row.apta,
              validation_report: row.validation_report as {
                status?: string;
              },
            })),
          );
          inserted += rows.length;
          insertedThisRound += rows.length;
        }
      }
    }

    stalledRounds = insertedThisRound === 0 ? stalledRounds + 1 : 0;
    if (stalledRounds >= MAX_STALLED_ROUNDS) {
      console.warn(
        "[Curation V2] Stopping after two rounds without new valid sources.",
      );
      break;
    }
  }

  if (hadMissingCoverage && successfulSearchCalls === 0 && inserted === 0) {
    throw new Error("OpenAI search failed for every lesson batch.");
  }

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
  await checkpoint([], {
      state: isComplete ? "PHASE2_APPROVED" : "PHASE2_BLOCKED",
      qa_decision: {
        decision: isComplete ? "APPROVED" : "BLOCKED",
        notes: isComplete
          ? `Curaduria autonoma completada: ${coverage.reduce((total, item) => total + item.validCount, 0)} fuentes web validas para ${lessons.length} lecciones.`
          : `La búsqueda alcanzó su límite de tiempo o intentos. Reanuda para completar las fuentes conservadas. Lecciones pendientes: ${missing.map((item) => `${item.lessonTitle} (${item.validCount}/${item.targetCount})`).join(", ")}`,
        reviewed_by: "gpt:auto",
        reviewed_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    });
  return inserted;
}
