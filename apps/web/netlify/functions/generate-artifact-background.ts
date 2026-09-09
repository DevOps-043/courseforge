import { Handler } from "@netlify/functions";
import { generateObject } from "ai";
import {
  ArtifactBaseGenerationSchema,
  type GeneratedArtifactBase,
} from "../../src/domains/artifacts/lib/artifact-base-generation.schema";
import {
  createGeminiClient,
  createServiceRoleClient,
  resolveAiModel,
  resolveModelSetting,
} from "./shared/bootstrap";
import { getErrorMessage } from "./shared/errors";
import {
  methodNotAllowedResponse,
  parseVerifiedBackgroundBody,
  unauthorizedBackgroundResponse,
} from "./shared/http";
import { getCloudStorageService } from "../../src/domains/production/cloud-storage/cloud-storage.service";
import {
  isCloudStorageProvider,
  type CloudStorageProvider,
} from "../../src/domains/production/cloud-storage/types";
import { resolvePromptWithFallback } from "../../src/shared/config/prompts/prompt-resolver.service";
import {
  ARTIFACT_BASE_PROMPT_CODE,
  ARTIFACT_BASE_RESEARCH_PROMPT_CODE,
  renderPromptTemplate,
} from "../../src/shared/config/prompts/pipeline.prompts";

const BLOOM_VERBS = [
  "comprender",
  "aplicar",
  "analizar",
  "evaluar",
  "crear",
  "desarrollar",
  "identificar",
  "describir",
  "diseñar",
  "implementar",
  "demostrar",
  "explicar",
];

const genAI = createGeminiClient();

interface GenerateArtifactFormData {
  description?: string;
  title?: string;
}

interface GenerateArtifactRequestBody {
  artifactId?: string;
  feedback?: string;
  formData?: GenerateArtifactFormData;
  userId?: string;
  cloudStorageProvider?: CloudStorageProvider | null;
  organizationId?: string | null;
  useGoogleDrive?: boolean;
}

interface ResearchCandidate {
  groundingMetadata?: {
    groundingChunks?: unknown[];
    webSearchQueries?: string[];
  };
}

interface ResearchResponse {
  candidates?: ResearchCandidate[];
  text?: string;
}

type GeneratedArtifactContent = GeneratedArtifactBase;

interface ValidationReportItem {
  code: string;
  message: string;
  passed: boolean;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return methodNotAllowedResponse();
  }

  let body: GenerateArtifactRequestBody;
  try {
    body = await parseVerifiedBackgroundBody<GenerateArtifactRequestBody>(event);
  } catch {
    return unauthorizedBackgroundResponse();
  }

  try {
    const { artifactId, formData, userId, feedback, useGoogleDrive, organizationId } = body;
    const cloudStorageProvider = isCloudStorageProvider(body.cloudStorageProvider)
      ? body.cloudStorageProvider
      : useGoogleDrive
        ? "google_drive"
        : null;

    if (!artifactId || !formData) {
      return { statusCode: 400, body: "Missing required fields" };
    }

    console.log(`[Background Job] Starting generation for artifacts/${artifactId}`);

    const serviceSupabase = createServiceRoleClient();
    const { data: scopedArtifact, error: artifactScopeError } = await serviceSupabase
      .from("artifacts")
      .select("organization_id, generation_metadata")
      .eq("id", artifactId)
      .maybeSingle();

    if (
      artifactScopeError ||
      !scopedArtifact ||
      scopedArtifact.organization_id !== (organizationId ?? null)
    ) {
      return { statusCode: 404, body: "Artifact not found" };
    }

    if (cloudStorageProvider) {
      try {
        if (!userId || !organizationId) {
          console.warn(
            "[Background Job] No se pudo resolver el usuario o la organización para crear carpetas cloud.",
          );
        } else {
          const cloudStorageService = getCloudStorageService(cloudStorageProvider);
          const folderTree = await cloudStorageService.setupArtifactFolderTree(
            artifactId,
            formData.title || "Taller",
            userId,
            organizationId,
          );
          console.log(`[Background Job] Carpeta cloud creada: ${folderTree.folderUrl}`);
        }
      } catch (error: unknown) {
        console.warn(
          "[Background Job] Error no crítico al aprovisionar almacenamiento cloud:",
          getErrorMessage(error),
        );
      }
    }

    const modelConfig = await resolveModelSetting(
      serviceSupabase,
      "ARTIFACT_BASE",
      {
        model: "gemini-3.5-flash",
        fallbackModel: "gemini-2.5-flash",
        temperature: 0.7,
        thinkingLevel: "medium",
      },
      organizationId || null,
    );
    console.log(
      `[Background Job] Model config: ${modelConfig.model} / ${modelConfig.fallbackModel}`,
    );

    let researchContext = "";
    let detectedSearchQueries: string[] = [];
    const searchModels = [modelConfig.model, modelConfig.fallbackModel].filter(
      Boolean,
    ) as string[];
    let researchSuccess = false;

    const hardcodedResearchPrompt = `
            Investiga tendencias educativas 2024-2025 sobre:
            TEMA: ${formData.title}
            DESCRIPCIÓN: ${formData.description}
            Encuentra herramientas, estadísticas y obsolescencias.
            ${feedback ? `\nNOTA IMPORTANTE (Feedback Usuario): ${feedback}` : ""}
        `;

    const researchPromptTemplate = await resolvePromptWithFallback(
      serviceSupabase,
      ARTIFACT_BASE_RESEARCH_PROMPT_CODE,
      hardcodedResearchPrompt,
      organizationId || null,
    );
    const researchPrompt = renderPromptTemplate(researchPromptTemplate, {
      courseTitle: formData.title || "",
      courseDescription: formData.description || "",
      feedbackBlock: feedback
        ? `NOTA IMPORTANTE (Feedback Usuario): ${feedback}`
        : "",
    });

    for (const modelName of searchModels) {
      try {
        console.log(`[Background Job] Researching with ${modelName}...`);

        const result = (await genAI.models.generateContent({
          model: modelName,
          contents: researchPrompt,
          config: {
            tools: [{ googleSearch: {} }],
            temperature: 0.7,
          },
        })) as ResearchResponse;

        researchContext = result.text || "";

        const grounding = result.candidates?.[0]?.groundingMetadata;
        if (grounding?.webSearchQueries) {
          detectedSearchQueries = grounding.webSearchQueries;
          console.log(
            `[Background Job] Google Search used. Queries: ${detectedSearchQueries.join(", ")}`,
          );
        } else {
          console.log(
            `[Background Job] Warning: Model ${modelName} did NOT perform a Google Search.`,
          );
        }

        const groundingChunks = grounding?.groundingChunks || [];
        console.log(
          `[Background Job] Grounding URLs found: ${groundingChunks.length}`,
        );

        console.log(`[Background Job] Research complete using ${modelName}.`);
        researchSuccess = true;
        break;
      } catch (error: unknown) {
        console.warn(
          `[Background Job] Research failed with ${modelName}:`,
          getErrorMessage(error),
        );
      }
    }

    if (!researchSuccess) {
      console.warn(
        "[Background Job] All research models failed. Proceeding without search context.",
      );
      researchContext = "Research unavailable due to API errors.";
    }

    const genModels = [modelConfig.model, modelConfig.fallbackModel].filter(
      Boolean,
    ) as string[];
    const hardcodedSystemPrompt = `
            Eres un Diseñador Instruccional Experto y Copywriter Senior.
            CONTEXTO RESEARCH: ${researchContext}
            ${feedback ? `\nFEEDBACK PREVIO (Corrigiendo versión anterior): ${feedback}` : ""}

            Tu tarea es DEFINIR LA BASE para el curso: "${formData.title}".
            Input del usuario: "${formData.description}".

            Genera:
            1. 3 Nombres atractivos (Hook + Promesa).
            2. Entre 3 y 5 Objetivos de aprendizaje claros (Verbos Bloom: ${BLOOM_VERBS.join(", ")}). NO generes más de 6.
            3. Descripción vendedora y perfilamiento.

            NO generes el temario ni módulos aún. Solo la definición estratégica.
        `;

    const systemPromptTemplate = await resolvePromptWithFallback(
      serviceSupabase,
      ARTIFACT_BASE_PROMPT_CODE,
      hardcodedSystemPrompt,
      organizationId || null,
    );
    const systemPrompt = renderPromptTemplate(systemPromptTemplate, {
      bloomVerbs: BLOOM_VERBS.join(", "),
      courseTitle: formData.title || "",
      courseDescription: formData.description || "",
      feedbackBlock: feedback
        ? `FEEDBACK PREVIO (Corrigiendo version anterior): ${feedback}`
        : "",
      researchContext,
    });

    let content: GeneratedArtifactContent | null = null;
    let genModelUsed = "";

    for (const modelName of genModels) {
      try {
        console.log(`[Background Job] Generating Phase 1 with ${modelName}...`);
        const result = await generateObject({
          model: resolveAiModel(modelName),
          schema: ArtifactBaseGenerationSchema,
          prompt: systemPrompt,
          temperature: 0.7,
        });
        content = result.object;
        genModelUsed = modelName;
        console.log(
          `[Background Job] Phase 1 Generation success using ${modelName}.`,
        );
        break;
      } catch (error: unknown) {
        console.warn(
          `[Background Job] Generation failed with ${modelName}:`,
          getErrorMessage(error),
        );
      }
    }

    if (!content) {
      throw new Error(
        `Generation failed on all models (${genModels.join(", ")}).`,
      );
    }

    const objectives = content.objetivos || [];
    const names = content.nombres || [];
    const description =
      content.descripcion?.texto || content.descripcion?.resumen || "";

    const checkBloom = objectives.every((objective) =>
      BLOOM_VERBS.some((verb) =>
        objective.trim().toLowerCase().startsWith(verb.toLowerCase()),
      ),
    );
    const checkNamesCount = names.length === 3;
    const checkObjectivesCount =
      objectives.length >= 3 && objectives.length <= 8;
    const checkDescLength = description.length > 30;

    const validationReport: ValidationReportItem[] = [
      {
        code: "V01",
        message: checkBloom
          ? "Objetivos cumplen Taxonomía de Bloom"
          : "Objetivos deben iniciar con verbos de acción (Bloom)",
        passed: checkBloom,
      },
      {
        code: "V02",
        message: checkNamesCount
          ? "Se generaron 3 opciones de nombres"
          : `Se generaron ${names.length} nombres (se requieren 3)`,
        passed: checkNamesCount,
      },
      {
        code: "V03",
        message: checkObjectivesCount
          ? "Cantidad adecuada de objetivos (3-8)"
          : `Cantidad de objetivos fuera de rango (${objectives.length})`,
        passed: checkObjectivesCount,
      },
      {
        code: "V04",
        message: checkDescLength
          ? "Descripción cumple longitud mínima"
          : "La descripción es demasiado breve",
        passed: checkDescLength,
      },
    ];

    const allPassed = validationReport.every((result) => result.passed);

    let updateArtifactQuery = serviceSupabase
      .from("artifacts")
      .update({
        nombres: content.nombres,
        objetivos: content.objetivos,
        descripcion: content.descripcion,
        generation_metadata: {
          ...(scopedArtifact.generation_metadata || {}),
          research_summary: researchContext.slice(0, 2000),
          search_queries: detectedSearchQueries,
          model_used: genModelUsed,
          phase: "PHASE_1_BASE",
          structure: [],
          original_input: formData,
          last_feedback_used: feedback || null,
        },
        validation_report: { results: validationReport, all_passed: allPassed },
        state: allPassed ? "APPROVED" : "ESCALATED",
      })
      .eq("id", artifactId);

    updateArtifactQuery = organizationId
      ? updateArtifactQuery.eq("organization_id", organizationId)
      : updateArtifactQuery.is("organization_id", null);
    const { error } = await updateArtifactQuery;

    if (error) {
      throw error;
    }

    console.log(
      `[Background Job] Success! Artifact ${artifactId} updated to Phase 1 Base.`,
    );
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (error: unknown) {
    console.error("[Background Job] Failed", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: getErrorMessage(error) }),
    };
  }
};
