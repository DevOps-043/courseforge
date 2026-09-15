import type { SupabaseClient } from "@supabase/supabase-js";
import type { ComponentType, MaterialsGenerationOutput } from "../../../src/domains/materials/types/materials.types";
import type { VideoDurationContract } from "../../../src/domains/video-duration/video-duration-policy";
import { buildMaterialComponentWrites } from "../../../src/domains/materials/generation/material-component-write";

export async function saveGeneratedComponents(
  supabase: SupabaseClient,
  lessonId: string,
  content: MaterialsGenerationOutput,
  iteration: number,
  logPrefix: string,
  onlyTypes?: string[],
  durationContractsByType: Partial<Record<ComponentType, VideoDurationContract>> = {},
) {
  const rows = buildMaterialComponentWrites({
    lessonId, content, iteration, onlyTypes, durationContractsByType,
    generatedAt: new Date().toISOString(),
  });
  if (!rows.length) return;
  // The unique (material_lesson_id, type) index makes replacement atomic and preserves IDs.
  const { error } = await supabase.from("material_components").upsert(rows, {
    onConflict: "material_lesson_id,type",
  });
  if (error) throw error;
  console.log(`${logPrefix} Saved ${rows.length} validated component(s)`);
}
