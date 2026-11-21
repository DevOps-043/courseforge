import { loadAptaSources } from "./materials-source-context";
import { readAcademyScope } from "../../../src/domains/course-delivery/services/academy-scope.server";
import { assertAcademyPlans, assertAcademyLesson } from "../../../src/domains/course-delivery/lib/academy-scope";
import { prepareCourseGeneration, attestCourseGeneration } from "../../../src/domains/course-sources/course-source-generation.service";
import { CourseSourceError, sourceGroundingFailure } from "../../../src/domains/course-sources/course-source-error";
import { MATERIAL_GROUNDING_CORRECTION, SOURCE_GENERATION_LIMITS } from "../../../src/domains/course-sources/course-source-generation";
import { createOperationalLogger } from "../../../src/lib/server/operational-logger";
import { readCourseSourcePolicy } from "../../../src/domains/course-sources/course-source-settings";
import { readSyllabusWithOrigin } from "../../../src/domains/syllabus/services/syllabus-workflow-read";
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
  documentary?: boolean;
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
  const scope = await readAcademyScope(supabase, artifactId);
  assertAcademyPlans(scope, planRecord?.lesson_plans);
  return (planRecord?.lesson_plans || []) as LessonPlanRecord[];
}

export async function loadMaterialsGenerationContext(
  supabase: SupabaseClient,
  artifactId: string,
): Promise<MaterialsGenerationContext> {
  const [lessonPlans, lessonSources, artifactResult, syllabusResult, sourceSettings] = await Promise.all([
    loadLessonPlans(supabase, artifactId),
    loadAptaSources(supabase, artifactId),
    supabase
      .from("artifacts")
      .select("generation_metadata")
      .eq("id", artifactId)
      .single(),
    readSyllabusWithOrigin(supabase, artifactId, "route,state"),
    readCourseSourcePolicy(supabase, artifactId),
  ]);
  if (artifactResult.error) throw artifactResult.error;
  if (syllabusResult.error) throw syllabusResult.error;
  if (!syllabusResult.data) throw new Error("Syllabus not found");
  if (syllabusResult.data.input_mode === "PROVIDED_SYLLABUS") {
    const { data: dependencies, error } = await supabase.from("instructional_plans").select("syllabus_content_version").eq("artifact_id", artifactId).single();
    const { data: curation, error: curationError } = await supabase.from("curation").select("syllabus_content_version").eq("artifact_id", artifactId).single();
    if (error) throw error;
    if (curationError) throw curationError;
    if (syllabusResult.data.state !== "STEP_APPROVED" || dependencies?.syllabus_content_version !== syllabusResult.data.content_version || curation?.syllabus_content_version !== syllabusResult.data.content_version) {
      throw new Error("El plan o las fuentes no corresponden al temario aprobado vigente.");
    }
  }
  return {
    documentary: Boolean(sourceSettings && sourceSettings.policy !== "WEB_ONLY"),
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
  const { data: complete, error } = await supabase.rpc("finish_material_generation", { p_materials_id: materialsId, p_version: version });
  if (error) throw error;
  return complete === true;
}

export async function processGenerationResult(params: {
  execution: { materialsId: string; version: number; academyRouteHash?: string | null };
  supabase: SupabaseClient;
  lessonId: string;
  lessonTitle: string;
  result: MaterialsGenerationResult;
  iterationNumber: number;
  logPrefix: string;
  onlyTypes?: string[];
  durationContractsByType?: Partial<Record<ComponentType, VideoDurationContract>>;
  sourceEvidenceByType?: Record<string, string>;
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
      { ...params.execution, success: result.success, error: result.success ? undefined : result.error, sourceEvidenceByType: params.sourceEvidenceByType },
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

  const academy = await readAcademyScope(supabase, generationContext.artifactId, organizationId || undefined);
  assertAcademyPlans(academy, generationContext.lessonPlans);
  assertAcademyLesson(academy, lesson.lesson_id);
  const sourceContext = generationContext.documentary ? await prepareCourseGeneration(supabase, generationContext.artifactId, "MATERIALS", lesson.lesson_id, undefined, `${params.execution.materialsId}:${params.execution.version}:${lesson.id}:${iterationNumber || lesson.iteration_count || 1}`, { plans: generationContext.lessonPlans }) : null;
  const lessonSources = findLessonSources(generationContext.lessonSources, lesson);
  const planDetails = findPlanDetails(generationContext.lessonPlans, lesson);
  if (sourceContext && (!planDetails || (lesson.oa_text && planDetails.oa_text && lesson.oa_text !== planDetails.oa_text) || (lesson.expected_components || []).some(type => !planDetails.components?.some(component => component.type === type)))) {
    throw new Error("El plan de esta lección cambió. Actualiza sus materiales antes de regenerar componentes documentales.");
  }
  const currentIteration = iterationNumber || lesson.iteration_count || 1;
  const requiredSources = getLessonSourceRequirement(planDetails).requiredSources;
  if (!sourceContext && generationContext.requiresSources && new Set(lessonSources.map((source) => source.source_ref)).size < requiredSources) {
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
  if (sourceContext) {
    input.course_source_snapshot_id = sourceContext.snapshotId;
    input.sources = sourceContext.sources.map(source => ({ id: source.id, source_title: source.title,
      source_ref: source.kind === "DOCUMENT" ? `document:${source.id}` : source.url!,
      source_excerpt: source.text, cobertura_completa: true, source_locator: source.locator, source_kind: source.kind }));
    input.requires_sources = true;
    input.required_source_count = 1;
  }

  let selectedTypes = componentTypes?.length ? componentTypes : undefined;
  let savedComponents: MaterialComponentRecord[] = [];
  if (selectedTypes?.length || params.resumePendingOnly) {
    const { data: saved, error } = await supabase.from("material_components")
      .select("id, type, content, assets, source_refs, validation_status, validation_errors, iteration_number")
      .eq("material_lesson_id", lesson.id);
    if (error) throw error;
    savedComponents = saved || [];
    if (!selectedTypes?.length) selectedTypes = selectMaterialRetryTypes(input, savedComponents);
    const planned = new Set<string>(input.lesson.components.map(component => component.type));
    if (academy.routeHash && !componentTypes?.length) selectedTypes = [...new Set([...(selectedTypes || []), ...savedComponents.filter(component => planned.has(component.type) && component.assets?.delivery_route_hash !== academy.routeHash).map(component => component.type)])];
    if (sourceContext && params.resumePendingOnly && !componentTypes?.length) {
      const current = await supabase.rpc("current_course_source_component_ids", { p_artifact: generationContext.artifactId });
      if (current.error) throw new Error("No se pudo verificar qué componentes conservan respaldo documental.");
      const valid = new Set<string>(current.data || []);
      selectedTypes = [...new Set([...(selectedTypes || []), ...savedComponents.filter(component => planned.has(component.type) && !valid.has(component.id)).map(component => component.type)])];
    }
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
  const reviewReserve = sourceContext ? Math.min(SOURCE_GENERATION_LIMITS.timeoutMs, input.lesson.components.length * 30_000) : 0;
  const generate = (generationInput: typeof input, generationDeadline: number) => generateMaterialsByComponent({
    input: generationInput,
    generateStandard: (standardInput) => generateWithRetry(
      standardInput, logPrefix, models, modelRuntimeConfig, supabase,
      standardInput.lesson.components.map((component) => component.type), organizationId,
      generationDeadline, generationContext.artifactId, lesson.id,
    ),
    generateVideo: (componentType, contract) => generateAndTraceMaterialVideo({
      supabase, input: generationInput, componentType, contract, models, modelRuntimeConfig, organizationId,
      artifactId: generationContext.artifactId, lessonId: lesson.id, deadlineMs: generationDeadline,
    }),
  });
  // Resume can finish through validation alone, without rewriting stored components.
  let result: MaterialsGenerationResult = selectedTypes?.length === 0
    ? { success: true, content: { components: {}, source_refs_used: [] } }
    : await generate(input, deadlineMs - reviewReserve - (sourceContext ? 5000 : 0));
  const sourceEvidenceByType: Record<string, string> = {};
  if (sourceContext && result.content) {
    const groundingErrors: string[] = [];
    const content = result.content;
    const components = Object.entries(content.components);
    for (const [index, [key, component]] of components.entries()) {
      const type = key as ComponentType;
      const now = Date.now();
      const reviewDeadline = now + Math.floor((deadlineMs - 5000 - now) / (components.length - index));
      try {
        let receipt: string | null;
        try {
          receipt = await attestCourseGeneration(supabase, sourceContext, component, models, reviewDeadline);
        } catch (failure) {
          const correctionDeadline = reviewDeadline - 30_000;
          if (!(failure instanceof CourseSourceError) || failure.groundingReason !== "UNSUPPORTED_OUTPUT" || correctionDeadline - Date.now() < 30_000) throw failure;
          const correction = await generate({
            ...input,
            lesson: { ...input.lesson, components: input.lesson.components.filter(plannedComponent => plannedComponent.type === type) },
            fix_instructions: [input.fix_instructions, MATERIAL_GROUNDING_CORRECTION].filter(Boolean).join("\n"),
          }, correctionDeadline);
          const corrected = correction.content?.components[type];
          if (!correction.success || !corrected) throw failure;
          receipt = await attestCourseGeneration(supabase, sourceContext, corrected, models, reviewDeadline);
          content.components = { ...content.components, [type]: corrected };
          content.source_refs_used = [...new Set([...content.source_refs_used, ...correction.content.source_refs_used])];
        }
        if (receipt) sourceEvidenceByType[type] = receipt;
      } catch (error) {
        const diagnostic = sourceGroundingFailure(error);
        createOperationalLogger("materiales.respaldo").error("componente_rechazado", diagnostic, {
          artifactId: generationContext.artifactId, lessonId: lesson.id, componentType: type,
          snapshotId: sourceContext.snapshotId, remainingMs: Math.max(0, deadlineMs - Date.now()),
        });
        delete content.components[type];
        groundingErrors.push(`${type} [${diagnostic.code}]: ${diagnostic.message} Reintenta el componente pendiente tras revisar el diagnóstico.`);
      }
    }
    if (groundingErrors.length) result = { success: false, content: result.content, error: [...(result.success ? [] : [result.error]), ...groundingErrors].join(" | ") };
  }
  if (result.success) {
    const validation = validateGeneratedMaterialLesson(completeInput, result.content, savedComponents);
    if (validation.errors.length) {
      result = { success: false, content: result.content, error: validation.errors.join(" | ") };
    }
  }
  const currentAcademy = await readAcademyScope(supabase, generationContext.artifactId, organizationId || undefined);
  if (currentAcademy.routeHash !== academy.routeHash) throw new Error("El recorrido cambió durante la generación. No se guardaron los materiales de Academy.");
  assertAcademyLesson(currentAcademy, lesson.lesson_id);
  return processGenerationResult({
    execution: { ...params.execution, academyRouteHash: academy.routeHash },
    supabase,
    lessonId: lesson.id,
    lessonTitle: lesson.lesson_title,
    result,
    sourceEvidenceByType,
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
