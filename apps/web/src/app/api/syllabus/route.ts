import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { SYLLABUS_PROMPT } from "@/domains/syllabus/config/syllabus.config";
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
  getOptionalOpenAIApiKey,
  isNetlifyDeployment,
} from "@/lib/server/env";
import { getPipelineModelSettings } from "@/lib/server/model-settings";
import { createClient } from "@/utils/supabase/server";
import {
  getAuthenticatedUser,
  getAuthorizedArtifactAdminForTenant,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { applyGeneratedLessonDurationEstimates } from "@/domains/syllabus/lib/lesson-duration-estimator";
import { resolveArtifactVideoDurationPolicy } from "@/domains/video-duration/video-duration-policy";
import {
  canIterateSyllabus,
  getNextSyllabusIteration,
  SYLLABUS_MAX_ITERATIONS,
} from "@/domains/syllabus/lib/syllabus-iteration";
import {
  generateSyllabusJson,
  generateSyllabusResearch,
  type SyllabusModelClients,
} from "@/domains/syllabus/lib/syllabus-model-provider";
import { getTextModelProvider } from "@/shared/ai/text-model-provider";

interface SyllabusRequestBody {
  objetivos?: string[];
  ideaCentral?: string;
  route?: string;
  artifactId?: string;
  accessToken?: string;
  iterationInstructions?: string;
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
    const {
      objetivos,
      ideaCentral,
      route,
      artifactId,
      accessToken,
      iterationInstructions,
    } = body;
    let artifactGenerationMetadata: unknown;
    let reservedIteration: number | undefined;

    if (!Array.isArray(objetivos) || !ideaCentral) {
      return NextResponse.json(
        { error: "objetivos e ideaCentral son requeridos" },
        { status: 400 },
      );
    }

    if (artifactId) {
      const supabase = await createClient();
      const authenticatedUser = await getAuthenticatedUser(supabase);
      if (!authenticatedUser) {
        return NextResponse.json({ error: "No autorizado." }, { status: 401 });
      }

      const tenant = await resolveActiveTenantContext();
      if (!tenant) {
        return NextResponse.json(
          { error: "Empresa no valida o no autorizada." },
          { status: 403 },
        );
      }

      const authorized = await getAuthorizedArtifactAdminForTenant(
        artifactId,
        tenant,
      );
      if (!authorized) {
        return NextResponse.json(
          { error: "Artefacto no encontrado para esta empresa." },
          { status: 404 },
        );
      }

      const { data: currentSyllabus, error: syllabusLookupError } =
        await authorized.admin
          .from("syllabus")
          .select("iteration_count")
          .eq("artifact_id", artifactId)
          .maybeSingle();

      if (syllabusLookupError) {
        throw syllabusLookupError;
      }

      if (!canIterateSyllabus(currentSyllabus?.iteration_count)) {
        return NextResponse.json(
          {
            error: `El temario alcanzo el limite de ${SYLLABUS_MAX_ITERATIONS} iteraciones.`,
          },
          { status: 409 },
        );
      }

      reservedIteration = getNextSyllabusIteration(
        currentSyllabus?.iteration_count,
      );
      const { data: reservedSyllabus, error: reservationError } =
        await authorized.admin
          .from("syllabus")
          .update({
            iteration_count: reservedIteration,
            state: "STEP_GENERATING",
            updated_at: new Date().toISOString(),
          })
          .eq("artifact_id", artifactId)
          .eq("iteration_count", currentSyllabus?.iteration_count || 0)
          .select("id")
          .maybeSingle();

      if (reservationError) {
        throw reservationError;
      }

      if (!reservedSyllabus) {
        return NextResponse.json(
          {
            error:
              "Otra iteracion del temario fue iniciada al mismo tiempo. Actualiza la pagina antes de reintentar.",
          },
          { status: 409 },
        );
      }

      const { data: artifactDurationSource } = await authorized.admin
        .from("artifacts")
        .select("generation_metadata")
        .eq("id", artifactId)
        .maybeSingle();
      artifactGenerationMetadata = artifactDurationSource?.generation_metadata;
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
            iterationInstructions,
            iterationNumber: reservedIteration,
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

    const tenant = await resolveActiveTenantContext();
    const syllabusSettings = await getPipelineModelSettings(
      "SYLLABUS",
      tenant?.organizationId,
    );
    const searchModelName = syllabusSettings.fallback_model || syllabusSettings.model_name;
    const configuredModels = Array.from(
      new Set([syllabusSettings.model_name, searchModelName].filter(Boolean)),
    );
    const clients: SyllabusModelClients = {};
    if (configuredModels.some((model) => getTextModelProvider(model) === "gemini")) {
      clients.gemini = new GoogleGenAI({ apiKey: getGeminiApiKey() });
    }
    if (configuredModels.some((model) => getTextModelProvider(model) === "openai")) {
      const openAiApiKey = getOptionalOpenAIApiKey();
      if (!openAiApiKey) {
        throw new Error(
          "Configuracion incompleta: falta OPENAI_API_KEY para el modelo del temario.",
        );
      }
      clients.openai = new OpenAI({ apiKey: openAiApiKey });
    }
    const researchPrompt = buildSyllabusResearchPrompt(ideaCentral, objetivos);

    let researchContext = "";
    let researchMetadata: GroundingMetadata | null = null;

    try {
      const researchResult = await generateSyllabusResearch({
        clients,
        model: searchModelName,
        prompt: researchPrompt,
        temperature: 0.7,
      });

      researchContext = researchResult.text;
      researchMetadata =
        (researchResult.groundingMetadata as GroundingMetadata | undefined) || null;

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

    const mainModelName = syllabusSettings.model_name;
    const finalPrompt = buildLocalPrompt(
      ideaCentral,
      objetivos,
      route,
      researchContext,
    ) + (iterationInstructions?.trim()
      ? `\n\nRETROALIMENTACION PARA ESTA ITERACION:\n${iterationInstructions.trim()}\nRegenera el temario completo aplicando esta retroalimentacion.`
      : "");

    const generationText = await generateSyllabusJson({
      clients,
      model: mainModelName,
      prompt: finalPrompt,
      temperature: syllabusSettings.temperature,
    });

    const content = parseSyllabusResponseText(generationText);
    const videoDurationPolicy = resolveArtifactVideoDurationPolicy(
      artifactGenerationMetadata,
    );
    content.modules = applyGeneratedLessonDurationEstimates(
      content.modules,
      videoDurationPolicy,
    );
    content.total_estimated_hours = calculateSyllabusEstimatedHours(
      content.modules,
      videoDurationPolicy,
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
