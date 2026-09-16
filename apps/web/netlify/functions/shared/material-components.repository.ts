import type { SupabaseClient } from "@supabase/supabase-js";
import type { ComponentType, MaterialsGenerationOutput } from "../../../src/domains/materials/types/materials.types";
import type { VideoDurationContract } from "../../../src/domains/video-duration/video-duration-policy";
import { buildMaterialComponentWrites } from "../../../src/domains/materials/generation/material-component-write";

export async function commitGeneratedLesson(
  supabase: SupabaseClient,
  lessonId: string,
  content: MaterialsGenerationOutput,
  iteration: number,
  logPrefix: string,
  onlyTypes: string[] | undefined,
  durationContractsByType: Partial<Record<ComponentType, VideoDurationContract>> = {},
  execution: { materialsId: string; version: number; success: boolean; error?: string },
) {
  const rows = buildMaterialComponentWrites({
    lessonId, content, iteration, onlyTypes, durationContractsByType,
    generatedAt: new Date().toISOString(),
  });
  const { data, error } = await supabase.rpc("commit_material_generation", {
    p_materials_id: execution.materialsId,
    p_version: execution.version,
    p_lesson_id: lessonId,
    p_iteration: iteration,
    p_rows: rows,
    p_success: execution.success,
    p_error: execution.error || null,
  });
  if (error) throw error;
  if (data === true) console.log(`${logPrefix} Saved ${rows.length} validated component(s)`);
  return data === true;
}
