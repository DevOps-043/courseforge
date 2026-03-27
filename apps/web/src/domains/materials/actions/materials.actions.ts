"use server";

import { createClient } from "@/utils/supabase/server";
import {
  canReviewContent,
  getAuthenticatedUser,
  getAuthorizedArtifactAdmin,
} from "@/lib/server/artifact-action-auth";
import type {
  Esp05StepState,
  LessonMaterialState,
  QADecision,
} from "../types/materials.types";
import {
  callMaterialsNetlifyFunction,
  getAuthorizedMaterialLessonAdmin,
  getAuthorizedMaterialsAdmin,
} from "./materials-action-helpers";

const RESTARTABLE_MATERIALS_STATES = new Set<Esp05StepState>([
  "PHASE3_DRAFT",
  "PHASE3_NEEDS_FIX",
]);

export async function getMaterialsSnapshotAction(artifactId: string) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  if (!authorized) {
    return { success: false, error: "Artifact not found or inaccessible" };
  }

  const { admin } = authorized;

  const { data: materials, error: materialsError } = await admin
    .from("materials")
    .select("*")
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (materialsError) {
    console.error("[MaterialsActions] Snapshot error:", materialsError);
    return { success: false, error: materialsError.message };
  }

  let lessons: any[] = [];

  if (materials?.id) {
    const { data: lessonData, error: lessonsError } = await admin
      .from("material_lessons")
      .select("*")
      .eq("materials_id", materials.id)
      .order("module_id", { ascending: true })
      .order("lesson_id", { ascending: true });

    if (lessonsError) {
      console.error("[MaterialsActions] Lessons snapshot error:", lessonsError);
      return { success: false, error: lessonsError.message };
    }

    lessons = lessonData || [];
  }

  return { success: true, materials, lessons };
}

export async function getLessonComponentsSnapshotAction(lessonId: string) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const authorizedLesson = await getAuthorizedMaterialLessonAdmin(lessonId);
  if (!authorizedLesson) {
    return { success: false, error: "Lesson not found or inaccessible" };
  }

  const { admin } = authorizedLesson;
  const { data: components, error } = await admin
    .from("material_components")
    .select("*")
    .eq("material_lesson_id", lessonId)
    .order("iteration_number", { ascending: false });

  if (error) {
    console.error("[MaterialsActions] Components snapshot error:", error);
    return { success: false, error: error.message };
  }

  return { success: true, components: components || [] };
}

export async function startMaterialsGenerationAction(artifactId: string) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  if (!authorized) {
    return { success: false, error: "Artifact not found or inaccessible" };
  }

  const { admin } = authorized;

  const { data: existing, error: existingError } = await admin
    .from("materials")
    .select("id, state, version")
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (existingError) {
    console.error("[MaterialsActions] Error checking existing materials:", existingError);
    return { success: false, error: existingError.message };
  }

  if (existing && !RESTARTABLE_MATERIALS_STATES.has(existing.state as Esp05StepState)) {
    return {
      success: false,
      error: "Ya existe un proceso de materiales en curso",
    };
  }

  const { data: materials, error: materialsError } = await admin
    .from("materials")
    .upsert(
      {
        artifact_id: artifactId,
        state: "PHASE3_GENERATING" as Esp05StepState,
        prompt_version: "prompt05",
        version: existing ? existing.version + 1 : 1,
        qa_decision: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "artifact_id" },
    )
    .select("id")
    .single();

  if (materialsError || !materials?.id) {
    console.error("[MaterialsActions] Error creating materials record:", materialsError);
    return { success: false, error: materialsError?.message || "No se pudo crear el registro de materiales" };
  }

  try {
    await callMaterialsNetlifyFunction(
      "materials-generation-background",
      { artifactId, materialsId: materials.id, mode: "init" },
      "Error al iniciar la generacion de materiales",
    );

    return { success: true };
  } catch (error: any) {
    await admin
      .from("materials")
      .update({
        state: "PHASE3_DRAFT" as Esp05StepState,
        updated_at: new Date().toISOString(),
      })
      .eq("id", materials.id);

    console.error("[MaterialsActions] Error triggering generation:", error);
    return { success: false, error: error.message };
  }
}

export async function runMaterialsFixIterationAction(
  lessonId: string,
  fixInstructions: string,
) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const authorizedLesson = await getAuthorizedMaterialLessonAdmin(lessonId);
  if (!authorizedLesson) {
    return { success: false, error: "Lesson not found or inaccessible" };
  }

  const { admin, lesson } = authorizedLesson;

  if (lesson.iteration_count >= lesson.max_iterations) {
    return {
      success: false,
      error: `Maximo de iteraciones alcanzado (${lesson.max_iterations})`,
    };
  }

  const nextIteration = lesson.iteration_count + 1;

  const { error: updateError } = await admin
    .from("material_lessons")
    .update({
      state: "GENERATING" as LessonMaterialState,
      iteration_count: nextIteration,
      updated_at: new Date().toISOString(),
    })
    .eq("id", lessonId);

  if (updateError) {
    console.error("[MaterialsActions] Error updating lesson for fix iteration:", updateError);
    return { success: false, error: updateError.message };
  }

  try {
    await callMaterialsNetlifyFunction(
      "materials-generation-background",
      {
        artifactId: null,
        materialsId: lesson.materials_id,
        lessonId,
        fixInstructions,
        iterationNumber: nextIteration,
        mode: "single-lesson",
      },
      "Error al iniciar la iteracion dirigida",
    );

    return { success: true };
  } catch (error: any) {
    console.error("[MaterialsActions] Error triggering fix iteration:", error);
    return { success: false, error: error.message };
  }
}

export async function validateMaterialsAction(artifactId: string) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  if (!authorized) {
    return { success: false, error: "Artifact not found or inaccessible" };
  }

  try {
    const data = await callMaterialsNetlifyFunction(
      "validate-materials-background",
      { artifactId },
      "Error al validar materiales",
    );

    return { success: true, ...data };
  } catch (error: any) {
    console.error("[MaterialsActions] Error validating materials:", error);
    return { success: false, error: error.message };
  }
}

export async function validateMaterialLessonAction(lessonId: string) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const authorizedLesson = await getAuthorizedMaterialLessonAdmin(lessonId);
  if (!authorizedLesson) {
    return { success: false, error: "Lesson not found or inaccessible" };
  }

  try {
    const data = await callMaterialsNetlifyFunction(
      "validate-materials-background",
      { lessonId },
      "Error al validar la leccion",
    );

    return { success: true, ...data };
  } catch (error: any) {
    console.error("[MaterialsActions] Error validating lesson:", error);
    return { success: false, error: error.message };
  }
}

export async function markMaterialLessonForFixAction(lessonId: string) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const authorizedLesson = await getAuthorizedMaterialLessonAdmin(lessonId);
  if (!authorizedLesson) {
    return { success: false, error: "Lesson not found or inaccessible" };
  }

  try {
    await callMaterialsNetlifyFunction(
      "validate-materials-background",
      { lessonId, markForFix: true },
      "Error al marcar la leccion para correccion",
    );

    return { success: true };
  } catch (error: any) {
    console.error("[MaterialsActions] Error marking lesson for fix:", error);
    return { success: false, error: error.message };
  }
}

export async function submitMaterialsToQaAction(materialsId: string) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const authorizedMaterials = await getAuthorizedMaterialsAdmin(materialsId);
  if (!authorizedMaterials) {
    return { success: false, error: "Materials not found or inaccessible" };
  }

  const { admin } = authorizedMaterials;
  const { data: lessons, error: lessonsError } = await admin
    .from("material_lessons")
    .select("state")
    .eq("materials_id", materialsId);

  if (lessonsError) {
    console.error("[MaterialsActions] Error loading lessons for QA:", lessonsError);
    return { success: false, error: lessonsError.message };
  }

  const notApprovable = (lessons || []).filter(
    (lesson) => lesson.state !== "APPROVABLE",
  );

  if (notApprovable.length > 0) {
    return {
      success: false,
      error: `${notApprovable.length} lecciones no estan listas para QA`,
    };
  }

  const { error } = await admin
    .from("materials")
    .update({
      state: "PHASE3_READY_FOR_QA" as Esp05StepState,
      updated_at: new Date().toISOString(),
    })
    .eq("id", materialsId);

  if (error) {
    console.error("[MaterialsActions] Error submitting materials to QA:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function applyMaterialsQaDecisionAction(
  materialsId: string,
  decision: "APPROVED" | "REJECTED",
  notes?: string,
) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const hasPermission = await canReviewContent(authUser.userId);
  if (!hasPermission) {
    return {
      success: false,
      error: "Forbidden: Requiere rol de Arquitecto o Admin",
    };
  }

  const authorizedMaterials = await getAuthorizedMaterialsAdmin(materialsId);
  if (!authorizedMaterials) {
    return { success: false, error: "Materials not found or inaccessible" };
  }

  const { admin } = authorizedMaterials;
  const qaDecision: QADecision = {
    decision,
    notes,
    reviewed_by: authUser.email || authUser.userId,
    reviewed_at: new Date().toISOString(),
  };

  const newState: Esp05StepState =
    decision === "APPROVED" ? "PHASE3_APPROVED" : "PHASE3_REJECTED";

  const { error } = await admin
    .from("materials")
    .update({
      state: newState,
      qa_decision: qaDecision,
      updated_at: new Date().toISOString(),
    })
    .eq("id", materialsId);

  if (error) {
    console.error("[MaterialsActions] Error applying QA decision:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function forceResetMaterialsGenerationAction(artifactId: string) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  if (!authorized) {
    return { success: false, error: "Artifact not found or inaccessible" };
  }

  const { admin } = authorized;
  const { data: materials, error: materialsError } = await admin
    .from("materials")
    .select("id, state")
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (materialsError) {
    console.error("[MaterialsActions] Error loading materials for reset:", materialsError);
    return { success: false, error: materialsError.message };
  }

  if (!materials) {
    return { success: false, error: "No hay materiales para resetear" };
  }

  if (materials.state !== "PHASE3_GENERATING") {
    return {
      success: false,
      error: `Estado actual (${materials.state}) no requiere reset`,
    };
  }

  const { error: resetMaterialsError } = await admin
    .from("materials")
    .update({
      state: "PHASE3_DRAFT" as Esp05StepState,
      updated_at: new Date().toISOString(),
    })
    .eq("id", materials.id);

  if (resetMaterialsError) {
    console.error("[MaterialsActions] Error resetting materials:", resetMaterialsError);
    return { success: false, error: resetMaterialsError.message };
  }

  const { error: resetLessonsError } = await admin
    .from("material_lessons")
    .update({
      state: "PENDING" as LessonMaterialState,
      updated_at: new Date().toISOString(),
    })
    .eq("materials_id", materials.id)
    .eq("state", "GENERATING");

  if (resetLessonsError) {
    console.warn("[MaterialsActions] Error resetting lesson states:", resetLessonsError);
  }

  return { success: true };
}
