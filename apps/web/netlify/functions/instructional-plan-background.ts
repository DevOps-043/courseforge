import { Handler } from "@netlify/functions";
import { generateObject } from "ai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { INSTRUCTIONAL_PLAN_SYSTEM_PROMPT } from "../../src/config/prompts/instructional-plan";
import {
  createGoogleAIProvider,
  createServiceRoleClient,
  getSupabaseServiceKey,
  getSupabaseUrl,
  hasSupabaseServiceRoleKey,
  resolveModelSetting,
} from "./shared/bootstrap";
import { getErrorMessage } from "./shared/errors";
import { methodNotAllowedResponse, parseJsonBody } from "./shared/http";

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

const googleAI = createGoogleAIProvider();

type BackgroundSupabaseClient = SupabaseClient;
type GeneratedLessonPlan = z.infer<typeof LessonPlanSchema>;

interface RequestBody {
  artifactId?: string;
  customPrompt?: string;
  useCustomPrompt?: boolean;
  userToken?: string;
}

interface ArtifactRecord {
  idea_central: string;
  nombres?: string[] | null;
}

interface SyllabusLessonRecord {
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

interface PromptRecord {
  content?: string | null;
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
  artifact: ArtifactRecord;
  customPrompt?: string;
  dbPrompt?: PromptRecord | null;
  useCustomPrompt?: boolean;
}) {
  const { artifact, customPrompt, dbPrompt, useCustomPrompt } = params;

  if (useCustomPrompt && customPrompt && customPrompt.trim().length > 0) {
    return customPrompt;
  }

  return (
    dbPrompt?.content ||
    `CONTEXTO DEL CURSO:
Curso: ${artifact.nombres?.[0] || artifact.idea_central}
Idea Central: ${artifact.idea_central}

ESTRUCTURA DE LECCIONES:
\${lessonsText}`
  );
}

function renderLessonsText(lessons: SyllabusLessonRecord[]) {
  return lessons
    .map(
      (lesson, index) =>
        `${index + 1}. ID: ${lesson.id}\n   Leccion: ${lesson.title}\n   OA Original: ${lesson.objective_specific || "N/A"}`,
    )
    .join("\n\n");
}

async function upsertInstructionalPlanRecord(
  supabase: BackgroundSupabaseClient,
  artifactId: string,
) {
  const { data: existingPlan } = await supabase
    .from("instructional_plans")
    .select("id")
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (existingPlan) {
    await supabase
      .from("instructional_plans")
      .update({
        lesson_plans: [],
        validation: null,
        state: "STEP_PROCESSING",
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingPlan.id);
    return;
  }

  await supabase.from("instructional_plans").insert({
    artifact_id: artifactId,
    lesson_plans: [],
    validation: null,
    state: "STEP_PROCESSING",
  });
}

async function generateModulePlans(params: {
  artifact: ArtifactRecord;
  contextPromptTemplate: string;
  module: SyllabusModuleRecord;
  moduleIndex: number;
  modelName: string;
  temperature: number;
}) {
  const { artifact, contextPromptTemplate, module, moduleIndex, modelName, temperature } =
    params;
  const lessons = module.lessons || [];
  const lessonsText = renderLessonsText(lessons);

  const finalContextPrompt = contextPromptTemplate
    .replace(
      /\$\{courseName\}/g,
      artifact.nombres?.[0] || artifact.idea_central,
    )
    .replace(/\$\{ideaCentral\}/g, artifact.idea_central)
    .replace(/\$\{lessonsText\}/g, lessonsText)
    .replace(/\$\{currentModule\}/g, module.title);

  const result = await generateObject({
    model: googleAI(modelName),
    schema: GeneratedPlanSchema,
    prompt: `${INSTRUCTIONAL_PLAN_SYSTEM_PROMPT}\n\nMODULO ACTUAL: ${module.title}\n${finalContextPrompt}`,
    temperature,
  });

  return result.object.lesson_plans.map((lessonPlan) => ({
    ...lessonPlan,
    module_id: module.id || `mod-${moduleIndex}`,
    module_title: module.title,
    module_index: moduleIndex,
  })) as GeneratedLessonPlan[];
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return methodNotAllowedResponse();
  }

  let artifactId: string | undefined;
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
    const syllabusModules = normalizeSyllabusModules(syllabusRecord.modules);

    const { data: dbPrompt } = await supabase
      .from("system_prompts")
      .select("content")
      .eq("code", "INSTRUCTIONAL_PLAN")
      .eq("is_active", true)
      .single();

    const contextPromptTemplate = buildContextPromptTemplate({
      artifact,
      customPrompt: body.customPrompt,
      dbPrompt: (dbPrompt || null) as PromptRecord | null,
      useCustomPrompt: body.useCustomPrompt,
    });

    await upsertInstructionalPlanRecord(supabase, artifactId);

    const modelConfig = await resolveModelSetting(createServiceRoleClient(), "INSTRUCTIONAL_PLAN", {
      model: "gemini-2.5-flash",
      fallbackModel: "gemini-2.0-flash",
      temperature: 0.7,
      thinkingLevel: "medium",
    });
    const modelName = modelConfig.model;
    console.log(
      `[Background Job] Starting incremental generation with ${modelName}`,
    );

    let allGeneratedPlans: GeneratedLessonPlan[] = [];

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
        const modulePlans = await generateModulePlans({
          artifact,
          contextPromptTemplate,
          module,
          moduleIndex,
          modelName,
          temperature: modelConfig.temperature,
        });

        allGeneratedPlans = [...allGeneratedPlans, ...modulePlans];

        await supabase
          .from("instructional_plans")
          .update({
            lesson_plans: allGeneratedPlans,
            updated_at: new Date().toISOString(),
          })
          .eq("artifact_id", artifactId);

        console.log(
          `[Background Job] Module ${moduleIndex + 1} saved. Total lessons so far: ${allGeneratedPlans.length}`,
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

    await supabase
      .from("instructional_plans")
      .update({
        state: "STEP_READY_FOR_REVIEW",
        updated_at: new Date().toISOString(),
      })
      .eq("artifact_id", artifactId);

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
      await supabase
        .from("instructional_plans")
        .update({ state: "STEP_FAILED", updated_at: new Date().toISOString() })
        .eq("artifact_id", artifactId);
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
