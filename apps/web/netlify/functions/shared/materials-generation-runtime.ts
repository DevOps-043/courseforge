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
import { commitGeneratedLesson } from "./material-components.repository";
import { getLessonSourceRequirement } from "../../../src/domains/curation/lib/lesson-source-requirement";
import { getFunctionsBaseUrl } from "./bootstrap";
import { selectMaterialRetryTypes } from "./materials-retry-selection";
import { validateGeneratedMaterialLesson, type MaterialComponentRecord } from "./materials-lesson-validation";
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
  requiresSources: boolean;
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
  return (rows || []).filter((row) => !row.validation_report?.status || row.validation_report.status === "valid") as CurationRowRecord[];
}

export async function loadMaterialsGenerationContext(
  supabase: SupabaseClient,
  artifactId: string,
): Promise<MaterialsGenerationContext> {
  const [lessonPlans, lessonSources, artifactResult, syllabusResult] = await Promise.all([
    loadLessonPlans(supabase, artifactId),
    loadAptaSources(supabase, artifactId),
    supabase
      .from("artifacts")
      .select("generation_metadata")
      .eq("id", artifactId)
      .single(),
    supabase.from("syllabus").select("route").eq("artifact_id", artifactId).single(),
  ]);
  if (artifactResult.error) throw artifactResult.error;
  if (syllabusResult.error) throw syllabusResult.error;
  return {
    artifactId,
    lessonPlans,
    lessonSources,
    requiresSources: syllabusResult.data.route !== "B_NO_SOURCE",
    videoDurationPolicy: resolveArtifactVideoDurationPolicy(
      artifactResult.data?.generation_metadata,
    ),
  };
}

export async function triggerNextLesson(
  materialsId: string,
  artifactId: string,
  logPrefix: string,
  version: number,
  localFallback?: (signedBody: string) => Promise<void>,
) {
  const triggerTimeoutMilliseconds = 10_000;
  const signedBody = JSON.stringify(
    signBackgroundPayload({ materialsId, artifactId, version, mode: "process-next" }),
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

    throw error;
  }
}

export async function touchMaterialsRecord(
  supabase: SupabaseClient,
  materialsId: string,
) {
  const { error } = await supabase
    .from("materials")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", materialsId);
  if (error) throw error;
}

export async function markMaterialsValidating(
  supabase: SupabaseClient,
  materialsId: string,
  version: number,
) {
  const { data: lessons, error: lessonsError } = await supabase.from("material_lessons")
    .select("state").eq("materials_id", materialsId);
  if (lessonsError) throw lessonsError;
  const complete = Boolean(lessons?.length) && lessons!.every((lesson) =>
    ["GENERATED", "APPROVABLE"].includes(lesson.state));
  const { data: updated, error } = await supabase
    .from("materials")
    .update({ state: complete ? "PHASE3_VALIDATING" : "PHASE3_NEEDS_FIX", updated_at: new Date().toISOString() })
    .eq("id", materialsId).eq("version", version).eq("state", "PHASE3_GENERATING").select("id").maybeSingle();
  if (error) throw error;
  return complete && Boolean(updated);
}

export async function processGenerationResult(params: {
  execution: { materialsId: string; version: number };
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

  const committed = await commitGeneratedLesson(
      supabase,
      lessonId,
      result.content || { components: {}, source_refs_used: [] },
      iterationNumber,
      logPrefix,
      onlyTypes || Object.keys(result.content?.components || {}),
      durationContractsByType,
      { ...params.execution, success: result.success, error: result.success ? undefined : result.error },
    );
  if (!committed) return { success: false as const, superseded: true };
  if (result.success) {
    console.log(`${logPrefix} Generated ${lessonTitle}`);
    return { success: true as const };
  }

  console.log(`${logPrefix} Failed ${lessonTitle}: ${result.error}`);
  return { success: false as const, error: result.error };
}

export async function generateLessonMaterials(params: {
  execution: { materialsId: string; version: number };
  supabase: SupabaseClient;
  lesson: MaterialLessonRecord;
  generationContext: MaterialsGenerationContext;
  organizationId?: string | null;
  logPrefix: string;
  fixInstructions?: string;
  iterationNumber?: number;
  /** If set, only regenerate these component types (partial regen). */
  componentTypes?: string[];
  resumePendingOnly?: boolean;
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
  const requiredSources = getLessonSourceRequirement(planDetails).requiredSources;
  if (generationContext.requiresSources && new Set(lessonSources.map((source) => source.source_ref)).size < requiredSources) {
    return processGenerationResult({
      supabase, lessonId: lesson.id, lessonTitle: lesson.lesson_title, iterationNumber: currentIteration,
      logPrefix, execution: params.execution,
      result: { success: false, error: `Fuentes insuficientes para la lección (${lessonSources.length}/${requiredSources}). Completa la curaduría antes de generar materiales.` },
    });
  }
  const input = buildMaterialsGenerationInput({
    lesson,
    planDetails,
    lessonSources,
    iterationNumber: currentIteration,
    fixInstructions,
    videoDurationPolicy: generationContext.videoDurationPolicy,
  });
  input.requires_sources = generationContext.requiresSources;
  input.required_source_count = generationContext.requiresSources
    ? requiredSources
    : 0;

  let selectedTypes = componentTypes;
  let savedComponents: MaterialComponentRecord[] = [];
  if (selectedTypes?.length || (params.resumePendingOnly && currentIteration > 1)) {
    const { data: saved, error } = await supabase.from("material_components")
      .select("id, type, content, assets, source_refs, validation_status, validation_errors, iteration_number")
      .eq("material_lesson_id", lesson.id);
    if (error) throw error;
    savedComponents = saved || [];
    if (!selectedTypes?.length) selectedTypes = selectMaterialRetryTypes(input, savedComponents);
  }
  const completeInput = { ...input, lesson: { ...input.lesson } };
  if (selectedTypes && selectedTypes.length > 0) {
    // Restrict input.lesson.components to only the requested types for partial regen
    input.lesson.components = input.lesson.components.filter(
      (c) => selectedTypes.includes(c.type as string),
    );
    console.log(`${logPrefix} Partial regen: ${selectedTypes.join(", ")}`);
  }

  const deadlineMs = Date.now() + VIDEO_GENERATION_LIMITS.lessonTimeoutMs;
  let result = await generateMaterialsByComponent({
    input,
    generateStandard: (standardInput) => generateWithRetry(
      standardInput, logPrefix, models, modelRuntimeConfig, supabase,
      standardInput.lesson.components.map((component) => component.type), organizationId,
      deadlineMs,
      generationContext.artifactId,
      lesson.id,
    ),
    generateVideo: (componentType, contract) => generateAndTraceMaterialVideo({
      supabase, input, componentType, contract, models, modelRuntimeConfig, organizationId,
      artifactId: generationContext.artifactId,
      lessonId: lesson.id,
      deadlineMs,
    }),
  });
  if (result.success) {
    const validation = validateGeneratedMaterialLesson(completeInput, result.content, savedComponents);
    if (validation.errors.length) {
      result = { success: false, content: result.content, error: validation.errors.join(" | ") };
    }
  }
  return processGenerationResult({
    execution: params.execution,
    supabase,
    lessonId: lesson.id,
    lessonTitle: lesson.lesson_title,
    result,
    iterationNumber: input.iteration_number,
    logPrefix,
    onlyTypes: selectedTypes?.length ? selectedTypes : undefined,
    durationContractsByType: Object.fromEntries(
      input.lesson.components.flatMap((component) => component.duration_contract
        ? [[component.type, component.duration_contract]]
        : []),
    ),
  });
}
