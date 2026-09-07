import { Handler } from "@netlify/functions";
import { generateObject } from "ai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resolvePromptWithFallback } from "../../src/shared/config/prompts/prompt-resolver.service";
import { GLOBAL_VIDEO_DURATION_PROMPTS } from "../../src/shared/config/prompts/global-video-duration.prompts";
import {
  INSTRUCTIONAL_PLAN_CONTEXT_PROMPT_CODE,
  INSTRUCTIONAL_PLAN_SYSTEM_PROMPT_CODE,
  instructionalPlanContextPromptDefault,
  renderPromptTemplate,
} from "../../src/shared/config/prompts/pipeline.prompts";
import {
  createServiceRoleClient,
  getSupabaseServiceKey,
  getSupabaseUrl,
  hasSupabaseServiceRoleKey,
  resolveAiModel,
  resolveModelSetting,
} from "./shared/bootstrap";
import { getErrorMessage } from "./shared/errors";
import { methodNotAllowedResponse, parseJsonBody } from "./shared/http";
import {
  resolveArtifactVideoDurationPolicy,
  type VideoDurationPolicy,
} from "../../src/domains/video-duration/video-duration-policy";
import { applyVideoDurationPolicyToPlan } from "../../src/domains/video-duration/video-duration-plan";
import {
  canIteratePlan,
  getPlanIterationCount,
  getNextPlanIteration,
  PLAN_MAX_ITERATIONS,
} from "../../src/domains/plan/lib/plan-iteration";

const ComponentSchema = z.object({
  type: z
    .enum([
      "DIALOGUE",
      "READING",
      "QUIZ",
      "VIDEO_THEORETICAL",
      "VIDEO_DEMO",
      "VIDEO_GUIDE",
      "EXERCISE",
      "DEMO_GUIDE",
    ])
    .describe(
      "El tipo exacto de componente. CRITICO: Usa 'VIDEO_THEORETICAL' para conceptos abstractos, 'VIDEO_DEMO' para mostrar ejemplos reales, y 'VIDEO_GUIDE' para tutoriales paso a paso.",
    ),
  summary: z
    .string()
    .describe(
      "Descripcion detallada del componente (2-3 oraciones). Debe justificar por que se eligio este formato especifico.",
    ),
});

const LessonPlanSchema = z.object({
  lesson_id: z.string(),
  lesson_title: z.string(),
  lesson_order: z.number(),
  module_id: z.string(),
  module_title: z.string(),
  module_index: z.number(),
  oa_text: z.string().describe("Objetivo de Aprendizaje especifico"),
  oa_bloom_verb: z.string().optional(),
  measurable_criteria: z.string().optional(),
  course_type_detected: z.string().optional(),
  components: z.array(ComponentSchema),
  alignment_notes: z.string().optional(),
});

const GeneratedPlanSchema = z.object({
  lesson_plans: z.array(LessonPlanSchema),
  blockers: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .default([]),
});

type BackgroundSupabaseClient = SupabaseClient;
type GeneratedLessonPlan = z.infer<typeof LessonPlanSchema>;
type GeneratedBlocker = Record<string, unknown>;

interface RequestBody {
  artifactId?: string;
  customPrompt?: string;
  iterationInstructions?: string;
  iterationNumber?: number;
  useCustomPrompt?: boolean;
  userToken?: string;
}

interface ArtifactRecord {
  generation_metadata?: unknown;
  idea_central: string;
  nombres?: string[] | null;
  organization_id?: string | null;
}

interface SyllabusLessonRecord {
  estimated_minutes?: number | null;
  id: string;
  objective_specific?: string | null;
  title: string;
}

interface SyllabusModuleRecord {
  id?: string | null;
  lessons?: SyllabusLessonRecord[] | null;
  title: string;
}

interface SyllabusRecord {
  modules?: unknown;
}

function createBackgroundSupabaseClient(userToken: string) {
  const supabaseUrl = getSupabaseUrl();
  const supabaseKey = getSupabaseServiceKey();

  if (hasSupabaseServiceRoleKey()) {
    console.log("[Background Job] Using Service Role Key (Safe from expiry)");
    return createClient(supabaseUrl, supabaseKey);
  }

  console.log("[Background Job] Warn: Using User Token (Risk of JWT expiry)");
  return createClient(supabaseUrl, supabaseKey, {
    global: {
      headers: { Authorization: `Bearer ${userToken}` },
    },
  });
}

function normalizeSyllabusModules(rawModules: unknown): SyllabusModuleRecord[] {
  if (!Array.isArray(rawModules)) {
    throw new Error("Syllabus modules is empty or not an array.");
  }

  const modules = rawModules as SyllabusModuleRecord[];
  if (modules.length === 0) {
    throw new Error("Syllabus modules is empty or not an array.");
  }

  return modules;
}

function buildContextPromptTemplate(params: {
  configuredPrompt: string;
  customPrompt?: string;
  iterationInstructions?: string;
  useCustomPrompt?: boolean;
}) {
  const {
    configuredPrompt,
    customPrompt,
    iterationInstructions,
    useCustomPrompt,
  } = params;

  const basePrompt =
    useCustomPrompt && customPrompt && customPrompt.trim().length > 0
      ? customPrompt
      : configuredPrompt || instructionalPlanContextPromptDefault;

  if (!iterationInstructions?.trim()) {
    return basePrompt;
  }

  return `${basePrompt}\n\nRETROALIMENTACION PARA ESTA ITERACION:\n${iterationInstructions.trim()}\nRegenera el plan completo aplicando esta retroalimentacion.`;
}

function renderLessonsText(lessons: SyllabusLessonRecord[]) {
  return lessons
    .map(
      (lesson, index) =>
        `${index + 1}. ID: ${lesson.id}\n   Leccion: ${lesson.title}\n   OA Original: ${lesson.objective_specific || "N/A"}\n   Tiempo total estimado de aprendizaje: ${lesson.estimated_minutes || "N/A"} minutos`,
    )
    .join("\n\n");
}

async function prepareInstructionalPlanRecord(
  supabase: BackgroundSupabaseClient,
  artifactId: string,
  reservedIteration?: number,
) {
  const { data: existingPlan, error: lookupError } = await supabase
    .from("instructional_plans")
    .select("id, iteration_count")
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (lookupError) {
    throw lookupError;
  }

  const currentIteration = getPlanIterationCount(
    existingPlan?.iteration_count,
    Boolean(existingPlan),
  );
  const nextIteration = reservedIteration === undefined
    ? getNextPlanIteration(currentIteration)
    : reservedIteration;

  if (
    !Number.isInteger(nextIteration) ||
    nextIteration < 1 ||
    nextIteration > PLAN_MAX_ITERATIONS
  ) {
    throw new Error("Numero de iteracion del plan invalido.");
  }

  if (reservedIteration === undefined && !canIteratePlan(currentIteration)) {
    throw new Error(
      `El plan instruccional alcanzo el limite de ${PLAN_MAX_ITERATIONS} iteraciones.`,
    );
  }

  if (existingPlan) {
    let reservationQuery = supabase
      .from("instructional_plans")
      .update({
        validation: null,
        state: "STEP_PROCESSING",
        iteration_count: nextIteration,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingPlan.id);

    if (reservedIteration === undefined) {
      reservationQuery = reservationQuery.eq(
        "iteration_count",
        existingPlan.iteration_count || 0,
      );
    } else {
      reservationQuery = reservationQuery.eq(
        "iteration_count",
        reservedIteration,
      );
    }

    const { data: preparedPlan, error: reservationError } = await reservationQuery
      .select("id")
      .maybeSingle();

    if (reservationError) {
      throw reservationError;
    }
    if (!preparedPlan) {
      throw new Error(
        "Otra iteracion del plan fue iniciada al mismo tiempo.",
      );
    }
    return nextIteration;
  }

  const { error: insertError } = await supabase.from("instructional_plans").insert({
    artifact_id: artifactId,
    lesson_plans: [],
    blockers: [],
    validation: null,
    state: "STEP_PROCESSING",
    iteration_count: nextIteration,
  });

  if (insertError) {
    throw insertError;
  }

  return nextIteration;
}

async function generateModulePlans(params: {
  artifact: ArtifactRecord;
  contextPromptTemplate: string;
  module: SyllabusModuleRecord;
  moduleIndex: number;
  modelName: string;
  systemPromptTemplate: string;
  temperature: number;
  videoDurationPolicy: VideoDurationPolicy;
}) {
  const { artifact, contextPromptTemplate, module, moduleIndex, modelName, systemPromptTemplate, temperature, videoDurationPolicy } =
    params;
  const lessons = module.lessons || [];
  const lessonsText = renderLessonsText(lessons);
  const promptVariables = {
    courseName: artifact.nombres?.[0] || artifact.idea_central,
    currentModule: module.title,
    ideaCentral: artifact.idea_central,
    lessonCount: lessons.length,
    lessonsText,
  };
  const finalSystemPrompt = renderPromptTemplate(systemPromptTemplate, promptVariables);
  const finalContextPrompt = renderPromptTemplate(contextPromptTemplate, promptVariables);

  const result = await generateObject({
    model: resolveAiModel(modelName),
    schema: GeneratedPlanSchema,
    prompt: `${finalSystemPrompt}\n\nMODULO ACTUAL: ${module.title}\n${finalContextPrompt}`,
    temperature,
  });

  const moduleLessonPlans = result.object.lesson_plans.map((lessonPlan) => ({
    ...lessonPlan,
    module_id: module.id || `mod-${moduleIndex}`,
    module_title: module.title,
    module_index: moduleIndex,
  })) as GeneratedLessonPlan[];
  const lessonPlans = applyVideoDurationPolicyToPlan(
    moduleLessonPlans,
    videoDurationPolicy,
  ) as GeneratedLessonPlan[];

  return {
    blockers: result.object.blockers as GeneratedBlocker[],
    lessonPlans,
  };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return methodNotAllowedResponse();
  }

  let artifactId: string | undefined;
  let activeIteration: number | undefined;
  let supabase: BackgroundSupabaseClient | undefined;

  try {
    const body = parseJsonBody<RequestBody>(event);
    artifactId = body.artifactId;

    if (!artifactId || !body.userToken) {
      return { statusCode: 400, body: "Missing required fields" };
    }

    console.log(
      `[Background Job] Starting Instructional Plan generation for artifacts/${artifactId}`,
    );

    supabase = createBackgroundSupabaseClient(body.userToken);

    const [{ data: rawArtifact, error: artifactError }, { data: rawSyllabus, error: syllabusError }] =
      await Promise.all([
        supabase.from("artifacts").select("*").eq("id", artifactId).single(),
        supabase
          .from("syllabus")
          .select("modules")
          .eq("artifact_id", artifactId)
          .single(),
      ]);

    if (artifactError || !rawArtifact) {
      throw new Error(`Artifact not found: ${artifactError?.message}`);
    }

    if (syllabusError) {
      throw new Error(`Syllabus not found: ${syllabusError.message}`);
    }

    const syllabusRecord = (rawSyllabus || null) as SyllabusRecord | null;
    if (!syllabusRecord?.modules) {
      throw new Error("Syllabus record has no modules.");
    }

    const artifact = rawArtifact as ArtifactRecord;
    const videoDurationPolicy = resolveArtifactVideoDurationPolicy(artifact.generation_metadata);
    const syllabusModules = normalizeSyllabusModules(syllabusRecord.modules);

    const promptOrganizationId = artifact.organization_id || null;
    const [systemPromptTemplate, contextPromptTemplateFromDb] = await Promise.all([
      resolvePromptWithFallback(
        supabase,
        INSTRUCTIONAL_PLAN_SYSTEM_PROMPT_CODE,
        GLOBAL_VIDEO_DURATION_PROMPTS.INSTRUCTIONAL_PLAN_SYSTEM,
        promptOrganizationId,
      ),
      resolvePromptWithFallback(
        supabase,
        INSTRUCTIONAL_PLAN_CONTEXT_PROMPT_CODE,
        instructionalPlanContextPromptDefault,
        promptOrganizationId,
      ),
    ]);

    const contextPromptTemplate = buildContextPromptTemplate({
      configuredPrompt: contextPromptTemplateFromDb,
      customPrompt: body.customPrompt,
      iterationInstructions: body.iterationInstructions,
      useCustomPrompt: body.useCustomPrompt,
    });

    const iterationNumber = await prepareInstructionalPlanRecord(
      supabase,
      artifactId,
      body.iterationNumber,
    );
    activeIteration = iterationNumber;

    const modelConfig = await resolveModelSetting(createServiceRoleClient(), "INSTRUCTIONAL_PLAN", {
      model: "gemini-3.5-flash",
      fallbackModel: "gemini-2.5-flash",
      temperature: 0.7,
      thinkingLevel: "medium",
    }, promptOrganizationId);
    const modelName = modelConfig.model;
    console.log(
      `[Background Job] Starting incremental generation with ${modelName}`,
    );

    let allGeneratedPlans: GeneratedLessonPlan[] = [];
    let allBlockers: GeneratedBlocker[] = [];

    for (let moduleIndex = 0; moduleIndex < syllabusModules.length; moduleIndex++) {
      const module = syllabusModules[moduleIndex];
      const lessons = module.lessons || [];
      if (lessons.length === 0) {
        continue;
      }

      console.log(
        `[Background Job] Processing Module ${moduleIndex + 1}/${syllabusModules.length}: ${module.title} (${lessons.length} lessons)`,
      );

      try {
        const moduleResult = await generateModulePlans({
          artifact,
          contextPromptTemplate,
          module,
          moduleIndex,
          modelName,
          systemPromptTemplate,
          temperature: modelConfig.temperature,
          videoDurationPolicy,
        });

        allGeneratedPlans = [...allGeneratedPlans, ...moduleResult.lessonPlans];
        allBlockers = [...allBlockers, ...moduleResult.blockers];

        console.log(
          `[Background Job] Module ${moduleIndex + 1} generated. Total lessons so far: ${allGeneratedPlans.length}`,
        );
      } catch (error: unknown) {
        console.error(
          `[Background Job] Error in module ${moduleIndex + 1}:`,
          error,
        );
        throw new Error(
          `Module ${moduleIndex + 1} generation failed: ${getErrorMessage(error)}`,
        );
      }
    }

    if (allGeneratedPlans.length === 0) {
      throw new Error("La generacion no produjo ninguna leccion para el plan.");
    }

    const { data: completedPlan, error: completionError } = await supabase
      .from("instructional_plans")
      .update({
        lesson_plans: allGeneratedPlans,
        blockers: allBlockers,
        state: allBlockers.length > 0 ? "STEP_WITH_BLOCKERS" : "STEP_READY_FOR_REVIEW",
        iteration_count: iterationNumber,
        updated_at: new Date().toISOString(),
      })
      .eq("artifact_id", artifactId)
      .eq("iteration_count", iterationNumber)
      .select("id")
      .maybeSingle();

    if (completionError) {
      throw completionError;
    }
    if (!completedPlan) {
      throw new Error(
        "La iteracion fue reemplazada por una solicitud mas reciente.",
      );
    }

    console.log(
      `[Background Job] Generation finished successfully for ${allGeneratedPlans.length} lessons.`,
    );
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, count: allGeneratedPlans.length }),
    };
  } catch (error: unknown) {
    console.error("[Background Job] Fatal Error:", error);

    if (supabase && artifactId) {
      let failureQuery = supabase
        .from("instructional_plans")
        .update({ state: "STEP_FAILED", updated_at: new Date().toISOString() })
        .eq("artifact_id", artifactId);

      if (activeIteration !== undefined) {
        failureQuery = failureQuery.eq("iteration_count", activeIteration);
      }

      await failureQuery;
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: getErrorMessage(error),
      }),
    };
  }
};
