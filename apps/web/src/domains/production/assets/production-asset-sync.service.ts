import type { SupabaseClient } from "@supabase/supabase-js";
import type { MaterialAssets } from "../../materials/types/materials.types";

export async function syncBrollPromptsToMaterialComponent(params: {
  componentId: string;
  promptsText: string;
  supabase: SupabaseClient;
}) {
  const { componentId, promptsText, supabase } = params;

  const { data: component, error: selectError } = await supabase
    .from("material_components")
    .select("assets")
    .eq("id", componentId)
    .single();

  if (selectError) {
    throw selectError;
  }

  const currentAssets = (component?.assets || {}) as MaterialAssets;
  const updatedAssets: MaterialAssets = {
    ...currentAssets,
    b_roll_prompts: promptsText,
    updated_at: new Date().toISOString(),
  };

  const { error: updateError } = await supabase
    .from("material_components")
    .update({ assets: updatedAssets })
    .eq("id", componentId);

  if (updateError) {
    throw updateError;
  }

  return updatedAssets;
}
