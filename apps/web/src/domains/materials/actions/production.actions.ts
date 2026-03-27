"use server";

import { getErrorMessage } from "@/lib/errors";
import { callBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { markDownstreamDirtyAction } from "@/lib/server/pipeline-dirty-actions";
import { createClient } from "@/utils/supabase/server";
import type {
  MaterialAssets,
  ProductionDodChecklist,
  ProductionStatus,
  StoryboardItem,
} from "../types/materials.types";

interface ProductionArtifactRelation {
  course_id?: string | null;
}

interface ProductionMaterialsRelation {
  artifact_id?: string | null;
  artifacts?: ProductionArtifactRelation | ProductionArtifactRelation[] | null;
}

interface ProductionLessonRelation {
  lesson_id: string;
  lesson_title: string;
  materials?: ProductionMaterialsRelation | ProductionMaterialsRelation[] | null;
  module_id?: string | null;
}

interface ProductionComponentRecord {
  assets?: MaterialAssets | null;
  material_lesson_id?: string | null;
  material_lessons?: ProductionLessonRelation | ProductionLessonRelation[] | null;
  type: string;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | undefined {
  if (!value) {
    return undefined;
  }

  return Array.isArray(value) ? value[0] : value;
}

function buildDodChecklist(
  assets: Partial<MaterialAssets>,
): ProductionDodChecklist {
  return {
    has_slides_url: Boolean(assets.slides_url),
    has_video_url: Boolean(assets.video_url),
    has_screencast_url: Boolean(assets.screencast_url),
    has_b_roll_prompts: Boolean(assets.b_roll_prompts),
    has_final_video_url: Boolean(assets.final_video_url),
  };
}

function resolveProductionStatus(
  componentType: string,
  dodChecklist: ProductionDodChecklist,
): ProductionStatus {
  const needsSlides =
    componentType === "VIDEO_THEORETICAL" || componentType === "VIDEO_GUIDE";
  const needsScreencast =
    componentType === "DEMO_GUIDE" || componentType === "VIDEO_GUIDE";
  const needsVideo = componentType.includes("VIDEO");
  const needsFinalVideo = componentType.includes("VIDEO");

  const hasRequiredSlides = !needsSlides || dodChecklist.has_slides_url;
  const hasRequiredScreencast =
    !needsScreencast || dodChecklist.has_screencast_url;
  const hasRequiredVideo = !needsVideo || dodChecklist.has_video_url;
  const hasRequiredFinalVideo =
    !needsFinalVideo || dodChecklist.has_final_video_url;

  if (
    (hasRequiredSlides &&
      hasRequiredScreencast &&
      hasRequiredVideo &&
      hasRequiredFinalVideo) ||
    dodChecklist.has_final_video_url
  ) {
    return "COMPLETED";
  }

  if (
    dodChecklist.has_slides_url ||
    dodChecklist.has_video_url ||
    dodChecklist.has_screencast_url ||
    dodChecklist.has_b_roll_prompts
  ) {
    return "IN_PROGRESS";
  }

  return "PENDING";
}

function buildGammaDeckId(params: {
  componentType: string;
  currentAssets: Partial<MaterialAssets>;
  lesson?: ProductionLessonRelation;
}) {
  const { componentType, currentAssets, lesson } = params;
  if (currentAssets.gamma_deck_id || !lesson) {
    return currentAssets.gamma_deck_id;
  }

  const materials = firstRelation(lesson.materials);
  const artifact = firstRelation(materials?.artifacts);
  const courseId = artifact?.course_id || "CRS";
  const lessonNumMatch = lesson.lesson_title.match(/^(\d+(\.\d+)*)/);
  const lessonNum = lessonNumMatch
    ? lessonNumMatch[0]
    : `L${lesson.lesson_id.substring(0, 4)}`;

  const typeMap: Record<string, string> = {
    VIDEO_THEORETICAL: "VTH",
    VIDEO_GUIDE: "VGD",
    VIDEO_DEMO: "VDM",
    DEMO_GUIDE: "DG",
    QUIZ: "QZ",
  };
  const typeCode = typeMap[componentType] || "UNK";
  const suffix = Math.random().toString(36).substring(2, 5).toUpperCase();

  return `${courseId}-${lessonNum}-${typeCode}-${suffix}`;
}

function isProductionComplete(assets?: MaterialAssets | null) {
  return assets?.production_status === "COMPLETED";
}

async function getAuthorizedSupabase() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "Unauthorized", supabase, user: null };
  }

  return { error: null, supabase, user };
}

export async function generateVideoPromptsAction(
  componentId: string,
  storyboard: StoryboardItem[],
) {
  const { error, supabase } = await getAuthorizedSupabase();
  if (error) return { success: false, error };

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { success: false, error: "Unauthorized" };

  try {
    const data = await callBackgroundFunctionJson<{ prompts?: string }>(
      "video-prompts-generation",
      {
        componentId,
        storyboard,
        userToken: session.access_token,
      },
      {
        fallbackError: "No se pudieron generar los prompts de video",
        localHandlerLoader: () =>
          import("../../../../netlify/functions/video-prompts-generation"),
      },
    );

    return { success: true, prompts: data.prompts || "" };
  } catch (error: unknown) {
    console.error("[ProductionActions] Error generating prompts:", error);
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function saveMaterialAssetsAction(
  componentId: string,
  assets: Partial<MaterialAssets>,
) {
  const { error: authError, supabase } = await getAuthorizedSupabase();
  if (authError) return { success: false, error: authError };

  const { data: rawComponent } = await supabase
    .from("material_components")
    .select(
      `
        assets, type, material_lesson_id,
        material_lessons (
          lesson_id, lesson_title, module_id,
          materials (
            artifact_id,
            artifacts ( course_id )
          )
        )
      `,
    )
    .eq("id", componentId)
    .single();

  const component = (rawComponent || null) as ProductionComponentRecord | null;
  const currentAssets = (component?.assets || {}) as MaterialAssets;
  const mergedAssets: MaterialAssets = { ...currentAssets, ...assets };
  const componentType = component?.type || "";
  const lesson = firstRelation(component?.material_lessons);
  const materials = firstRelation(lesson?.materials);
  const artifactId = materials?.artifact_id || undefined;
  const dodChecklist = buildDodChecklist(mergedAssets);
  const productionStatus = resolveProductionStatus(componentType, dodChecklist);

  const finalAssets: MaterialAssets = {
    ...mergedAssets,
    gamma_deck_id: buildGammaDeckId({
      componentType,
      currentAssets: mergedAssets,
      lesson,
    }),
    production_status: productionStatus,
    dod_checklist: dodChecklist,
    updated_at: new Date().toISOString(),
  };

  const { error: updateError } = await supabase
    .from("material_components")
    .update({ assets: finalAssets })
    .eq("id", componentId);

  if (updateError) {
    console.error("[ProductionActions] Error saving material assets:", updateError);
    return { success: false, error: updateError.message };
  }

  if (artifactId) {
    await markDownstreamDirtyAction(
      artifactId,
      5,
      "Materiales (assets actualizados)",
    );
    await syncProductionStatusAction(artifactId);
    await logPipelineEventAction(
      artifactId,
      productionStatus === "COMPLETED"
        ? "GO-OP-06_ASSET_COMPLETED"
        : "GO-OP-06_ASSET_UPDATED",
      {
        component_id: componentId,
        component_type: componentType,
        production_status: productionStatus,
        dod_checklist: dodChecklist,
      },
      "GO-OP-06",
      componentId,
      "material_component",
    );
  }

  return { success: true, productionStatus, dodChecklist };
}

export async function syncProductionStatusAction(artifactId: string) {
  const supabase = await createClient();
  const { data: rawComponents, error: componentsError } = await supabase
    .from("material_components")
    .select(
      `
        id, type, assets,
        material_lessons!inner (
          materials!inner (
            artifact_id
          )
        )
      `,
    )
    .eq("material_lessons.materials.artifact_id", artifactId);

  if (componentsError || !rawComponents) {
    console.error(
      "[ProductionActions] Error fetching components for sync:",
      componentsError,
    );
    return { success: false };
  }

  const components = rawComponents as Array<{
    assets?: MaterialAssets | null;
    type: string;
  }>;
  const produceable = components.filter(
    (component) =>
      component.type.includes("VIDEO") || component.type === "DEMO_GUIDE",
  );

  if (produceable.length === 0) return { success: true };

  const total = produceable.length;
  const completed = produceable.filter((component) =>
    isProductionComplete(component.assets),
  ).length;
  const isDone = total > 0 && total === completed;

  const { error: updateError } = await supabase
    .from("artifacts")
    .update({ production_complete: isDone })
    .eq("id", artifactId);

  if (updateError) {
    console.error(
      "[ProductionActions] Error syncing production status:",
      updateError,
    );
    return { success: false };
  }

  return {
    success: true,
    isDone,
    progress: Math.round((completed / total) * 100),
  };
}

export async function logPipelineEventAction(
  artifactId: string,
  eventType: string,
  eventData: Record<string, unknown> = {},
  stepId?: string,
  entityId?: string,
  entityType?: string,
) {
  const { error: authError, supabase, user } = await getAuthorizedSupabase();
  if (authError || !user) return { success: false, error: authError };

  const { error } = await supabase.from("pipeline_events").insert({
    artifact_id: artifactId,
    event_type: eventType,
    event_data: {
      ...eventData,
      triggered_by: user.email || user.id,
      timestamp: new Date().toISOString(),
    },
    step_id: stepId || null,
    entity_id: entityId || null,
    entity_type: entityType || null,
  });

  if (error) {
    console.error("[ProductionActions] Error logging pipeline event:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function updateProductionStatusAction(
  artifactId: string,
  isComplete: boolean,
) {
  const { error: authError, supabase } = await getAuthorizedSupabase();
  if (authError) return { success: false, error: authError };

  const { error } = await supabase
    .from("artifacts")
    .update({ production_complete: isComplete })
    .eq("id", artifactId);

  if (error) {
    console.error(
      "[ProductionActions] Error updating production status:",
      error,
    );
    return { success: false, error: error.message };
  }

  return { success: true };
}
