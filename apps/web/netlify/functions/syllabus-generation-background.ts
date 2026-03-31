import { Handler } from "@netlify/functions";
import {
  createGeminiClient,
  createServiceRoleClient,
  resolveModelSetting,
} from "./shared/bootstrap";
import { getErrorMessage } from "./shared/errors";
import { methodNotAllowedResponse, parseJsonBody } from "./shared/http";
import {
  COURSE_CONFIG,
  SYLLABUS_PROMPT,
} from "../../src/domains/syllabus/config/syllabus.config";
import {
  buildSyllabusResearchPrompt,
  calculateSyllabusEstimatedHours,
  getSyllabusRouteContext,
  parseSyllabusResponseText,
  SyllabusGenerationContent,
} from "../../src/domains/syllabus/lib/syllabus-generation";
import { SyllabusGenerationMetadata } from "../../src/domains/syllabus/types/syllabus.types";

interface SyllabusBackgroundRequest {
  accessToken?: string;
  artifactId?: string;
  ideaCentral?: string;
  objetivos?: string[];
  route?: string;
}

interface GroundingMetadata {
  webSearchQueries?: string[];
  groundingChunks?: unknown[];
}

function buildCorrectionRules(objectiveCount: number) {
  return `
        REGLAS DE ORO (CRÍTICAS):
        1. Cantidad de Módulos: Debes generar EXACTAMENTE ${objectiveCount} módulos. Un módulo por cada objetivo principal, en el mismo orden.
        2. Cantidad de Lecciones: Cada módulo debe tener ENTRE 3 y 6 lecciones. Ni menos de 3, ni más de 6.
        3. Verbos Bloom: Cada 'objective_specific' de las lecciones DEBE iniciar con un verbo de acción (Bloom) en infinitivo o tercera persona (ej: Analizar, Evalúa, Diseñar).
        4. No Duplicados: No repitas títulos de lecciones ni objetivos.
        `;
}

function buildSyllabusPrompt(
  ideaCentral: string,
  objetivos: string[],
  route: string | undefined,
  researchContext: string,
) {
  const contextWithResearch = `${getSyllabusRouteContext(route)}\n\n### INVESTIGACIÓN RECIENTE:\n${researchContext}\n\n${buildCorrectionRules(objetivos.length)}`;
  const objetivosFormatted = objetivos
    .map((objetivo, index) => `${index + 1}. ${objetivo}`)
    .join("\n");

  return SYLLABUS_PROMPT.replace("{{ideaCentral}}", ideaCentral)
    .replace("{{objetivos}}", objetivosFormatted)
    .replace("{{routeContext}}", contextWithResearch)
    .replace(/{{.*?}}/g, "");
}

function appendValidationFeedback(prompt: string, validationErrors: string[]) {
  if (!validationErrors.length) {
    return prompt;
  }

  return `${prompt}\n\nREPORTE DE ERRORES DEL INTENTO ANTERIOR (CORRIGE ESTO):
${validationErrors.join("\n")}

Asegúrate de cumplir TODAS las REGLAS DE ORO. Genera el JSON corregido completo.`;
}

function validateGeneratedContent(
  content: SyllabusGenerationContent,
  objectiveCount: number,
) {
  const validationErrors: string[] = [];

  if (content.modules.length !== objectiveCount) {
    validationErrors.push(
      `Error: Se generaron ${content.modules.length} módulos, pero se esperaban exactamente ${objectiveCount} (uno por objetivo).`,
    );
  }

  content.modules.forEach((module, index) => {
    if (module.lessons.length < 3 || module.lessons.length > 6) {
      validationErrors.push(
        `Error en Módulo ${index + 1}: Tiene ${module.lessons.length} lecciones. Debe tener entre 3 y 6.`,
      );
    }
  });

  return validationErrors;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return methodNotAllowedResponse();
  }

  let body: SyllabusBackgroundRequest;
  try {
    body = parseJsonBody<SyllabusBackgroundRequest>(event);
  } catch {
    return { statusCode: 400, body: "Bad Request: Invalid JSON" };
  }

  const { artifactId, objetivos, ideaCentral, route } = body;

  if (!artifactId || !Array.isArray(objetivos) || !ideaCentral) {
    return { statusCode: 400, body: "Missing required fields" };
  }

  console.log(
    `[Syllabus Background] Iniciando generación para artifact: ${artifactId}`,
  );

  const supabase = createServiceRoleClient();
  const genAI = createGeminiClient();

  try {
    const modelConfig = await resolveModelSetting(supabase, "SYLLABUS", {
      model: "gemini-2.5-flash",
      fallbackModel: "gemini-2.0-flash",
      temperature: 0.7,
      thinkingLevel: "medium",
    });
    console.log(`[Syllabus Background] Model config: ${modelConfig.model} / ${modelConfig.fallbackModel}`);

    const searchModelName = modelConfig.model;
    let researchContext = "";
    let searchQueries: string[] = [];

    try {
      const searchResult = await genAI.models.generateContent({
        model: searchModelName,
        contents: buildSyllabusResearchPrompt(ideaCentral, objetivos),
        config: {
          tools: [{ googleSearch: {} }],
          temperature: 0.7,
        },
      });

      researchContext = searchResult.text || "";
      const grounding =
        (searchResult.candidates?.[0]?.groundingMetadata as GroundingMetadata | undefined) ||
        null;

      searchQueries = grounding?.webSearchQueries || [];

      console.log("[Syllabus Background] Investigación completada.");
      console.log(
        `[Syllabus Background] Búsquedas ejecutadas: ${searchQueries.length}`,
        searchQueries,
      );
      console.log(
        `[Syllabus Background] URLs de grounding: ${grounding?.groundingChunks?.length || 0}`,
      );
    } catch (researchError) {
      const message = getErrorMessage(researchError, "Error desconocido");
      console.warn(
        `[Syllabus Background] Falló research con ${searchModelName}:`,
        message,
      );
      researchContext =
        "Investigación no disponible por error técnico. Usar conocimiento base.";
    }

    const mainModelName = modelConfig.model;
    const basePrompt = buildSyllabusPrompt(
      ideaCentral,
      objetivos,
      route,
      researchContext,
    );

    let attempts = 0;
    const maxAttempts = 3;
    let content: SyllabusGenerationContent | null = null;
    let validationErrors: string[] = [];

    while (attempts < maxAttempts) {
      attempts += 1;
      console.log(`[Syllabus Background] Intento de generación #${attempts}...`);

      try {
        const result = await genAI.models.generateContent({
          model: mainModelName,
          contents: appendValidationFeedback(basePrompt, validationErrors),
          config: {
            temperature: modelConfig.temperature,
            responseMimeType: "application/json",
          },
        });

        content = parseSyllabusResponseText(result.text || "");
        validationErrors = validateGeneratedContent(content, objetivos.length);

        if (!validationErrors.length) {
          console.log(
            `[Syllabus Background] Validación interna pasada en intento ${attempts}.`,
          );
          break;
        }

        console.warn(
          `[Syllabus Background] Validación fallida en intento ${attempts}:`,
          validationErrors,
        );
      } catch (generationError) {
        const message = getErrorMessage(generationError, "Error desconocido");
        console.error(
          `[Syllabus Background] Error parseando/generando en intento ${attempts}:`,
          message,
        );
        validationErrors = [
          "El formato JSON generado no era válido o hubo un error de red.",
        ];
      }
    }

    if (!content) {
      throw new Error(
        "No se pudo generar un JSON válido después de varios intentos.",
      );
    }

    content.total_estimated_hours = calculateSyllabusEstimatedHours(
      content.modules,
      COURSE_CONFIG.avgLessonMinutes,
    );

    const metadata: SyllabusGenerationMetadata = {
      research_summary: researchContext,
      search_queries: searchQueries,
      models: {
        search: searchModelName,
        architect: mainModelName,
      },
      generated_at: new Date().toISOString(),
      validation_attempts: attempts,
      final_validation_errors: validationErrors,
    };

    content.generation_metadata = metadata;

    const { error: syllabusError } = await supabase.from("syllabus").upsert(
      {
        artifact_id: artifactId,
        modules: content.modules,
        source_summary: metadata,
        state: "STEP_REVIEW",
        iteration_count: 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "artifact_id" },
    );

    if (syllabusError) {
      throw syllabusError;
    }

    console.log("[Syllabus Background] Proceso completado exitosamente.");
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        modulesCount: content.modules.length,
      }),
    };
  } catch (error) {
    const message = getErrorMessage(error, "Error fatal desconocido");

    console.error("[Syllabus Background] Error fatal:", message);

    await supabase.from("syllabus").upsert(
      {
        artifact_id: artifactId,
        state: "STEP_ESCALATED",
        source_summary: { error: message },
      },
      { onConflict: "artifact_id" },
    );

    return {
      statusCode: 500,
      body: JSON.stringify({ error: message }),
    };
  }
};
