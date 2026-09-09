import type OpenAI from "openai";
import { CURATION_SEARCH_RESPONSE_SCHEMA } from "./structured-output.schemas";
import type { CurationCandidate, CurationLesson } from "./types";

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
}) {
  const { client, model, courseContext, lessons, customPrompt, systemPrompt } =
    params;
  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          systemPrompt ||
          "Eres un investigador educativo. Busca candidatos reales y accesibles. No declares una fuente valida: Courseforge la validara. Evita redes sociales, foros, paywalls y URLs inventadas.",
      },
      {
        role: "user",
        content: [
          courseContext,
          customPrompt ? `Instrucciones adicionales: ${customPrompt}` : "",
          "Genera consultas especificas y encuentra hasta 5 candidatos por leccion. Prioriza documentacion oficial, universidades y publicaciones educativas abiertas.",
          JSON.stringify(lessons),
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    max_output_tokens: 6000,
    tools: [{ type: "web_search" }],
    tool_choice: "required",
    text: {
      format: {
        type: "json_schema",
        name: "courseforge_curation_v2_candidates",
        strict: true,
        schema: CURATION_SEARCH_RESPONSE_SCHEMA,
      },
    },
  } as unknown as Parameters<typeof client.responses.create>[0]);

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
