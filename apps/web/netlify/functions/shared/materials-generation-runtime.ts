import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ComponentType,
} from "../../../src/domains/materials/types/materials.types";
import { signBackgroundPayload } from "../../../src/lib/server/background-payload-signature";
import { shouldDispatchBackgroundInProcess } from "../../../src/lib/server/background-request-environment";
import {
  resolveArtifactVideoDurationPolicy,
  type VideoDurationContract,
  type VideoDurationPolicy,
} from "../../../src/domains/video-duration/video-duration-policy";
import { generateMaterialsByComponent, type MaterialsGenerationResult } from "../../../src/domains/materials/generation/materials-generation.service";
import { VIDEO_GENERATION_LIMITS } from "../../../src/domains/materials/generation/video-generation.contracts";
import { generateAndTraceMaterialVideo } from "./materials-video-generation";
import { saveGeneratedComponents } from "./material-components.repository";
import { getFunctionsBaseUrl } from "./bootstrap";
import {
  buildMaterialsGenerationInput,
  findLessonSources,
  findPlanDetails,
  generateWithRetry,
  type CurationRowRecord,
  type LessonPlanRecord,
  type MaterialLessonRecord,
  type MaterialsModelRuntimeConfig,
} from "./materials-generation-helpers";

const MATERIALS_FUNCTION_PATH =
  "/.netlify/functions/materials-generation-background";

export const PROCESS_NEXT_DELAY_MS = 8000;
export const START_JITTER_MS = 3000;

export interface MaterialsGenerationContext {
  artifactId: string;
  lessonPlans: LessonPlanRecord[];
  lessonSources: CurationRowRecord[];
  videoDurationPolicy: VideoDurationPolicy;
}


export function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function loadLessonPlans(
  supabase: SupabaseClient,
  artifactId: string,
): Promise<LessonPlanRecord[]> {
  const { data: planRecord, error } = await supabase
    .from("instructional_plans")
    .select("lesson_plans")
    .eq("artifact_id", artifactId)
    .single();
  if (error) throw error;
  return (planRecord?.lesson_plans || []) as LessonPlanRecord[];
}

export async function loadAptaSources(
  supabase: SupabaseClient,
  artifactId: string,
): Promise<CurationRowRecord[]> {
  const { data: curationRecord, error: curationError } = await supabase
    .from("curation")
    .select("id")
    .eq("artifact_id", artifactId)
    .maybeSingle();
  if (curationError) throw curationError;
  if (!curationRecord) {
    return [];
  }

  const { data: rows, error: rowsError } = await supabase
    .from("curation_rows")
    .select("id, lesson_id, lesson_title, source_title, source_ref, cobertura_completa, source_kind, validation_report")
    .eq("curation_id", curationRecord.id)
    .eq("apta", true);
  if (rowsError) throw rowsError;
  return (rows || []) as CurationRowRecord[];
}

export async function loadMaterialsGenerationContext(
  supabase: SupabaseClient,
  artifactId: string,
): Promise<MaterialsGenerationContext> {
  const [lessonPlans, lessonSources, artifactResult] = await Promise.all([
    loadLessonPlans(supabase, artifactId),
    loadAptaSources(supabase, artifactId),
    supabase
      .from("artifacts")
      .select("generation_metadata")
      .eq("id", artifactId)
      .single(),
  ]);
  if (artifactResult.error) throw artifactResult.error;
  return {
    artifactId,
    lessonPlans,
    lessonSources,
    videoDurationPolicy: resolveArtifactVideoDurationPolicy(
      artifactResult.data?.generation_metadata,
    ),
  };
}

export async function triggerNextLesson(
  materialsId: string,
  artifactId: string,
  logPrefix: string,
  localFallback?: (signedBody: string) => Promise<void>,
) {
  const triggerTimeoutMilliseconds = 10_000;
  const signedBody = JSON.stringify(
    signBackgroundPayload({ materialsId, artifactId, mode: "process-next" }),
  );

  if (shouldDispatchBackgroundInProcess({
    hasLocalHandler: Boolean(localFallback),
    netlify: process.env.NETLIFY,
    nodeEnv: process.env.NODE_ENV,
  })) {
    console.log(`${logPrefix} Scheduling next lesson in-process`);
    setTimeout(async () => {
      try {
        await localFallback!(signedBody);
      } catch (fallbackError) {
        console.error(`${logPrefix} In-process execution failed:`, fallbackError);
      }
    }, 100);
    return;
  }

  const url = `${getFunctionsBaseUrl()}${MATERIALS_FUNCTION_PATH}`;
  console.log(`${logPrefix} Triggering next at: ${url}`);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: signedBody,
      signal: AbortSignal.timeout(triggerTimeoutMilliseconds),
    });
    console.log(`${logPrefix} Trigger response: ${response.status}`);
    if (!response.ok) {
      throw new Error(`El encadenamiento de materiales respondió HTTP ${response.status}.`);
    }
  } catch (error: unknown) {
    console.error(`${logPrefix} Trigger failed:`, error);

    const errorCode =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    const errorMessage = error instanceof Error ? error.message : "";

    // Defensive fallback for development environments whose runtime flags are incomplete.
    if (
      process.env.NODE_ENV !== "production" &&
      localFallback &&
      (errorCode === "ECONNREFUSED" || errorMessage.includes("fetch failed"))
    ) {
      console.log(`${logPrefix} Local fallback: Running next step in-process...`);
      setTimeout(async () => {
        try {
          console.log(`${logPrefix} [Fallback] Starting process-next execution...`);
          await localFallback(signedBody);
        } catch (fallbackErr) {
          console.error(`${logPrefix} [Fallback] Execution failed:`, fallbackErr);
        }
      }, 100);
      return;
    }

    throw error;
  }
}

export async function setLessonState(
  supabase: SupabaseClient,
  lessonId: string,
  state: string,
  extras: Record<string, unknown> = {},
) {
  const { error } = await supabase
    .from("material_lessons")
    .update({
      state,
      updated_at: new Date().toISOString(),
      ...extras,
    })
    .eq("id", lessonId);
  if (error) throw error;
}

export async function touchMaterialsRecord(
  supabase: SupabaseClient,
  materialsId: string,
) {
  await supabase
    .from("materials")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", materialsId);
}

export async function markMaterialsValidating(
  supabase: SupabaseClient,
  materialsId: string,
) {
  await supabase
    .from("materials")
    .update({ state: "PHASE3_VALIDATING", updated_at: new Date().toISOString() })
    .eq("id", materialsId);
}

export async function resetGeneratingLessons(
  supabase: SupabaseClient,
  materialsId: string,
) {
  return supabase
    .from("material_lessons")
    .update({ state: "PENDING", updated_at: new Date().toISOString() })
    .eq("materials_id", materialsId)
    .eq("state", "GENERATING");
}

export async function processGenerationResult(params: {
  supabase: SupabaseClient;
  lessonId: string;
  lessonTitle: string;
  result: MaterialsGenerationResult;
  iterationNumber: number;
  logPrefix: string;
  onlyTypes?: string[];
  durationContractsByType?: Partial<Record<ComponentType, VideoDurationContract>>;
}) {
  const { supabase, lessonId, lessonTitle, result, iterationNumber, logPrefix, onlyTypes, durationContractsByType } =
    params;

  if (result.content && Object.keys(result.content.components).length) {
    await saveGeneratedComponents(
      supabase,
      lessonId,
      result.content,
      iterationNumber,
      logPrefix,
      onlyTypes || Object.keys(result.content.components),
      durationContractsByType,
    );
  }
  if (result.success) {
    await setLessonState(supabase, lessonId, "GENERATED", {
      dod: { control3_consistency: "PENDING", control4_sources: "PENDING", control5_quiz: "PENDING", errors: [] },
    });
    console.log(`${logPrefix} Generated ${lessonTitle}`);
    return { success: true as const };
  }

  await setLessonState(supabase, lessonId, "NEEDS_FIX", {
    dod: {
      control3_consistency: "FAIL",
      errors: [result.error || "Failed"],
    },
  });
  console.log(`${logPrefix} Failed ${lessonTitle}: ${result.error}`);
  return { success: false as const, error: result.error };
}

export async function generateLessonMaterials(params: {
  supabase: SupabaseClient;
  lesson: MaterialLessonRecord;
  generationContext: MaterialsGenerationContext;
  organizationId?: string | null;
  logPrefix: string;
  fixInstructions?: string;
  iterationNumber?: number;
  /** If set, only regenerate these component types (partial regen). */
  componentTypes?: string[];
  /** Database-configured models in primary/fallback order. */
  models: string[];
  /** Provider-specific generation controls resolved from model_settings. */
  modelRuntimeConfig: MaterialsModelRuntimeConfig;
}) {
  const {
    supabase,
    lesson,
    generationContext,
    organizationId,
    logPrefix,
    fixInstructions,
    iterationNumber,
    componentTypes,
    models,
    modelRuntimeConfig,
  } = params;

  const lessonSources = findLessonSources(generationContext.lessonSources, lesson);
  const planDetails = findPlanDetails(generationContext.lessonPlans, lesson);
  const currentIteration = iterationNumber || lesson.iteration_count || 1;
  const input = buildMaterialsGenerationInput({
    lesson,
    planDetails,
    lessonSources,
    iterationNumber: currentIteration,
    fixInstructions,
    videoDurationPolicy: generationContext.videoDurationPolicy,
  });

  const isPartial = componentTypes && componentTypes.length > 0;
  if (isPartial) {
    // Restrict input.lesson.components to only the requested types for partial regen
    input.lesson.components = input.lesson.components.filter(
      (c) => componentTypes.includes(c.type as string),
    );
    console.log(`${logPrefix} Partial regen: ${componentTypes.join(", ")}`);
  }

  const deadlineMs = Date.now() + VIDEO_GENERATION_LIMITS.lessonTimeoutMs;
  const result = await generateMaterialsByComponent({
    input,
    generateStandard: (standardInput) => generateWithRetry(
      standardInput, logPrefix, models, modelRuntimeConfig, supabase,
      standardInput.lesson.components.map((component) => component.type), organizationId,
      deadlineMs,
    ),
    generateVideo: (componentType, contract) => generateAndTraceMaterialVideo({
      supabase, input, componentType, contract, models, modelRuntimeConfig, organizationId,
      artifactId: generationContext.artifactId,
      lessonId: lesson.id,
      deadlineMs,
    }),
  });
  return processGenerationResult({
    supabase,
    lessonId: lesson.id,
    lessonTitle: lesson.lesson_title,
    result,
    iterationNumber: input.iteration_number,
    logPrefix,
    onlyTypes: isPartial ? componentTypes : undefined,
    durationContractsByType: Object.fromEntries(
      input.lesson.components.flatMap((component) => component.duration_contract
        ? [[component.type, component.duration_contract]]
        : []),
    ),
  });
}
