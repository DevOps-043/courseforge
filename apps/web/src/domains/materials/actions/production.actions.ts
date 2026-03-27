"use server";

import { createClient } from "@/utils/supabase/server";
import { getBackgroundFunctionsBaseUrl } from "@/lib/server/artifact-action-auth";
import { markDownstreamDirtyAction } from "@/lib/server/pipeline-dirty-actions";

export async function generateVideoPromptsAction(
  componentId: string,
  storyboard: any[],
) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { success: false, error: "Unauthorized" };

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { success: false, error: "Unauthorized" };

  try {
    const response = await fetch(
      `${getBackgroundFunctionsBaseUrl()}/.netlify/functions/video-prompts-generation`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          componentId,
          storyboard,
          userToken: session.access_token,
        }),
      },
    );

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to generate prompts");
    }

    return { success: true, prompts: data.prompts };
  } catch (error: any) {
    console.error("[ProductionActions] Error generating prompts:", error);
    return { success: false, error: error.message };
  }
}

export async function saveMaterialAssetsAction(
  componentId: string,
  assets: any,
) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { success: false, error: "Unauthorized" };

  const { data: component } = await supabase
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

  const currentAssets = component?.assets || {};
  const mergedAssets = { ...currentAssets, ...assets };
  const componentType = component?.type || "";

  const dodChecklist = {
    has_slides_url: !!mergedAssets.slides_url,
    has_video_url: !!mergedAssets.video_url,
    has_screencast_url: !!mergedAssets.screencast_url,
    has_b_roll_prompts: !!mergedAssets.b_roll_prompts,
    has_final_video_url: !!mergedAssets.final_video_url,
  };

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

  let productionStatus = "PENDING";
  if (
    hasRequiredSlides &&
    hasRequiredScreencast &&
    hasRequiredVideo &&
    hasRequiredFinalVideo
  ) {
    productionStatus = "COMPLETED";
  } else if (dodChecklist.has_final_video_url) {
    productionStatus = "COMPLETED";
  } else if (
    dodChecklist.has_slides_url ||
    dodChecklist.has_video_url ||
    dodChecklist.has_screencast_url ||
    dodChecklist.has_b_roll_prompts
  ) {
    productionStatus = "IN_PROGRESS";
  }

  let gammaDeckId = mergedAssets.gamma_deck_id;
  if (!gammaDeckId && component?.material_lessons) {
    const lesson = component.material_lessons as any;
    const materials = Array.isArray(lesson.materials)
      ? lesson.materials[0]
      : lesson.materials;
    const artifact = Array.isArray(materials?.artifacts)
      ? materials.artifacts[0]
      : materials?.artifacts;

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
    gammaDeckId = `${courseId}-${lessonNum}-${typeCode}-${suffix}`;
  }

  const finalAssets = {
    ...mergedAssets,
    gamma_deck_id: gammaDeckId,
    production_status: productionStatus,
    dod_checklist: dodChecklist,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("material_components")
    .update({ assets: finalAssets })
    .eq("id", componentId);

  if (error) {
    console.error("[ProductionActions] Error saving material assets:", error);
    return { success: false, error: error.message };
  }

  const lessonHierarchy = component?.material_lessons as any;
  const materialsHierarchy = Array.isArray(lessonHierarchy?.materials)
    ? lessonHierarchy.materials[0]
    : lessonHierarchy?.materials;
  const artifactId = materialsHierarchy?.artifact_id;

  if (artifactId) {
    await markDownstreamDirtyAction(
      artifactId,
      5,
      "Materiales (assets actualizados)",
    );
    await syncProductionStatusAction(artifactId);
  }

  if (component?.material_lesson_id) {
    const { data: lesson } = await supabase
      .from("material_lessons")
      .select("materials_id")
      .eq("id", component.material_lesson_id)
      .single();

    if (lesson?.materials_id) {
      const { data: materials } = await supabase
        .from("materials")
        .select("artifact_id")
        .eq("id", lesson.materials_id)
        .single();

      if (materials?.artifact_id) {
        await logPipelineEventAction(
          materials.artifact_id,
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
    }
  }

  return { success: true, productionStatus, dodChecklist };
}

export async function syncProductionStatusAction(artifactId: string) {
  const supabase = await createClient();
  const { data: components, error: componentsError } = await supabase
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

  if (componentsError || !components) {
    console.error(
      "[ProductionActions] Error fetching components for sync:",
      componentsError,
    );
    return { success: false };
  }

  const produceable = components.filter(
    (component) =>
      component.type.includes("VIDEO") || component.type === "DEMO_GUIDE",
  );

  if (produceable.length === 0) return { success: true };

  const total = produceable.length;
  const completed = produceable.filter(
    (component) => (component.assets as any)?.production_status === "COMPLETED",
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
  eventData: Record<string, any> = {},
  stepId?: string,
  entityId?: string,
  entityType?: string,
) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { success: false, error: "Unauthorized" };

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
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { success: false, error: "Unauthorized" };

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
