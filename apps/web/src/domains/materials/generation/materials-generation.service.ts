import { isVideoComponentType, type VideoComponentType, type VideoDurationContract } from "../../video-duration/video-duration-policy";
import type { MaterialsGenerationInput, MaterialsGenerationOutput } from "../types/materials.types";
import type { VideoGenerationResult } from "./video-generation.service";

export type MaterialsGenerationResult = {
  success: true;
  content: MaterialsGenerationOutput;
} | {
  success: false;
  error: string;
  content?: MaterialsGenerationOutput;
};

/** Keep each video independent of the other materials and preserve successful partial output. */
export async function generateMaterialsByComponent(params: {
  input: MaterialsGenerationInput;
  generateStandard: (input: MaterialsGenerationInput) => Promise<MaterialsGenerationResult>;
  generateVideo: (componentType: VideoComponentType, contract: VideoDurationContract) => Promise<VideoGenerationResult>;
}): Promise<MaterialsGenerationResult> {
  const { input, generateStandard, generateVideo } = params;
  const output: MaterialsGenerationOutput = { components: {}, source_refs_used: [] };
  const errors: string[] = [];
  if (!input.lesson.components.length) return { success: false, error: "No hay componentes seleccionados para generar." };
  const standardComponents = input.lesson.components.filter((component) => !isVideoComponentType(component.type));
  if (standardComponents.length) {
    try {
      const standard = await generateStandard({ ...input, lesson: { ...input.lesson, components: standardComponents } });
      if (standard.content) {
        output.components = standard.content.components;
        output.source_refs_used = [...standard.content.source_refs_used];
      }
      if (!standard.success) errors.push(standard.error);
    } catch {
      errors.push("MATERIALS/GENERATION_FAILED: No se pudieron generar los componentes no audiovisuales. Reintenta los pendientes.");
    }
  }
  for (const component of input.lesson.components) {
    if (!isVideoComponentType(component.type)) continue;
    if (!component.duration_contract) {
      errors.push(`${component.type}/MISSING_DURATION_CONTRACT: Falta el contrato de duración.`);
      continue;
    }
    try {
      const video = await generateVideo(component.type, component.duration_contract);
      if (video.success) {
        output.components[component.type] = video.content;
        output.source_refs_used.push(...video.sourceRefs);
      } else errors.push(video.error);
    } catch {
      errors.push(`${component.type}/GENERATION_FAILED: No se pudo completar este video. Se conservaron los demás componentes.`);
    }
  }
  output.source_refs_used = [...new Set(output.source_refs_used)];
  return errors.length
    ? { success: false, error: errors.join(" | "), content: output }
    : { success: true, content: output };
}
