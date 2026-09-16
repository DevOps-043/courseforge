import type { SupabaseClient } from "@supabase/supabase-js";
import type { MaterialAssets } from "../../materials/types/materials.types";

export async function syncBrollPromptsToMaterialComponent(params: {
  componentId: string;
  promptsText: string;
  slideDeckSpec?: Record<string, unknown>;
  supabase: SupabaseClient;
}) {
  const { componentId, promptsText, slideDeckSpec, supabase } = params;

  const { data: component, error: selectError } = await supabase
    .from("material_components")
    .select("assets")
    .eq("id", componentId)
    .single();

  if (selectError) {
    throw selectError;
  }

  const currentAssets = (component?.assets || {}) as MaterialAssets;
  const preparedSlides = slideDeckSpec
    ? {
        ...(currentAssets.slides || {}),
        prepared_at: new Date().toISOString(),
        prepared_from_storyboard: true,
        prepared_slide_count: Array.isArray(slideDeckSpec.slides)
          ? slideDeckSpec.slides.length
          : undefined,
        prepared_spec: slideDeckSpec,
      }
    : currentAssets.slides;
  const assetsPatch: Partial<MaterialAssets> = {
    b_roll_prompts: promptsText,
    ...(preparedSlides ? { slides: preparedSlides } : {}),
    updated_at: new Date().toISOString(),
  };

  const { data: updatedAssets, error: updateError } = await supabase.rpc(
    "patch_material_component_assets",
    { p_component_id: componentId, p_assets_patch: assetsPatch },
  );

  if (updateError) {
    throw updateError;
  }

  return updatedAssets as MaterialAssets;
}
