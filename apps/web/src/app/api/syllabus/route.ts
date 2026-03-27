import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import {
  COURSE_CONFIG,
  SYLLABUS_PROMPT,
} from "@/domains/syllabus/config/syllabus.config";
import { getErrorMessage } from "@/lib/errors";
import {
  buildSyllabusResearchPrompt,
  calculateSyllabusEstimatedHours,
  getSyllabusRouteContext,
  parseSyllabusResponseText,
} from "@/domains/syllabus/lib/syllabus-generation";
import { SyllabusGenerationMetadata } from "@/domains/syllabus/types/syllabus.types";
import {
  getDeploymentSiteUrl,
  getGeminiApiKey,
  getGeminiModel,
  getGeminiSearchModel,
  getGeminiTemperature,
  isNetlifyDeployment,
} from "@/lib/server/env";

interface SyllabusRequestBody {
  objetivos?: string[];
  ideaCentral?: string;
  route?: string;
  artifactId?: string;
  accessToken?: string;
}

interface GroundingMetadata {
  webSearchQueries?: string[];
  groundingChunks?: unknown[];
}

function buildLocalPrompt(
  ideaCentral: string,
  objetivos: string[],
  route?: string,
  researchContext = "",
) {
  const enrichedContext = `${getSyllabusRouteContext(route)}\n\n### INVESTIGACIÓN RECIENTE (Usar como base de conocimiento):\n${researchContext}`;
  const objetivosFormatted = objetivos
    .map((objetivo, index) => `${index + 1}. ${objetivo}`)
    .join("\n");

  return SYLLABUS_PROMPT.replace("{{ideaCentral}}", ideaCentral)
    .replace("{{objetivos}}", objetivosFormatted)
    .replace("{{routeContext}}", enrichedContext)
    .replace(/{{.*?}}/g, "");
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SyllabusRequestBody;
    const { objetivos, ideaCentral, route, artifactId, accessToken } = body;

    if (!Array.isArray(objetivos) || !ideaCentral) {
      return NextResponse.json(
        { error: "objetivos e ideaCentral son requeridos" },
        { status: 400 },
      );
    }

    if (isNetlifyDeployment()) {
      const siteUrl = getDeploymentSiteUrl();
      const backgroundUrl = `${siteUrl}/.netlify/functions/syllabus-generation-background`;

      console.log(
        `[API/ESP-02] Modo Netlify detectado. Disparando background a: ${backgroundUrl}`,
      );

      try {
        await fetch(backgroundUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artifactId,
            objetivos,
            ideaCentral,
            route,
            accessToken,
          }),
        });
      } catch (backgroundError) {
        console.error(
          "[API/ESP-02] Falló el fetch a syllabus-generation-background:",
          backgroundError,
        );
      }

      return NextResponse.json({
        status: "processing",
        message: "Generación de temario iniciada en background",
        artifactId,
      });
    }

    const genAI = new GoogleGenAI({ apiKey: getGeminiApiKey() });
    const searchModelName = getGeminiSearchModel();
    const researchPrompt = buildSyllabusResearchPrompt(ideaCentral, objetivos);

    let researchContext = "";
    let researchMetadata: GroundingMetadata | null = null;

    try {
      const researchResult = await genAI.models.generateContent({
        model: searchModelName,
        contents: researchPrompt,
        config: {
          tools: [{ googleSearch: {} }],
          temperature: 0.7,
        },
      });

      researchContext = researchResult.text || "";
      researchMetadata =
        (researchResult.candidates?.[0]?.groundingMetadata as GroundingMetadata | undefined) ||
        null;

      console.log(
        `[API/ESP-02] Investigación completada (${researchContext.length} chars).`,
      );
    } catch (researchError) {
      console.warn(
        "[API/ESP-02] Falló la investigación con grounding, continuando con conocimiento base.",
        researchError,
      );
      researchContext = "No se pudo realizar investigación previa.";
    }

    const mainModelName = getGeminiModel();
    const finalPrompt = buildLocalPrompt(
      ideaCentral,
      objetivos,
      route,
      researchContext,
    );

    const generationResult = await genAI.models.generateContent({
      model: mainModelName,
      contents: finalPrompt,
      config: {
        temperature: getGeminiTemperature(),
        responseMimeType: "application/json",
      },
    });

    const content = parseSyllabusResponseText(generationResult.text || "");
    content.total_estimated_hours = calculateSyllabusEstimatedHours(
      content.modules,
      COURSE_CONFIG.avgLessonMinutes,
    );

    const metadata: SyllabusGenerationMetadata = {
      ...content.generation_metadata,
      research_summary: researchContext,
      search_queries: researchMetadata?.webSearchQueries || [],
      search_sources: researchMetadata,
      models_used: {
        search: searchModelName,
        architect: mainModelName,
      },
    };

    content.generation_metadata = metadata;

    console.log(
      "[API/ESP-02] Generado exitosamente:",
      content.modules.length,
      "módulos",
    );

    return NextResponse.json(content);
  } catch (error) {
    const message = getErrorMessage(
      error,
      "Error desconocido al generar el syllabus.",
    );

    console.error("[API/ESP-02] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
