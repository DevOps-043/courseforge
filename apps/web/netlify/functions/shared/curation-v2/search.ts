import type OpenAI from "openai";
import { createCurationSearchResponseSchema } from "./structured-output.schemas";
import type { CurationCandidate, CurationLesson } from "./types";
import { PIPELINE_GENERATION_LIMITS } from "../../../../src/lib/pipeline-generation-policy";

function responseText(response: unknown) {
  const value = response as { output_text?: unknown };
  return typeof value?.output_text === "string" ? value.output_text : "";
}

export async function searchLessonCandidates(params: {
  client: OpenAI;
  model: string;
  courseContext: string;
  lessons: CurationLesson[];
  customPrompt?: string;
  systemPrompt?: string;
  reasoningEffort?: string;
  round?: number;
}) {
  const {
    client,
    model,
    courseContext,
    lessons,
    customPrompt,
    systemPrompt,
    reasoningEffort = "low",
    round = 1,
  } = params;
  const maxCandidatesPerLesson = Math.min(
    16,
    Math.max(
      5,
      ...lessons.map(
        (lesson) => (lesson.required_sources || 2) + 2 + round * 2,
      ),
    ),
  );
  const isReasoningModel = model.toLowerCase().startsWith("gpt-5");
  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content: `${
          systemPrompt ||
          "Eres un investigador educativo. Busca candidatos reales y accesibles. No declares una fuente valida: Courseforge la validara. Evita redes sociales, foros, paywalls y URLs inventadas."
        }\n\nRegla operativa obligatoria: la curaduria automatica solo puede usar paginas web HTML publicas. Nunca propongas enlaces directos a PDF ni otros archivos descargables.`,
      },
      {
        role: "user",
        content: [
          courseContext,
          customPrompt ? `Instrucciones adicionales: ${customPrompt}` : "",
          `Ronda autonoma ${round}. Cada leccion indica required_sources, video_target_seconds y excluded_urls. Encuentra suficientes fuentes distintas y complementarias para cubrir el objetivo completo de la leccion despues de la validacion. No devuelvas ninguna URL incluida en excluded_urls. Devuelve hasta ${maxCandidatesPerLesson} candidatos por leccion para compensar URLs que puedan fallar. Usa exclusivamente paginas web HTML publicas y accesibles: no devuelvas enlaces directos a PDF, archivos descargables, redes sociales, foros ni contenido con paywall. Prioriza documentacion oficial, universidades y publicaciones educativas abiertas.`,
          JSON.stringify(lessons),
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    max_output_tokens: 6000,
    ...(isReasoningModel ? { reasoning: { effort: reasoningEffort } } : {}),
    include: ["web_search_call.action.sources"],
    tools: [
      {
        type: "web_search",
        external_web_access: true,
        search_context_size: round >= 2 ? "high" : "medium",
        return_token_budget:
          round >= 3 && isReasoningModel ? "unlimited" : "default",
      },
    ],
    tool_choice: "required",
    text: {
      format: {
        type: "json_schema",
        name: "courseforge_curation_v2_candidates",
        strict: true,
        schema: createCurationSearchResponseSchema(maxCandidatesPerLesson),
      },
    },
  } as unknown as Parameters<typeof client.responses.create>[0], {
    timeout: PIPELINE_GENERATION_LIMITS.requestTimeoutMs,
    maxRetries: 0,
    signal: AbortSignal.timeout(PIPELINE_GENERATION_LIMITS.requestTimeoutMs),
  });

  const parsed = JSON.parse(responseText(response)) as {
    lessons?: Array<{
      lesson_id?: string;
      sources?: Array<Omit<CurationCandidate, "lesson_id">>;
    }>;
  };

  return (parsed.lessons || []).flatMap((lesson) =>
    (lesson.sources || []).map((source) => ({
      ...source,
      lesson_id: lesson.lesson_id || "",
    })),
  );
}
