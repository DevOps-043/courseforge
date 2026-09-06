import type { GoogleGenAI } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
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
  resolveVideoDurationValidationMode,
  type VideoDurationPolicy,
  videoDurationContractSchema,
  type VideoDurationContract,
} from "../../../src/domains/video-duration/video-duration-policy";
import { validateVideoDurationContent } from "../../../src/domains/video-duration/video-duration-validation";
import { parseModelJsonResponse } from "../../../src/shared/ai/model-json-response";

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

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getGeminiBillingOrPermissionError(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("lightning dunning decision is deny") ||
    normalizedMessage.includes("dunning decision is deny")
  ) {
    return "Gemini rechazo la solicitud porque el proyecto de Google Cloud asociado a la API key esta bloqueado por billing/dunning. Revisa facturacion/estado del proyecto en Google Cloud o configura una API key de un proyecto activo y reinicia el servidor.";
  }

  if (
    normalizedMessage.includes("permission_denied") ||
    normalizedMessage.includes('"code":403') ||
    normalizedMessage.includes("status code 403")
  ) {
    return "Gemini rechazo la solicitud con 403 PERMISSION_DENIED. Verifica que la API key tenga acceso a Gemini API/Generative Language API, que el proyecto este activo y que el modelo configurado este disponible para ese proyecto.";
  }

  return null;
}

export function matchesLesson(
  candidate: Pick<CurationRowRecord, "lesson_id" | "lesson_title">,
  lesson: Pick<MaterialLessonRecord, "lesson_id" | "lesson_title">,
) {
  return (
    candidate.lesson_id === lesson.lesson_id ||
    candidate.lesson_title === lesson.lesson_title
  );
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
  genAI: GoogleGenAI,
  input: MaterialsGenerationInput,
  logPrefix: string,
  models: string[],
  supabase?: SupabaseClient,
  componentTypes?: string[],
  organizationId?: string | null,
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

  for (let retry = 0; retry < 2; retry++) {
    for (const model of modelsToTry) {
      if (unavailableModels.has(model)) {
        continue;
      }

      try {
        console.log(`${logPrefix} Try ${retry + 1}, Model: ${model}`);
        const content = await generateMaterialsWithGemini(
          genAI,
          model,
          input,
          logPrefix,
          supabase,
          componentTypes,
          organizationId,
        );
        return { success: true as const, content };
      } catch (error) {
        const message = getErrorMessage(error, "");
        attemptErrors.push(
          `${model} (intento ${retry + 1}): ${message || "error desconocido"}`,
        );
        console.warn(`${logPrefix} ${model} failed: ${message}`);

        const permissionError = getGeminiBillingOrPermissionError(message);
        if (permissionError) {
          return { success: false as const, error: permissionError };
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
          await wait(MATERIALS_RETRY_BACKOFF_BASE_MS * (retry + 1));
          break;
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
      },
      effectiveComponentTypes,
    );
    console.log(`${logPrefix} Using hardcoded modular prompts for: ${effectiveComponentTypes.join(", ")}`);
  }

  const prompt =
    basePrompt +
    `\n\n## DATOS DE ENTRADA\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\`\n\nResponde SOLO con JSON valido.`;

  console.log(`${logPrefix} Calling ${model}`);

  const response = await genAI.models.generateContent({
    model,
    contents: prompt,
    config: {
      temperature: 0.7,
      maxOutputTokens: 16000,
      responseMimeType: "application/json",
    },
  });

  const generated = parseModelJsonResponse<MaterialsGenerationOutput>({
    finishReason: response.candidates?.[0]?.finishReason,
    responseText: response.text,
  });
  assertGeneratedVideoDurations(input, generated);
  return generated;
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

function assertGeneratedVideoDurations(
  input: MaterialsGenerationInput,
  generated: MaterialsGenerationOutput,
) {
  const failures: string[] = [];
  for (const component of input.lesson.components) {
    if (!component.duration_contract || !isVideoComponentType(component.type)) continue;
    const content = generated.components?.[component.type];
    if (!content) continue;
    const result = validateVideoDurationContent(content, component.duration_contract);
    failures.push(...result.issues.map((issue) => `${component.type}/${issue.code}: ${issue.message}`));
  }

  if (failures.length > 0) {
    const message = `VIDEO_DURATION_VALIDATION_FAILED: ${failures.join(" | ")}`;
    const validationMode = resolveVideoDurationValidationMode(
      process.env.VIDEO_DURATION_VALIDATION_MODE,
    );
    console.warn(`[Video Duration] mode=${validationMode} ${message}`);
    if (validationMode === "enforce") {
      throw new Error(message);
    }
  }
}

export async function findOrCreateMaterialLesson(
  supabase: SupabaseClient,
  materialsId: string,
  lessonPlan: LessonPlanRecord,
  index: number,
  logPrefix: string,
) {
  const lessonId = `${lessonPlan.lesson_id || `L${index}`}-G${index}`;

  const { data: existing } = await supabase
    .from("material_lessons")
    .select("*")
    .eq("materials_id", materialsId)
    .eq("lesson_id", lessonId)
    .maybeSingle();

  if (existing) {
    return existing;
  }

  const { data: created, error } = await supabase
    .from("material_lessons")
    .insert({
      materials_id: materialsId,
      lesson_id: lessonId,
      lesson_title: lessonPlan.lesson_title,
      module_id: lessonPlan.module_id || `mod-${index}`,
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

export async function saveGeneratedComponents(
  supabase: SupabaseClient,
  lessonId: string,
  content: MaterialsGenerationOutput,
  iteration: number,
  logPrefix: string,
  onlyTypes?: string[],
  durationContractsByType: Partial<Record<ComponentType, VideoDurationContract>> = {},
) {
  const components = content.components || {};
  const refs = content.source_refs_used || [];
  const componentTypesToReplace =
    onlyTypes && onlyTypes.length > 0 ? onlyTypes : Object.keys(components);

  if (!onlyTypes || componentTypesToReplace.length > 0) {
    let deleteQuery = supabase
      .from("material_components")
      .delete()
      .eq("material_lesson_id", lessonId);

    if (onlyTypes && onlyTypes.length > 0) {
      deleteQuery = deleteQuery.in("type", componentTypesToReplace);
    }

    const { error: deleteError } = await deleteQuery;
    if (deleteError) {
      throw deleteError;
    }

    console.log(
      `${logPrefix} Replaced existing component(s): ${
        onlyTypes ? componentTypesToReplace.join(", ") : "all"
      }`,
    );
  }

  for (const [type, data] of Object.entries(components)) {
    if (!data) {
      continue;
    }

    const durationContract = durationContractsByType[type as ComponentType];
    const { error: insertError } = await supabase.from("material_components").insert({
      ...(durationContract ? {
        assets: {
          assembly_target_duration_seconds: durationContract.targetDurationSeconds,
          video_duration_contract: durationContract,
        },
      } : {}),
      material_lesson_id: lessonId,
      type,
      content: data,
      source_refs: refs,
      validation_status: "PENDING",
      validation_errors: [],
      iteration_number: iteration,
    });

    if (insertError) {
      throw insertError;
    }
  }

  console.log(
    `${logPrefix} Saved ${Object.keys(components).length} component(s)${onlyTypes ? " (partial)" : ""}`,
  );
}
