import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { readSourceReview } from "../../../../src/domains/course-sources/course-source-review.service";
import { sourceCoverage } from "../../../../src/domains/course-sources/course-source-coverage";
import { searchLessonCandidates } from "./search";
import { validateUrlSource, SOURCE_VALIDATION_TIMEOUT_MS } from "./validation";
import { PIPELINE_GENERATION_LIMITS } from "../../../../src/lib/pipeline-generation-policy";
import type { CurationRowInsert } from "../../../../src/shared/types/curation.types";

export async function runDocumentCuration(params: {
  artifactId: string;
  curationId: string;
  attemptNumber: number;
  supabase: SupabaseClient;
  openAiApiKey: string;
  model: string;
  customPrompt?: string;
  systemPrompt?: string;
  reasoningEffort?: string;
  search?: typeof searchLessonCandidates;
  validate?: typeof validateUrlSource;
}) {
  const snapshot = await readSourceReview(params.supabase, params.artifactId);
  if (!snapshot.policy)
    throw new Error("Elige la política documental antes de curar fuentes.");
  const coverage = sourceCoverage(
    snapshot.policy,
    snapshot.lessons,
    snapshot.associations,
    snapshot.evidence,
  );
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
  if (snapshot.policy === "DOCUMENTS_AND_WEB") {
    const deadline = Date.now() + PIPELINE_GENERATION_LIMITS.curationRunMs;
    let client: OpenAI | undefined;
    for (const lesson of snapshot.lessons) {
      const missing = coverage.find((item) => item.lessonId === lesson.id)!;
      if (
        !missing.missing.length ||
        !missing.webNeeded ||
        Date.now() >= deadline
      )
        continue;
      if (!(await checkpoint())) return inserted;
      client ||= new OpenAI({
        apiKey: params.openAiApiKey,
        maxRetries: 0,
        timeout: PIPELINE_GENERATION_LIMITS.requestTimeoutMs,
      });
      const excludedUrls = snapshot.evidence
        .filter(
          (item) =>
            item.type === "WEB" &&
            item.lessonId === lesson.id &&
            item.sourceRef,
        )
        .map((item) => item.sourceRef!);
      const candidates = await (params.search || searchLessonCandidates)({
        client,
        model: params.model,
        customPrompt: params.customPrompt,
        systemPrompt: params.systemPrompt,
        reasoningEffort: params.reasoningEffort,
        courseContext:
          "Complementar exclusivamente los requisitos indicados sin desplazar documentos propios.",
        lessons: [
          {
            lesson_id: lesson.id,
            lesson_title: lesson.title,
            lesson_objective: lesson.requirements[0].label,
            module_title: "Curso",
            topics: missing.missing.map((item) => item.label),
            required_sources: missing.webNeeded,
            remaining_sources: missing.webNeeded,
            excluded_urls: excludedUrls,
            video_target_seconds: 0,
          },
        ],
        round: 1,
        artifactId: params.artifactId,
        organizationId: snapshot.organizationId,
        supabase: params.supabase,
        deadlineMs: deadline,
      });
      const seen = new Set<string>(excludedUrls);
      const rows: CurationRowInsert[] = [];
      for (const candidate of candidates) {
        if (rows.length >= missing.webNeeded || Date.now() >= deadline) break;
        if (candidate.lesson_id !== lesson.id || seen.has(candidate.url))
          continue;
        const valid = await (params.validate || validateUrlSource)(
          candidate.url,
          {
            existingNormalizedUrls: seen,
            timeoutMilliseconds: Math.max(
              1,
              Math.min(SOURCE_VALIDATION_TIMEOUT_MS, deadline - Date.now()),
            ),
          },
        );
        seen.add(valid.normalizedUrl);
        if (!valid.isValid) continue;
        rows.push({
          curation_id: params.curationId,
          lesson_id: lesson.id,
          lesson_title: lesson.title,
          component: "LESSON_SOURCE",
          is_critical: true,
          source_ref: valid.normalizedUrl,
          source_title: candidate.title,
          source_rationale: candidate.rationale,
          apta: true,
          cobertura_completa: true,
          url_status: "OK",
          auto_evaluated: true,
          auto_reason: valid.report.reason,
          origin: "automatic",
          source_kind: "url",
          validation_report: valid.report,
        });
      }
      if (!(await checkpoint(rows))) return inserted;
      inserted += rows.length;
    }
  }
  const approved =
    snapshot.approved &&
    coverage.length > 0 &&
    coverage.every((item) => item.complete);
  await checkpoint([], {
    state: approved ? "PHASE2_APPROVED" : "PHASE2_BLOCKED",
    qa_decision: {
      decision: approved ? "APPROVED" : "BLOCKED",
      notes: approved
        ? "Cobertura documental revisada y vigente."
        : "Revisa las evidencias y confirma cada objetivo/tema antes de aprobar. Las nuevas URLs no aprueban su suficiencia automáticamente.",
    },
  });
  return inserted;
}
