import type { GoogleGenAI } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { materialsGenerationPrompt } from "../../../src/shared/config/prompts/materials-generation.prompts";
import {
  resolvePrompts,
  assemblePrompt,
} from "../../../src/shared/config/prompts/prompt-resolver.service";
import type {
  ComponentType,
  MaterialsGenerationInput,
  MaterialsGenerationOutput,
  QuizSpec,
} from "../../../src/domains/materials/types/materials.types";
import { getErrorMessage } from "./errors";
import { MATERIALS_RETRY_BACKOFF_BASE_MS } from "./timing";

interface LessonPlanComponentRecord {
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
}

const DEFAULT_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
];

const DEFAULT_QUIZ_SPEC: QuizSpec = {
  min_questions: 3,
  max_questions: 5,
  types: ["MULTIPLE_CHOICE", "TRUE_FALSE"],
};

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
}) {
  const { lesson, planDetails, lessonSources, iterationNumber, fixInstructions } =
    params;
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
      })),
      quiz_spec: lesson.quiz_spec || planDetails?.quiz_spec || DEFAULT_QUIZ_SPEC,
      requires_demo_guide:
        lesson.requires_demo_guide || planDetails?.requires_demo_guide || false,
    },
    sources: lessonSources.map((source) => ({
      id: source.id,
      source_title: source.source_title || source.source_ref,
      source_ref: source.source_ref,
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
  supabase?: SupabaseClient,
  componentTypes?: string[],
  organizationId?: string | null,
  models?: string[],
) {
  const modelsToTry = models && models.length > 0 ? models : DEFAULT_MODELS;
  for (let retry = 0; retry < 2; retry++) {
    for (const model of modelsToTry) {
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
        console.warn(`${logPrefix} ${model} failed: ${message}`);

        if (message.includes("429") || message.includes("rate limit")) {
          await wait(MATERIALS_RETRY_BACKOFF_BASE_MS * (retry + 1));
          break;
        }
      }
    }
  }

  return { success: false as const, error: "All retries exhausted" };
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

  if (supabase && effectiveComponentTypes.length > 0) {
    // Dynamic resolution: org-specific → global → hardcoded defaults
    const resolved = await resolvePrompts(
      supabase,
      effectiveComponentTypes,
      organizationId,
    );
    basePrompt = assemblePrompt(resolved, effectiveComponentTypes);
    console.log(`${logPrefix} Using modular prompts for: ${effectiveComponentTypes.join(", ")}`);
  } else {
    // Fallback to legacy monolithic prompt (no supabase client or no components)
    basePrompt = materialsGenerationPrompt;
  }

  const prompt =
    basePrompt +
    `\n\n## DATOS DE ENTRADA\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\`\n\nResponde SOLO con JSON valido.`;

  console.log(`${logPrefix} Calling ${model}`);

  const response = await genAI.models.generateContent({
    model,
    contents: prompt,
    config: { temperature: 0.7, maxOutputTokens: 16000 },
  });

  const responseText = response.text || "";
  const match = responseText.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("No JSON in response");
  }

  return JSON.parse(match[0]) as MaterialsGenerationOutput;
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
) {
  const components = content.components || {};
  const refs = content.source_refs_used || [];

  if (onlyTypes && onlyTypes.length > 0) {
    // Partial regeneration: only delete the specific component types being replaced
    for (const type of onlyTypes) {
      await supabase
        .from("material_components")
        .delete()
        .eq("material_lesson_id", lessonId)
        .eq("type", type)
        .eq("iteration_number", iteration);
    }
    console.log(`${logPrefix} Deleted ${onlyTypes.length} component type(s) for partial regen`);
  } else {
    // Full regeneration: delete all components for this iteration
    await supabase
      .from("material_components")
      .delete()
      .eq("material_lesson_id", lessonId)
      .eq("iteration_number", iteration);
  }

  for (const [type, data] of Object.entries(components)) {
    if (!data) {
      continue;
    }

    await supabase.from("material_components").insert({
      material_lesson_id: lessonId,
      type,
      content: data,
      source_refs: refs,
      validation_status: "PENDING",
      validation_errors: [],
      iteration_number: iteration,
    });
  }

  console.log(
    `${logPrefix} Saved ${Object.keys(components).length} component(s)${onlyTypes ? " (partial)" : ""}`,
  );
}
