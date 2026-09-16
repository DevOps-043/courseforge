import type { VideoDurationContract } from "../../video-duration/video-duration-policy";
import { isVideoComponentType } from "../../video-duration/video-duration-policy";
import type { ComponentType, MaterialsGenerationOutput } from "../types/materials.types";
import { validateMaterialVideoComponent } from "../validators/material-video.validators";

/** Validate the entire write set before a single atomic upsert. */
export function buildMaterialComponentWrites(params: {
  lessonId: string;
  content: MaterialsGenerationOutput;
  iteration: number;
  generatedAt: string;
  onlyTypes?: string[];
  durationContractsByType: Partial<Record<ComponentType, VideoDurationContract>>;
}) {
  return Object.entries(params.content.components).map(([type, content]) => {
    if (!content || (params.onlyTypes && !params.onlyTypes.includes(type))) {
      throw new Error("MATERIALS_COMPONENT_MISMATCH: Se intentó guardar un componente vacío o no solicitado.");
    }
    const contract = params.durationContractsByType[type as ComponentType];
    const validation = validateMaterialVideoComponent(type, content, contract);
    if (isVideoComponentType(type) && validation.status !== "PASS") {
      throw new Error(`${type}/VIDEO_VALIDATION_FAILED: ${validation.errors.join(" | ") || "Falta un contrato de duración válido."}`);
    }
    return {
      material_lesson_id: params.lessonId,
      type,
      content,
      source_refs: params.content.source_refs_used,
      assets: contract ? {
        assembly_target_duration_seconds: contract.targetDurationSeconds,
        video_duration_contract: contract,
      } : {},
      validation_status: validation.status,
      validation_errors: validation.errors,
      iteration_number: params.iteration,
      generated_at: params.generatedAt,
    };
  });
}
