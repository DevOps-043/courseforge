import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { SYLLABUS_PROMPT } from "@/domains/syllabus/config/syllabus.config";
import {
  buildSyllabusResearchPrompt,
  calculateSyllabusEstimatedHours,
  getSyllabusRouteContext,
  parseSyllabusResponseText,
} from "@/domains/syllabus/lib/syllabus-generation";
import { SyllabusGenerationMetadata } from "@/domains/syllabus/types/syllabus.types";
import {
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
import { syllabusGenerationRequestSchema } from "@/domains/syllabus/syllabus-generation-request.schema";
import { dispatchBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_SYLLABUS_REQUEST_BYTES = 64 * 1024;

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

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("syllabus.api", { correlationId: requestId });
  try {
    const parsedRequest = await parseJsonRequest(
      request,
      syllabusGenerationRequestSchema,
      MAX_SYLLABUS_REQUEST_BYTES,
    );
    if (!parsedRequest.success) {
      return apiErrorResponse({
        code: parsedRequest.reason === "too_large"
          ? API_ERROR_CODE.payloadTooLarge
          : API_ERROR_CODE.invalidRequest,
        message: parsedRequest.reason === "too_large"
          ? "La solicitud de temario excede el tamaño permitido."
          : "Solicitud de generación de temario inválida.",
        requestId,
        status: parsedRequest.reason === "too_large" ? 413 : 400,
      });
    }

    const {
      objetivos,
      ideaCentral,
      route,
      artifactId,
      iterationInstructions,
    } = parsedRequest.data;
    let artifactGenerationMetadata: unknown;
    let reservedIteration: number | undefined;

    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return apiErrorResponse({
        code: API_ERROR_CODE.authRequired,
        message: "No autorizado.",
        requestId,
        status: 401,
      });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return apiErrorResponse({
        code: API_ERROR_CODE.tenantForbidden,
        message: "Empresa no válida o no autorizada.",
        requestId,
        status: 403,
      });
    }

    const authorized = await getAuthorizedArtifactAdminForTenant(
      artifactId,
      tenant,
    );
    if (!authorized) {
      return apiErrorResponse({
        code: API_ERROR_CODE.resourceNotFound,
        message: "Artefacto no encontrado para esta empresa.",
        requestId,
        status: 404,
      });
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
      return apiErrorResponse({
        code: API_ERROR_CODE.conflict,
        message: `El temario alcanzó el límite de ${SYLLABUS_MAX_ITERATIONS} iteraciones.`,
        requestId,
        status: 409,
      });
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
      return apiErrorResponse({
        code: API_ERROR_CODE.conflict,
        message: "Otra iteración del temario fue iniciada al mismo tiempo. Actualiza la página antes de reintentar.",
        requestId,
        status: 409,
      });
    }

    const { data: artifactDurationSource } = await authorized.admin
      .from("artifacts")
      .select("generation_metadata")
      .eq("id", artifactId)
      .maybeSingle();
    artifactGenerationMetadata = artifactDurationSource?.generation_metadata;

    if (isNetlifyDeployment()) {
      try {
        await dispatchBackgroundFunctionJson(
          "syllabus-generation-background",
          {
            artifactId,
            objetivos,
            ideaCentral,
            route,
            iterationInstructions,
            iterationNumber: reservedIteration,
          },
          {
            fallbackError: "No se pudo iniciar la generación del temario.",
          },
        );
      } catch (backgroundError) {
        await authorized.admin
          .from("syllabus")
          .update({
            state: "STEP_ESCALATED",
            updated_at: new Date().toISOString(),
          })
          .eq("artifact_id", artifactId)
          .eq("iteration_count", reservedIteration);
        throw backgroundError;
      }

      logger.info("syllabus.background_dispatched", {
        artifactId,
        iterationNumber: reservedIteration,
      });
      return apiSuccessResponse({
        status: "processing",
        message: "Generación de temario iniciada en background",
        artifactId,
      }, { requestId });
    }

    const syllabusSettings = await getPipelineModelSettings(
      "SYLLABUS",
      tenant.organizationId,
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

      logger.info("syllabus.research_completed", {
        artifactId,
        resultCharacters: researchContext.length,
      });
    } catch (researchError) {
      logger.warn("syllabus.research_failed", {
        artifactId,
        error: researchError,
      });
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

    logger.info("syllabus.generation_completed", {
      artifactId,
      modulesCount: content.modules.length,
    });

    return apiSuccessResponse(content, { requestId });
  } catch (error) {
    logger.error("syllabus.generation_failed", error);
    return apiErrorResponse({
      code: API_ERROR_CODE.internalError,
      message: "No se pudo generar el temario.",
      requestId,
      retryable: true,
      status: 500,
    });
  }
}
