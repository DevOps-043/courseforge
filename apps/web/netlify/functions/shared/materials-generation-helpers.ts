import type { GoogleGenAI } from "@google/genai";
import type OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  resolvePrompts,
  assemblePrompt,
} from "../../../src/shared/config/prompts/prompt-resolver.service";
import {
  COMPONENT_PROMPT_CODES,
  DEFAULT_PROMPTS,
  SYSTEM_PROMPT_CODE,
} from "../../../src/shared/config/prompts/materials-generation.prompts.modular";
import type {
  ComponentType,
  MaterialsGenerationInput,
  MaterialsGenerationOutput,
  QuizSpec,
} from "../../../src/domains/materials/types/materials.types";
import { getErrorMessage } from "./errors";
import { MATERIALS_RETRY_BACKOFF_BASE_MS } from "./timing";
import {
  buildVideoDurationContract,
  isVideoComponentType,
  type VideoDurationPolicy,
  videoDurationContractSchema,
} from "../../../src/domains/video-duration/video-duration-policy";
import {
  buildVideoGenerationGuardrails,
} from "../../../src/domains/materials/validators/material-video.validators";
import { requestGeminiJson, requestOpenAiJson, type MaterialsModelRuntimeConfig } from "./materials-model-client";
import { VIDEO_GENERATION_LIMITS } from "../../../src/domains/materials/generation/video-generation.contracts";
export type { MaterialsModelRuntimeConfig } from "./materials-model-client";
import { getMaterialsModelProvider } from "../../../src/shared/ai/materials-model-provider";
import { createGeminiClient, createOpenAiClient } from "./bootstrap";

interface LessonPlanComponentRecord {
  duration_contract?: unknown;
  type: ComponentType;
  summary?: string | null;
}

export interface LessonPlanRecord {
  lesson_id?: string | null;
  lesson_title: string;
  module_id?: string | null;
  module_title: string;
  oa_text?: string | null;
  components?: LessonPlanComponentRecord[] | null;
  quiz_spec?: QuizSpec | null;
  requires_demo_guide?: boolean | null;
}

export interface MaterialLessonRecord {
  state?: string;
  id: string;
  lesson_id: string;
  lesson_title: string;
  module_id: string;
  module_title: string;
  oa_text?: string | null;
  expected_components?: string[] | null;
  quiz_spec?: QuizSpec | null;
  requires_demo_guide?: boolean | null;
  iteration_count?: number | null;
}

export interface CurationRowRecord {
  id: string;
  lesson_id?: string | null;
  lesson_title?: string | null;
  source_title?: string | null;
  source_ref: string;
  cobertura_completa?: boolean | null;
  source_kind?: "url" | "pdf" | null;
  validation_report?: {
    content_excerpt?: string;
  } | null;
}

const DEFAULT_QUIZ_SPEC: QuizSpec = {
  min_questions: 3,
  max_questions: 5,
  types: ["MULTIPLE_CHOICE", "TRUE_FALSE"],
};

function normalizeLessonReference(value: string | null | undefined) {
  const normalized = value?.trim().replace(/-G\d+$/i, "");
  if (
    !normalized ||
    normalized.toLowerCase() === "undefined" ||
    normalized.toLowerCase() === "null"
  ) {
    return null;
  }

  return normalized;
}

function normalizeLessonTitle(value: string | null | undefined) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function buildMaterialLessonId(
  lessonId: string | null | undefined,
  index: number,
) {
  const canonicalId = normalizeLessonReference(lessonId) || `lesson-${index}`;
  return `${canonicalId}-G${index}`;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getProviderBillingOrPermissionError(
  provider: "gemini" | "openai",
  message: string,
) {
  const normalizedMessage = message.toLowerCase();

  if (provider === "gemini" && (
    normalizedMessage.includes("lightning dunning decision is deny") ||
    normalizedMessage.includes("dunning decision is deny")
  )) {
    return "Gemini rechazo la solicitud porque el proyecto de Google Cloud asociado a la API key esta bloqueado por billing/dunning. Revisa facturacion/estado del proyecto en Google Cloud o configura una API key de un proyecto activo y reinicia el servidor.";
  }

  if (
    normalizedMessage.includes("permission_denied") ||
    normalizedMessage.includes('"code":403') ||
    normalizedMessage.includes("status code 403")
  ) {
    return provider === "gemini"
      ? "Gemini rechazo la solicitud con 403 PERMISSION_DENIED. Verifica que la API key tenga acceso a Gemini API/Generative Language API, que el proyecto este activo y que el modelo configurado este disponible para ese proyecto."
      : "OpenAI rechazo la solicitud por permisos. Verifica OPENAI_API_KEY y que el proyecto tenga acceso al modelo configurado.";
  }

  if (
    provider === "openai" &&
    (normalizedMessage.includes("insufficient_quota") ||
      normalizedMessage.includes("billing") ||
      normalizedMessage.includes("quota"))
  ) {
    return "OpenAI rechazo la solicitud por cuota o facturacion. Revisa los creditos y limites del proyecto asociado a OPENAI_API_KEY.";
  }

  return null;
}

export function matchesLesson(
  candidate: Pick<CurationRowRecord, "lesson_id" | "lesson_title">,
  lesson: Pick<MaterialLessonRecord, "lesson_id" | "lesson_title">,
) {
  const candidateId = normalizeLessonReference(candidate.lesson_id);
  const lessonId = normalizeLessonReference(lesson.lesson_id);
  const candidateTitle = normalizeLessonTitle(candidate.lesson_title);
  const lessonTitle = normalizeLessonTitle(lesson.lesson_title);

  if (candidateId && lessonId) return candidateId === lessonId;
  return Boolean(candidateTitle) && candidateTitle === lessonTitle;
}

export function findLessonSources(
  rows: CurationRowRecord[],
  lesson: Pick<MaterialLessonRecord, "lesson_id" | "lesson_title">,
) {
  return rows.filter((row) => matchesLesson(row, lesson));
}

export function findPlanDetails(
  lessonPlans: LessonPlanRecord[],
  lesson: Pick<MaterialLessonRecord, "lesson_id" | "lesson_title">,
) {
  return (
    lessonPlans.find((lessonPlan) => matchesLesson(lessonPlan, lesson)) || null
  );
}

export function buildMaterialsGenerationInput(params: {
  lesson: MaterialLessonRecord;
  planDetails?: LessonPlanRecord | null;
  lessonSources: CurationRowRecord[];
  iterationNumber: number;
  fixInstructions?: string;
  videoDurationPolicy: VideoDurationPolicy;
}) {
  const {
    lesson,
    planDetails,
    lessonSources,
    iterationNumber,
    fixInstructions,
    videoDurationPolicy,
  } = params;
  const componentTypes = lesson.expected_components || [];

  const input: MaterialsGenerationInput = {
    lesson: {
      lesson_id: lesson.lesson_id,
      lesson_title: lesson.lesson_title,
      module_id: lesson.module_id,
      module_title: lesson.module_title,
      oa_text: lesson.oa_text || planDetails?.oa_text || "",
      components: componentTypes.map((componentType) => ({
        type: componentType as ComponentType,
        summary:
          planDetails?.components?.find(
            (component) => component.type === componentType,
          )?.summary || "",
        ...resolveComponentDurationContract(planDetails, componentType, videoDurationPolicy),
      })),
      quiz_spec: lesson.quiz_spec || planDetails?.quiz_spec || DEFAULT_QUIZ_SPEC,
      requires_demo_guide:
        lesson.requires_demo_guide || planDetails?.requires_demo_guide || false,
    },
    sources: lessonSources.map((source) => ({
      id: source.id,
      source_title: source.source_title || source.source_ref,
      source_ref: source.source_ref,
      source_excerpt: source.validation_report?.content_excerpt,
      cobertura_completa: source.cobertura_completa || false,
    })),
    iteration_number: iterationNumber,
    ...(fixInstructions ? { fix_instructions: fixInstructions } : {}),
  };

  return input;
}

export async function generateWithRetry(
  input: MaterialsGenerationInput,
  logPrefix: string,
  models: string[],
  modelRuntimeConfig: MaterialsModelRuntimeConfig,
  supabase?: SupabaseClient,
  componentTypes?: string[],
  organizationId?: string | null,
  deadlineMs = Date.now() + VIDEO_GENERATION_LIMITS.lessonTimeoutMs,
  artifactId?: string,
  lessonId?: string,
) {
  const modelsToTry = Array.from(new Set(models.filter(Boolean)));
  if (modelsToTry.length === 0) {
    return {
      success: false as const,
      error: "MODEL_SETTING_NOT_CONFIGURED: Materiales no tiene modelos configurados.",
    };
  }

  const attemptErrors: string[] = [];
  const unavailableModels = new Set<string>();
  let geminiClient: GoogleGenAI | undefined;
  let openAiClient: OpenAI | undefined;

  for (let retry = 0; retry < 2; retry++) {
    for (const model of modelsToTry) {
      if (Date.now() >= deadlineMs) return { success: false as const, error: "MATERIALS_TIME_BUDGET_EXHAUSTED: Se agotó el tiempo de generación de la lección." };
      if (unavailableModels.has(model)) {
        continue;
      }

      try {
        console.log(`${logPrefix} Try ${retry + 1}, Model: ${model}`);
        const provider = getMaterialsModelProvider(model);
        if (!provider) {
          throw new Error(
            `UNSUPPORTED_MATERIALS_MODEL: ${model} no pertenece a un proveedor implementado.`,
          );
        }

        const content = provider === "gemini"
          ? await generateMaterialsWithGemini(
              (geminiClient ||= createGeminiClient()),
              model,
              input,
              logPrefix,
              supabase,
              componentTypes,
              organizationId,
              modelRuntimeConfig,
              deadlineMs,
              artifactId,
              lessonId,
            )
          : await generateMaterialsWithOpenAI(
              (openAiClient ||= createOpenAiClient()),
              model,
              input,
              logPrefix,
              supabase,
              componentTypes,
              organizationId,
              modelRuntimeConfig,
              deadlineMs,
              artifactId,
              lessonId,
            );
        return { success: true as const, content };
      } catch (error) {
        const message = getErrorMessage(error, "");
        attemptErrors.push(
          `${model} (intento ${retry + 1}): ${message || "error desconocido"}`,
        );
        console.warn(`${logPrefix} ${model} failed: ${message}`);

        const provider = getMaterialsModelProvider(model);
        const permissionError = provider
          ? getProviderBillingOrPermissionError(provider, message)
          : null;
        if (permissionError) {
          attemptErrors.push(`${model}: ${permissionError}`);
          unavailableModels.add(model);
          continue;
        }

        const normalizedMessage = message.toLowerCase();
        if (
          normalizedMessage.includes('"code":404') ||
          normalizedMessage.includes("status code 404") ||
          normalizedMessage.includes('"status":"not_found"') ||
          normalizedMessage.includes("is not found for api version")
        ) {
          unavailableModels.add(model);
          continue;
        }

        if (message.includes("429") || message.includes("rate limit")) {
          await wait(Math.max(0, Math.min(MATERIALS_RETRY_BACKOFF_BASE_MS * (retry + 1), deadlineMs - Date.now())));
          continue;
        }
      }
    }

    if (unavailableModels.size === modelsToTry.length) {
      break;
    }
  }

  return {
    success: false as const,
    error: `Fallaron los modelos configurados para Materiales. ${attemptErrors.join(" | ")}`,
  };
}

export async function generateMaterialsWithGemini(
  genAI: GoogleGenAI,
  model: string,
  input: MaterialsGenerationInput,
  logPrefix: string,
  supabase?: SupabaseClient,
  componentTypes?: string[],
  organizationId?: string | null,
  modelRuntimeConfig: MaterialsModelRuntimeConfig = {
    temperature: 0.7,
    thinkingLevel: "medium",
  },
  deadlineMs = Date.now() + VIDEO_GENERATION_LIMITS.requestTimeoutMs,
  artifactId?: string,
  lessonId?: string,
) {
  const prompt = await buildMaterialsPrompt(
    input,
    logPrefix,
    supabase,
    componentTypes,
    organizationId,
  );

  console.log(`${logPrefix} Calling ${model} through Gemini`);

  const response = await requestGeminiJson(genAI, model, prompt, modelRuntimeConfig, remainingRequestTime(deadlineMs), {
    supabase,
    context: {
      artifactId,
      attempt: input.iteration_number,
      lessonId: lessonId || input.lesson.lesson_id,
      operation: "generate_material_components",
      organizationId,
      pipelineStep: "MATERIALS",
    },
  });
  return parseAndValidateMaterialsOutput(input, response.content);
}

export async function generateMaterialsWithOpenAI(
  client: OpenAI,
  model: string,
  input: MaterialsGenerationInput,
  logPrefix: string,
  supabase?: SupabaseClient,
  componentTypes?: string[],
  organizationId?: string | null,
  modelRuntimeConfig: MaterialsModelRuntimeConfig = {
    temperature: 0.7,
    thinkingLevel: "medium",
  },
  deadlineMs = Date.now() + VIDEO_GENERATION_LIMITS.requestTimeoutMs,
  artifactId?: string,
  lessonId?: string,
) {
  const prompt = await buildMaterialsPrompt(
    input,
    logPrefix,
    supabase,
    componentTypes,
    organizationId,
  );

  console.log(`${logPrefix} Calling ${model} through OpenAI`);

  const response = await requestOpenAiJson(client, model, prompt, modelRuntimeConfig, remainingRequestTime(deadlineMs), {
    supabase,
    context: {
      artifactId,
      attempt: input.iteration_number,
      lessonId: lessonId || input.lesson.lesson_id,
      operation: "generate_material_components",
      organizationId,
      pipelineStep: "MATERIALS",
    },
  });
  return parseAndValidateMaterialsOutput(input, response.content);
}

function remainingRequestTime(deadlineMs: number) {
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0) throw new Error("MATERIALS_TIME_BUDGET_EXHAUSTED: Se agotó el tiempo de generación de la lección.");
  return Math.min(remainingMs, VIDEO_GENERATION_LIMITS.requestTimeoutMs);
}

async function buildMaterialsPrompt(
  input: MaterialsGenerationInput,
  logPrefix: string,
  supabase?: SupabaseClient,
  componentTypes?: string[],
  organizationId?: string | null,
) {
  let basePrompt: string;

  // Derive component types from input when not explicitly provided (full-lesson generation)
  const effectiveComponentTypes =
    componentTypes && componentTypes.length > 0
      ? componentTypes
      : input.lesson.components.map((c) => c.type as string).filter(Boolean);

  if (effectiveComponentTypes.length === 0) {
    throw new Error("No component types available for materials generation");
  }

  if (supabase) {
    // Dynamic resolution: org-specific → global → hardcoded defaults
    const resolved = await resolvePrompts(
      supabase,
      effectiveComponentTypes,
      organizationId,
    );
    console.log(
      `${logPrefix} Prompt sources: ${Object.entries(resolved.promptSources)
        .map(([code, source]) => `${code}=${source}@${resolved.promptVersions[code] || "unknown"}`)
        .join(", ")}`,
    );
    basePrompt = assemblePrompt(resolved, effectiveComponentTypes);
    console.log(`${logPrefix} Using modular prompts for: ${effectiveComponentTypes.join(", ")}`);
  } else {
    const componentPrompts = Object.fromEntries(
      effectiveComponentTypes.map((componentType) => {
        const promptCode = COMPONENT_PROMPT_CODES[componentType];
        return [componentType, promptCode ? DEFAULT_PROMPTS[promptCode] ?? "" : ""];
      }),
    );

    basePrompt = assemblePrompt(
      {
        systemPrompt: DEFAULT_PROMPTS[SYSTEM_PROMPT_CODE] ?? "",
        componentPrompts,
        promptSources: Object.fromEntries(
          [SYSTEM_PROMPT_CODE, ...effectiveComponentTypes.map(
            (componentType) => COMPONENT_PROMPT_CODES[componentType],
          ).filter(Boolean)].map((code) => [code, "default"]),
        ),
        promptVersions: Object.fromEntries(
          [SYSTEM_PROMPT_CODE, ...effectiveComponentTypes.map(
            (componentType) => COMPONENT_PROMPT_CODES[componentType],
          ).filter(Boolean)].map((code) => [code, "code"]),
        ),
      },
      effectiveComponentTypes,
    );
    console.log(`${logPrefix} Using hardcoded modular prompts for: ${effectiveComponentTypes.join(", ")}`);
  }

  return (
    basePrompt +
    `\n\n${buildVideoGenerationGuardrails(input.lesson.components)}` +
    `\n\n## DATOS DE ENTRADA\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\`\n\nResponde SOLO con JSON valido.`
  );
}

export function parseAndValidateMaterialsOutput(
  input: MaterialsGenerationInput,
  response: unknown,
) {
  const generated = z.object({
    components: z.record(z.string(), z.record(z.string(), z.unknown())),
    source_refs_used: z.array(z.string()),
  }).parse(response);
  const requested = input.lesson.components.map((component) => component.type);
  if (requested.some((type) => !generated.components[type])
      || Object.keys(generated.components).some((type) => !requested.includes(type as ComponentType))) {
    throw new Error("MATERIALS_COMPONENT_MISMATCH: La respuesta debe incluir exactamente los componentes solicitados.");
  }
  const sources = new Set(input.sources.map((source) => source.id));
  if (generated.source_refs_used.some((ref) => !sources.has(ref))) {
    throw new Error("UNKNOWN_SOURCE_REFS: La respuesta usa fuentes ajenas a la lección.");
  }
  const distinctUsedSources = new Set(generated.source_refs_used);
  const requiredSourceCount = input.requires_sources
    ? Math.max(1, input.required_source_count || 0)
    : 0;
  if (distinctUsedSources.size < requiredSourceCount) {
    throw new Error(
      `INSUFFICIENT_SOURCE_USAGE: La respuesta debe utilizar al menos ${requiredSourceCount} fuentes validadas y utilizó ${distinctUsedSources.size}.`,
    );
  }
  return generated as unknown as MaterialsGenerationOutput;
}

function resolveComponentDurationContract(
  planDetails: LessonPlanRecord | null | undefined,
  componentType: string,
  fallbackPolicy: VideoDurationPolicy,
) {
  if (!isVideoComponentType(componentType)) return {};
  const component = planDetails?.components?.find((candidate) => candidate.type === componentType);
  const parsed = videoDurationContractSchema.safeParse(component?.duration_contract);
  return {
    duration_contract: parsed.success
      ? parsed.data
      : buildVideoDurationContract(fallbackPolicy, componentType),
  };
}

export async function findOrCreateMaterialLesson(
  supabase: SupabaseClient,
  materialsId: string,
  lessonPlan: LessonPlanRecord,
  index: number,
  logPrefix: string,
) {
  const lessonId = buildMaterialLessonId(lessonPlan.lesson_id, index);

  const { data: existing, error: existingError } = await supabase
    .from("material_lessons")
    .select("*")
    .eq("materials_id", materialsId)
    .eq("lesson_id", lessonId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing) {
    return existing;
  }

  // Repair rows created by the former `${undefined}-Gx` fallback instead of
  // duplicating every lesson when a stopped generation is restarted.
  const { data: legacyRows, error: legacyError } = await supabase
    .from("material_lessons")
    .select("*")
    .eq("materials_id", materialsId)
    .eq("lesson_title", lessonPlan.lesson_title)
    .limit(1);

  if (legacyError) {
    throw legacyError;
  }

  const legacy = legacyRows?.[0] as MaterialLessonRecord | undefined;
  if (legacy && /^(?:undefined|null)-G\d+$/i.test(legacy.lesson_id)) {
    const { data: repaired, error: repairError } = await supabase
      .from("material_lessons")
      .update({
        lesson_id: lessonId,
        module_id: normalizeLessonReference(lessonPlan.module_id) || `mod-${index}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", legacy.id)
      .select()
      .single();

    if (repairError) {
      throw repairError;
    }

    console.log(`${logPrefix} Repaired legacy lesson id: ${legacy.lesson_id} -> ${lessonId}`);
    return repaired;
  }

  const { data: created, error } = await supabase
    .from("material_lessons")
    .insert({
      materials_id: materialsId,
      lesson_id: lessonId,
      lesson_title: lessonPlan.lesson_title,
      module_id: normalizeLessonReference(lessonPlan.module_id) || `mod-${index}`,
      module_title: lessonPlan.module_title,
      oa_text: lessonPlan.oa_text,
      expected_components: (lessonPlan.components || []).map(
        (component) => component.type,
      ),
      quiz_spec: DEFAULT_QUIZ_SPEC,
      requires_demo_guide:
        lessonPlan.components?.some(
          (component) => component.type === "DEMO_GUIDE",
        ) || false,
      state: "PENDING",
      dod: {
        control3_consistency: "PENDING",
        control4_sources: "PENDING",
        control5_quiz: "PENDING",
        errors: [],
      },
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  console.log(`${logPrefix} Created: ${lessonId}`);
  return created;
}
