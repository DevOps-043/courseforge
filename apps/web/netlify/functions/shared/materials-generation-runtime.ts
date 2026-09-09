import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ComponentType,
  MaterialsGenerationInput,
  MaterialsGenerationOutput,
} from "../../../src/domains/materials/types/materials.types";
import { signBackgroundPayload } from "../../../src/lib/server/background-payload-signature";
import {
  resolveArtifactVideoDurationPolicy,
  isVideoComponentType,
  type VideoDurationContract,
  type VideoDurationPolicy,
} from "../../../src/domains/video-duration/video-duration-policy";
import { validateVideoDurationContent } from "../../../src/domains/video-duration/video-duration-validation";
import {
  buildVideoRepairInstructions,
  shouldUseVideoRepairCandidate,
} from "../../../src/domains/materials/validators/material-video.validators";
import { getFunctionsBaseUrl } from "./bootstrap";
import {
  buildMaterialsGenerationInput,
  findLessonSources,
  findPlanDetails,
  generateWithRetry,
  saveGeneratedComponents,
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
  lessonPlans: LessonPlanRecord[];
  lessonSources: CurationRowRecord[];
  videoDurationPolicy: VideoDurationPolicy;
}

type MaterialsGenerationResult = Awaited<ReturnType<typeof generateWithRetry>>;

async function repairInvalidGeneratedVideos(params: {
  componentTypes?: string[];
  input: MaterialsGenerationInput;
  logPrefix: string;
  models: string[];
  modelRuntimeConfig: MaterialsModelRuntimeConfig;
  organizationId?: string | null;
  result: MaterialsGenerationResult;
  supabase: SupabaseClient;
}): Promise<MaterialsGenerationResult> {
  const {
    componentTypes,
    input,
    logPrefix,
    models,
    modelRuntimeConfig,
    organizationId,
    result,
    supabase,
  } = params;
  if (!result.success) return result;

  let repairedOutput: MaterialsGenerationOutput = result.content;
  for (const component of input.lesson.components) {
    if (!component.duration_contract || !isVideoComponentType(component.type)) {
      continue;
    }
    if (componentTypes && !componentTypes.includes(component.type)) {
      continue;
    }

    const initialContent = repairedOutput.components[component.type];
    if (!initialContent) continue;
    const initialValidation = validateVideoDurationContent(
      initialContent,
      component.duration_contract,
    );
    if (initialValidation.valid) continue;

    console.warn(
      `${logPrefix} Repairing ${component.type} after ${initialValidation.issues.length} duration validation issue(s)`,
    );
    const repairInput: MaterialsGenerationInput = {
      ...input,
      fix_instructions: buildVideoRepairInstructions(
        component.type,
        component.duration_contract,
        initialValidation.issues.map(
          (issue) => `${issue.code}: ${issue.message}`,
        ),
      ),
      lesson: {
        ...input.lesson,
        components: [component],
      },
    };
    const repairResult = await generateWithRetry(
      repairInput,
      `${logPrefix} [Video repair]`,
      models,
      modelRuntimeConfig,
      supabase,
      [component.type],
      organizationId,
    );
    if (!repairResult.success) {
      console.warn(`${logPrefix} ${component.type} repair request failed: ${repairResult.error}`);
      continue;
    }

    const candidateContent = repairResult.content.components[component.type];
    if (!candidateContent) {
      console.warn(`${logPrefix} ${component.type} repair returned no component`);
      continue;
    }
    const candidateValidation = validateVideoDurationContent(
      candidateContent,
      component.duration_contract,
    );
    const candidateIsBetter = shouldUseVideoRepairCandidate(
      initialValidation,
      candidateValidation,
    );
    if (!candidateIsBetter) {
      console.warn(
        `${logPrefix} ${component.type} repair is still invalid; preserving the original for QA`,
      );
      continue;
    }

    repairedOutput = {
      ...repairedOutput,
      components: {
        ...repairedOutput.components,
        [component.type]: candidateContent,
      },
      source_refs_used: Array.from(new Set([
        ...(repairedOutput.source_refs_used || []),
        ...(repairResult.content.source_refs_used || []),
      ])),
    };
    console.log(
      `${logPrefix} ${component.type} repair ${candidateValidation.valid ? "passed" : `reduced issues to ${candidateValidation.issues.length}`}`,
    );
  }

  return { success: true as const, content: repairedOutput };
}

export function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function loadLessonPlans(
  supabase: SupabaseClient,
  artifactId: string,
): Promise<LessonPlanRecord[]> {
  const { data: planRecord } = await supabase
    .from("instructional_plans")
    .select("lesson_plans")
    .eq("artifact_id", artifactId)
    .single();

  return (planRecord?.lesson_plans || []) as LessonPlanRecord[];
}

export async function loadAptaSources(
  supabase: SupabaseClient,
  artifactId: string,
): Promise<CurationRowRecord[]> {
  const { data: curationRecord } = await supabase
    .from("curation")
    .select("id")
    .eq("artifact_id", artifactId)
    .single();

  if (!curationRecord) {
    return [];
  }

  const { data: rows } = await supabase
    .from("curation_rows")
    .select("*")
    .eq("curation_id", curationRecord.id)
    .eq("apta", true);

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

  return {
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
  const url = `${getFunctionsBaseUrl()}${MATERIALS_FUNCTION_PATH}`;
  console.log(`${logPrefix} Triggering next at: ${url}`);
  const signedBody = JSON.stringify(
    signBackgroundPayload({ materialsId, artifactId, mode: "process-next" }),
  );

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

    // Fallback local execution when not running Netlify CLI locally (ECONNREFUSED on port 8888)
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
  await supabase
    .from("material_lessons")
    .update({
      state,
      updated_at: new Date().toISOString(),
      ...extras,
    })
    .eq("id", lessonId);
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
  result: Awaited<ReturnType<typeof generateWithRetry>>;
  iterationNumber: number;
  logPrefix: string;
  onlyTypes?: string[];
  durationContractsByType?: Partial<Record<ComponentType, VideoDurationContract>>;
}) {
  const { supabase, lessonId, lessonTitle, result, iterationNumber, logPrefix, onlyTypes, durationContractsByType } =
    params;

  if (result.success) {
    await saveGeneratedComponents(
      supabase,
      lessonId,
      result.content,
      iterationNumber,
      logPrefix,
      onlyTypes,
      durationContractsByType,
    );
    await setLessonState(supabase, lessonId, "GENERATED");
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

  const initialResult = await generateWithRetry(
    input,
    logPrefix,
    models,
    modelRuntimeConfig,
    supabase,
    componentTypes,
    organizationId,
  );
  const result = await repairInvalidGeneratedVideos({
    componentTypes,
    input,
    logPrefix,
    models,
    modelRuntimeConfig,
    organizationId,
    result: initialResult,
    supabase,
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
