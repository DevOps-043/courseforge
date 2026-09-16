import { GoogleGenAI } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { SYLLABUS_PROMPT } from "@/domains/syllabus/config/syllabus.config";
import {
  buildSyllabusResearchPrompt,
  buildSyllabusGenerationPrompt,
  calculateSyllabusEstimatedHours,
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
import { syllabusManagementRequestSchema } from "@/domains/syllabus/syllabus-management-request.schema";
import { runAllValidations } from "@/domains/syllabus/validators/syllabus.validators";
import { dispatchBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { resolvePromptWithMetadata } from "@/shared/config/prompts/prompt-resolver.service";
import { SYLLABUS_PROMPT_CODE } from "@/shared/config/prompts/pipeline.prompts";

const MAX_SYLLABUS_REQUEST_BYTES = 768 * 1024;
const MAX_SYLLABUS_MANAGEMENT_REQUEST_BYTES = 256 * 1024;

interface GroundingMetadata {
  webSearchQueries?: string[];
  groundingChunks?: unknown[];
}

async function authorizeSyllabusArtifact(artifactId: string) {
  const supabase = await createClient();
  const authenticatedUser = await getAuthenticatedUser(supabase);
  if (!authenticatedUser) {
    return {
      success: false as const,
      code: API_ERROR_CODE.authRequired,
      message: "No autorizado.",
      status: 401,
    };
  }

  const tenant = await resolveActiveTenantContext();
  if (!tenant) {
    return {
      success: false as const,
      code: API_ERROR_CODE.tenantForbidden,
      message: "Empresa no válida o no autorizada.",
      status: 403,
    };
  }

  const authorized = await getAuthorizedArtifactAdminForTenant(
    artifactId,
    tenant,
  );
  if (!authorized) {
    return {
      success: false as const,
      code: API_ERROR_CODE.resourceNotFound,
      message: "Artefacto no encontrado para esta empresa.",
      status: 404,
    };
  }

  return {
    success: true as const,
    admin: authorized.admin,
    tenant,
  };
}

function authorizationErrorResponse(
  authorization: Exclude<Awaited<ReturnType<typeof authorizeSyllabusArtifact>>, { success: true }>,
  requestId: string,
) {
  return apiErrorResponse({
    code: authorization.code,
    message: authorization.message,
    requestId,
    status: authorization.status,
  });
}

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const artifactId = new URL(request.url).searchParams.get("artifactId") || "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(artifactId)) {
    return apiErrorResponse({
      code: API_ERROR_CODE.invalidRequest,
      message: "Identificador de artefacto inválido.",
      requestId,
      status: 400,
    });
  }

  try {
    const authorization = await authorizeSyllabusArtifact(artifactId);
    if (!authorization.success) {
      return authorizationErrorResponse(authorization, requestId);
    }
    const { data, error } = await authorization.admin
      .from("syllabus")
      .select("*")
      .eq("artifact_id", artifactId)
      .maybeSingle();
    if (error) throw error;
    return apiSuccessResponse({ syllabus: data || null }, { requestId });
  } catch (error) {
    createOperationalLogger("syllabus.read", { correlationId: requestId })
      .error("syllabus.read_failed", error);
    return apiErrorResponse({
      code: API_ERROR_CODE.dependencyUnavailable,
      message: "No se pudo consultar temporalmente el temario. Intenta de nuevo.",
      requestId,
      retryable: true,
      status: 503,
    });
  }
}

export async function PATCH(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const parsedRequest = await parseJsonRequest(
    request,
    syllabusManagementRequestSchema,
    MAX_SYLLABUS_MANAGEMENT_REQUEST_BYTES,
  );
  if (!parsedRequest.success) {
    return apiErrorResponse({
      code: parsedRequest.reason === "too_large"
        ? API_ERROR_CODE.payloadTooLarge
        : API_ERROR_CODE.invalidRequest,
      message: "Solicitud de actualización de temario inválida.",
      requestId,
      status: parsedRequest.reason === "too_large" ? 413 : 400,
    });
  }

  try {
    const authorization = await authorizeSyllabusArtifact(parsedRequest.data.artifactId);
    if (!authorization.success) {
      return authorizationErrorResponse(authorization, requestId);
    }

    if (parsedRequest.data.action === "modules") {
      const { data, error } = await authorization.admin
        .from("syllabus")
        .update({
          modules: parsedRequest.data.modules,
          updated_at: new Date().toISOString(),
        })
        .eq("artifact_id", parsedRequest.data.artifactId)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return apiErrorResponse({
          code: API_ERROR_CODE.resourceNotFound,
          message: "Temario no encontrado.",
          requestId,
          status: 404,
        });
      }
    } else {
      const qa = parsedRequest.data.notes === undefined
        ? undefined
        : {
            status: parsedRequest.data.state === "STEP_APPROVED"
              ? "APPROVED"
              : parsedRequest.data.state === "STEP_REJECTED"
                ? "REJECTED"
                : "PENDING",
            notes: parsedRequest.data.notes,
            reviewed_at: new Date().toISOString(),
          };
      const payload = {
        state: parsedRequest.data.state,
        updated_at: new Date().toISOString(),
        ...(qa ? { qa } : {}),
      };
      const { error } = await authorization.admin.from("syllabus").upsert(
        {
          artifact_id: parsedRequest.data.artifactId,
          ...payload,
        },
        { onConflict: "artifact_id" },
      );
      if (error) throw error;
    }

    return apiSuccessResponse({ updated: true }, { requestId });
  } catch (error) {
    createOperationalLogger("syllabus.update", { correlationId: requestId })
      .error("syllabus.update_failed", error);
    return apiErrorResponse({
      code: API_ERROR_CODE.dependencyUnavailable,
      message: "No se pudo actualizar temporalmente el temario. Intenta de nuevo.",
      requestId,
      retryable: true,
      status: 503,
    });
  }
}

export async function DELETE(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const artifactId = new URL(request.url).searchParams.get("artifactId") || "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(artifactId)) {
    return apiErrorResponse({
      code: API_ERROR_CODE.invalidRequest,
      message: "Identificador de artefacto inválido.",
      requestId,
      status: 400,
    });
  }

  try {
    const authorization = await authorizeSyllabusArtifact(artifactId);
    if (!authorization.success) {
      return authorizationErrorResponse(authorization, requestId);
    }
    const { error } = await authorization.admin
      .from("syllabus")
      .update({
        modules: [],
        validation: { checks: [], automatic_pass: false },
        state: "STEP_DRAFT",
        qa: { status: "PENDING" },
        source_summary: null,
        iteration_count: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("artifact_id", artifactId);
    if (error) throw error;
    return apiSuccessResponse({ reset: true }, { requestId });
  } catch (error) {
    createOperationalLogger("syllabus.reset", { correlationId: requestId })
      .error("syllabus.reset_failed", error);
    return apiErrorResponse({
      code: API_ERROR_CODE.dependencyUnavailable,
      message: "No se pudo reiniciar temporalmente el temario. Intenta de nuevo.",
      requestId,
      retryable: true,
      status: 503,
    });
  }
}

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("syllabus.api", { correlationId: requestId });
  let reservationAdmin: SupabaseClient | null = null;
  let reservationCreated = false;
  let reservationArtifactId = "";
  let previousIteration = 0;
  let previousState = "STEP_DRAFT";
  let reservedIteration: number | undefined;
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
      promptOverride,
      sourceDocuments = [],
    } = parsedRequest.data;
    reservationArtifactId = artifactId;
    const authorization = await authorizeSyllabusArtifact(artifactId);
    if (!authorization.success) {
      return authorizationErrorResponse(authorization, requestId);
    }
    const { admin, tenant } = authorization;
    reservationAdmin = admin;

    const { data: currentSyllabus, error: syllabusLookupError } =
      await admin
        .from("syllabus")
        .select("iteration_count, state")
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
    previousIteration = currentSyllabus?.iteration_count || 0;
    previousState = currentSyllabus?.state || "STEP_DRAFT";
    const creatingReservation = !currentSyllabus;
    const reservation = currentSyllabus
      ? await admin
          .from("syllabus")
          .update({
            iteration_count: reservedIteration,
            state: "STEP_GENERATING",
            updated_at: new Date().toISOString(),
          })
          .eq("artifact_id", artifactId)
          .eq("iteration_count", currentSyllabus.iteration_count)
          .select("id")
          .maybeSingle()
      : await admin
          .from("syllabus")
          .insert({
            artifact_id: artifactId,
            route,
            iteration_count: reservedIteration,
            state: "STEP_GENERATING",
          })
          .select("id")
          .maybeSingle();
    const { data: reservedSyllabus, error: reservationError } = reservation;

    if (reservationError) {
      if (reservationError.code === "23505") {
        return apiErrorResponse({
          code: API_ERROR_CODE.conflict,
          message: "Otra iteración del temario fue iniciada al mismo tiempo. Actualiza la página antes de reintentar.",
          requestId,
          status: 409,
        });
      }
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
    reservationCreated = creatingReservation;

    const { data: artifactDurationSource } = await admin
      .from("artifacts")
      .select("generation_metadata")
      .eq("id", artifactId)
      .maybeSingle();
    const artifactGenerationMetadata = artifactDurationSource?.generation_metadata;

    if (isNetlifyDeployment()) {
      await dispatchBackgroundFunctionJson(
        "syllabus-generation-background",
        {
          artifactId,
          objetivos,
          ideaCentral,
          route,
          iterationInstructions,
          promptOverride,
          iterationNumber: reservedIteration,
          sourceDocuments,
        },
        {
          fallbackError: "No se pudo iniciar la generación del temario.",
        },
      );

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
    const resolvedPrompt = await resolvePromptWithMetadata(
      admin,
      SYLLABUS_PROMPT_CODE,
      SYLLABUS_PROMPT,
      tenant.organizationId,
    );
    const promptTemplate = promptOverride?.trim() || resolvedPrompt.content;
    const finalPrompt = buildSyllabusGenerationPrompt({
      promptTemplate,
      ideaCentral,
      objetivos,
      route,
      researchContext,
      sourceDocuments,
    }) + (iterationInstructions?.trim()
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
      files: sourceDocuments.map((document) => ({
        character_count: document.characterCount,
        file_id: document.fileId,
        filename: document.filename,
        mime: document.mimeType,
        size_bytes: document.sizeBytes,
      })),
      source_documents: sourceDocuments,
      prompt_override_applied: Boolean(promptOverride?.trim()),
      prompt_source: promptOverride?.trim() ? "override" : resolvedPrompt.source,
      prompt_version: promptOverride?.trim() ? "ad-hoc" : resolvedPrompt.version,
    };

    content.generation_metadata = metadata;
    const validation = runAllValidations(content.modules, objetivos);
    const completedSyllabus = {
      ...content,
      iteration_count: reservedIteration,
      qa: { status: "PENDING" as const },
      route,
      source_summary: metadata,
      state: "STEP_READY_FOR_QA" as const,
      validation: {
        automatic_pass: validation.passed,
        checks: validation.checks,
      },
    };

    const { error: saveError } = await admin.from("syllabus").upsert(
      {
        artifact_id: artifactId,
        route,
        modules: content.modules,
        source_summary: metadata,
        validation: completedSyllabus.validation,
        qa: completedSyllabus.qa,
        state: completedSyllabus.state,
        iteration_count: reservedIteration,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "artifact_id" },
    );
    if (saveError) throw saveError;

    logger.info("syllabus.generation_completed", {
      artifactId,
      modulesCount: content.modules.length,
    });

    return apiSuccessResponse(completedSyllabus, { requestId });
  } catch (error) {
    if (reservationAdmin && reservedIteration !== undefined) {
      try {
        if (reservationCreated) {
          await reservationAdmin
            .from("syllabus")
            .delete()
            .eq("artifact_id", reservationArtifactId)
            .eq("iteration_count", reservedIteration);
        } else {
          await reservationAdmin
            .from("syllabus")
            .update({
              iteration_count: previousIteration,
              state: previousState,
              updated_at: new Date().toISOString(),
            })
            .eq("artifact_id", reservationArtifactId)
            .eq("iteration_count", reservedIteration);
        }
      } catch (rollbackError) {
        logger.warn("syllabus.reservation_rollback_failed", {
          artifactId: reservationArtifactId,
          error: rollbackError,
        });
      }
    }
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
