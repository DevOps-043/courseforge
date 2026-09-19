import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePrompts, type ResolvedPrompts } from "../../../src/shared/config/prompts/prompt-resolver.service";
import { generateVideoInStages, type VideoGenerationResult } from "../../../src/domains/materials/generation/video-generation.service";
import type { MaterialsGenerationInput } from "../../../src/domains/materials/types/materials.types";
import type { VideoComponentType, VideoDurationContract } from "../../../src/domains/video-duration/video-duration-policy";
import { createOperationalLogger } from "../../../src/lib/server/operational-logger";
import { createMaterialsModelRequest, type MaterialsModelRuntimeConfig } from "./materials-model-client";

export async function generateAndTraceMaterialVideo(params: {
  supabase: SupabaseClient;
  artifactId: string;
  lessonId: string;
  organizationId?: string | null;
  input: MaterialsGenerationInput;
  componentType: VideoComponentType;
  contract: VideoDurationContract;
  models: string[];
  modelRuntimeConfig: MaterialsModelRuntimeConfig;
  deadlineMs?: number;
}): Promise<VideoGenerationResult> {
  const logger = createOperationalLogger("materials-video-generation", {
    artifactId: params.artifactId, lessonId: params.lessonId, componentType: params.componentType,
  });
  let prompts: ResolvedPrompts | undefined;
  let result: VideoGenerationResult;
  try {
    prompts = await resolvePrompts(params.supabase, [params.componentType], params.organizationId);
    result = await generateVideoInStages({
      ...params,
      prompts,
      request: createMaterialsModelRequest(params.modelRuntimeConfig, {
        supabase: params.supabase,
        context: {
          artifactId: params.artifactId,
          attempt: params.input.iteration_number,
          lessonId: params.lessonId,
          operation: `generate_${params.componentType.toLowerCase()}`,
          organizationId: params.organizationId,
          pipelineStep: "MATERIALS",
        },
      }),
    });
  } catch (error) {
    logger.error("generation_failed", error);
    result = { success: false, error: `${params.componentType}/GENERATION_FAILED: No se pudo completar la generación del video.`, attempts: [] };
  }
  const trace = {
    version: 1,
    componentType: params.componentType,
    status: result.success ? "PASS" : "FAIL",
    targetDurationSeconds: params.contract.targetDurationSeconds,
    promptSources: prompts?.promptSources,
    promptVersions: prompts?.promptVersions,
    attempts: result.attempts,
  };
  logger.info("generation_completed", trace);
  try {
    const { error } = await params.supabase.from("pipeline_events").insert({
      artifact_id: params.artifactId,
      event_type: "MATERIALS_VIDEO_GENERATION",
      step_id: "MATERIALS",
      entity_id: params.lessonId,
      entity_type: "material_lesson",
      event_data: trace,
    });
    if (error) logger.error("trace_persistence_failed", error);
  } catch (error) {
    logger.error("trace_persistence_failed", error);
  }
  return result;
}
