import type OpenAI from "openai";
import { generationFailureMessage, isPermanentProviderFailure } from "../../../../src/lib/pipeline-generation-policy";
import { createOperationalLogger } from "../../../../src/lib/server/operational-logger";
import { validateAutomaticCandidates } from "./candidate-validation";
import { searchLessonCandidates } from "./search";
import { normalizeSourceUrl, SOURCE_VALIDATION_TIMEOUT_MS, validateUrlSource } from "./validation";
import type { CurationCandidate, CurationLesson, UrlValidationResult } from "./types";

export function normalizedSourceUrls(urls: Iterable<string>) {
  const result = new Set<string>();
  for (const url of urls) {
    try { result.add(normalizeSourceUrl(url)); } catch { /* Las filas históricas inválidas no cuentan como URLs. */ }
  }
  return result;
}

/** Motor común; cada adaptador conserva la autoridad de confirmar filas y cerrar la curaduría. */
export async function runWebSourceSearch(params: {
  lessons: CurationLesson[];
  existingCounts: Map<string, number>;
  existingUrls: Map<string, Set<string>>;
  artifactId: string;
  organizationId?: string | null;
  supabase: Parameters<typeof searchLessonCandidates>[0]["supabase"];
  model: string;
  fallbackModel?: string;
  customPrompt?: string;
  courseContext?: string;
  systemPrompt?: string;
  reasoningEffort?: string;
  deadline: number;
  getClient: () => OpenAI;
  checkpoint: () => Promise<boolean>;
  save: (lesson: CurationLesson, candidate: CurationCandidate, validation: UrlValidationResult) => Promise<boolean>;
  search?: typeof searchLessonCandidates;
  validate?: typeof validateUrlSource;
}) {
  const counts = new Map(params.existingCounts);
  const failures = new Map<string, string>();
  const stats = { searches: 0, accepted: 0, rejected: 0, duplicates: 0 };
  const logger = createOperationalLogger("curaduria.web", { artifactId: params.artifactId });
  let cancelled = false, stalled = 0;
  const target = (lesson: CurationLesson) => Math.max(1, lesson.required_sources || 2);
  const pending = () => params.lessons.filter(lesson => (counts.get(lesson.lesson_id) || 0) < target(lesson));
  const active = async () => {
    if (Date.now() >= params.deadline) return false;
    if (!await params.checkpoint()) { cancelled = true; return false; }
    return true;
  };
  rounds: for (let round = 1; round <= 6 && pending().length; round++) {
    const before = stats.accepted;
    for (const lesson of pending()) {
      if (!await active()) break rounds;
      const seen = params.existingUrls.get(lesson.lesson_id) || new Set<string>();
      params.existingUrls.set(lesson.lesson_id, seen);
      const remaining = Math.max(0, target(lesson) - (counts.get(lesson.lesson_id) || 0));
      let candidates: CurationCandidate[] | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!await active()) break rounds;
        try {
          stats.searches++;
          candidates = await (params.search || searchLessonCandidates)({
            client: params.getClient(), model: attempt > 0 && params.fallbackModel ? params.fallbackModel : params.model,
            courseContext: [params.courseContext, "Busca fuentes públicas para el objetivo y los temas de esta lección. Complementa documentos propios cuando existan, sin desplazar su contenido."].filter(Boolean).join("\n\n"),
            lessons: [{ ...lesson, topics: [...new Set([lesson.lesson_objective, ...(lesson.topics || [])])],
              remaining_sources: remaining, excluded_urls: [...seen] }],
            customPrompt: params.customPrompt, systemPrompt: params.systemPrompt, reasoningEffort: params.reasoningEffort,
            round, artifactId: params.artifactId, organizationId: params.organizationId,
            supabase: params.supabase, deadlineMs: params.deadline,
          });
          failures.delete(lesson.lesson_id);
          break;
        } catch (error) {
          if (isPermanentProviderFailure(error) && (attempt > 0 || !params.fallbackModel || params.fallbackModel === params.model)) throw error;
          const reason = error instanceof SyntaxError ? "El proveedor devolvió una respuesta JSON inválida." : generationFailureMessage(error);
          failures.set(lesson.lesson_id, reason);
          logger.warn("busqueda_fallida", { lessonId: lesson.lesson_id, round, attempt: attempt + 1, reason });
          if (attempt < 2) {
            const delay = 2_000 * (attempt + 1);
            if (Date.now() + delay >= params.deadline) break rounds;
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      if (!candidates) continue;
      const selected = await validateAutomaticCandidates({
        candidates: candidates.filter(candidate => candidate.lesson_id === lesson.lesson_id),
        existingNormalizedUrls: seen, limit: remaining, shouldContinue: active,
        validate: async (url, options) => {
          const result = await (params.validate || validateUrlSource)(url, { ...options,
            timeoutMilliseconds: Math.max(1, Math.min(SOURCE_VALIDATION_TIMEOUT_MS, params.deadline - Date.now())) });
          return result;
        },
        onRejected: reason => { if (reason === "DUPLICATE") stats.duplicates++; else stats.rejected++; },
        onAccepted: async ({ candidate, validation }) => {
          if (!await params.save(lesson, candidate, validation)) { cancelled = true; return false; }
          counts.set(lesson.lesson_id, (counts.get(lesson.lesson_id) || 0) + 1);
          stats.accepted++;
          return true;
        },
      });
      logger.info("leccion_procesada", { lessonId: lesson.lesson_id, round, candidates: candidates.length, saved: selected.length,
        valid: counts.get(lesson.lesson_id) || 0, required: target(lesson) });
      if (cancelled) break rounds;
    }
    stalled = stats.accepted === before ? stalled + 1 : 0;
    if (stalled >= 2) break;
  }
  const reason = cancelled ? "CANCELLED" : !pending().length ? "COMPLETE" : Date.now() >= params.deadline ? "DEADLINE" : stalled >= 2 ? "STALLED" : "MAX_ROUNDS";
  const notes = reason === "DEADLINE" ? "La búsqueda alcanzó el tiempo disponible para esta ejecución."
    : reason === "STALLED" ? "Las últimas búsquedas no encontraron nuevas fuentes que superaran la validación."
      : reason === "MAX_ROUNDS" ? "La búsqueda alcanzó el máximo de rondas de esta ejecución." : "";
  const diagnostics = [...new Set(failures.values())].join(" ");
  logger.info("busqueda_finalizada", { reason, ...stats, failedLessons: failures.size, pendingLessons: pending().length });
  const summary = `Búsquedas: ${stats.searches}; fuentes nuevas confirmadas: ${stats.accepted}; candidatos rechazados: ${stats.rejected}; destinos duplicados: ${stats.duplicates}; lecciones con error de búsqueda: ${failures.size}.`;
  return { cancelled, inserted: stats.accepted, reason, notes: `${notes} ${summary} ${diagnostics}`.trim(), stats };
}
