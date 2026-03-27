"use server";

import { getErrorMessage } from "@/lib/errors";
import type { Esp05StepState, QADecision } from "../types/materials.types";
import {
  createMaterialsActionError,
  getAuthorizedArtifactMaterialsContext,
  getAuthorizedLessonMaterialsContext,
  getAuthorizedMaterialsContext,
  getAuthorizedMaterialsReviewerContext,
} from "./materials-action-context";
import {
  callMaterialsNetlifyFunction,
} from "./materials-action-helpers";
import {
  countNonApprovableLessons,
  fetchArtifactMaterialsRecord,
  fetchLessonComponentsSnapshot,
  fetchMaterialsSnapshot,
  fetchResettableMaterialsRecord,
  resetGeneratingLessons,
  updateMaterialsState,
  upsertGenerationMaterialsRecord,
} from "./materials-action-db";

const RESTARTABLE_MATERIALS_STATES = new Set<Esp05StepState>([
  "PHASE3_DRAFT",
  "PHASE3_NEEDS_FIX",
]);

export async function getMaterialsSnapshotAction(artifactId: string) {
  const context = await getAuthorizedArtifactMaterialsContext(artifactId);
  if (!context.ok) {
    return context.errorResult;
  }

  const snapshot = await fetchMaterialsSnapshot(context.admin, artifactId);
  if (snapshot.error) {
    console.error("[MaterialsActions] Snapshot error:", snapshot.error);
    return createMaterialsActionError(snapshot.error.message);
  }

  return {
    success: true as const,
    lessons: snapshot.lessons,
    materials: snapshot.materials,
  };
}

export async function getLessonComponentsSnapshotAction(lessonId: string) {
  const context = await getAuthorizedLessonMaterialsContext(lessonId);
  if (!context.ok) {
    return context.errorResult;
  }

  const { data: components, error } = await fetchLessonComponentsSnapshot(
    context.admin,
    lessonId,
  );

  if (error) {
    console.error("[MaterialsActions] Components snapshot error:", error);
    return createMaterialsActionError(error.message);
  }

  return { success: true as const, components: components || [] };
}

export async function startMaterialsGenerationAction(artifactId: string) {
  const context = await getAuthorizedArtifactMaterialsContext(artifactId);
  if (!context.ok) {
    return context.errorResult;
  }

  const { data: existing, error: existingError } =
    await fetchArtifactMaterialsRecord(context.admin, artifactId);

  if (existingError) {
    console.error(
      "[MaterialsActions] Error checking existing materials:",
      existingError,
    );
    return createMaterialsActionError(existingError.message);
  }

  if (
    existing &&
    !RESTARTABLE_MATERIALS_STATES.has(existing.state as Esp05StepState)
  ) {
    return createMaterialsActionError(
      "Ya existe un proceso de materiales en curso",
    );
  }

  const { data: materials, error: upsertError } =
    await upsertGenerationMaterialsRecord(context.admin, artifactId, existing);

  if (upsertError || !materials?.id) {
    console.error(
      "[MaterialsActions] Error creating materials record:",
      upsertError,
    );
    return createMaterialsActionError(
      upsertError?.message || "No se pudo crear el registro de materiales",
    );
  }

  try {
    await callMaterialsNetlifyFunction(
      "materials-generation-background",
      { artifactId, materialsId: materials.id, mode: "init" },
      "Error al iniciar la generacion de materiales",
      () => import("../../../../netlify/functions/materials-generation-background"),
    );

    return { success: true as const };
  } catch (error) {
    await updateMaterialsState(context.admin, materials.id, "PHASE3_DRAFT");
    console.error("[MaterialsActions] Error triggering generation:", error);
    return createMaterialsActionError(getErrorMessage(error));
  }
}

export async function runMaterialsFixIterationAction(
  lessonId: string,
  fixInstructions: string,
) {
  const context = await getAuthorizedLessonMaterialsContext(lessonId);
  if (!context.ok) {
    return context.errorResult;
  }

  if (context.lesson.iteration_count >= context.lesson.max_iterations) {
    return createMaterialsActionError(
      `Maximo de iteraciones alcanzado (${context.lesson.max_iterations})`,
    );
  }

  const nextIteration = context.lesson.iteration_count + 1;

  const { error: updateError } = await context.admin
    .from("material_lessons")
    .update({
      state: "GENERATING",
      iteration_count: nextIteration,
      updated_at: new Date().toISOString(),
    })
    .eq("id", lessonId);

  if (updateError) {
    console.error(
      "[MaterialsActions] Error updating lesson for fix iteration:",
      updateError,
    );
    return createMaterialsActionError(updateError.message);
  }

  try {
    await callMaterialsNetlifyFunction(
      "materials-generation-background",
      {
        artifactId: context.artifactId,
        materialsId: context.lesson.materials_id,
        lessonId,
        fixInstructions,
        iterationNumber: nextIteration,
        mode: "single-lesson",
      },
      "Error al iniciar la iteracion dirigida",
      () => import("../../../../netlify/functions/materials-generation-background"),
    );

    return { success: true as const };
  } catch (error) {
    console.error("[MaterialsActions] Error triggering fix iteration:", error);
    return createMaterialsActionError(getErrorMessage(error));
  }
}

export async function validateMaterialsAction(artifactId: string) {
  const context = await getAuthorizedArtifactMaterialsContext(artifactId);
  if (!context.ok) {
    return context.errorResult;
  }

  try {
    const data = await callMaterialsNetlifyFunction(
      "validate-materials-background",
      { artifactId },
      "Error al validar materiales",
      () => import("../../../../netlify/functions/validate-materials-background"),
    );

    return { success: true as const, ...data };
  } catch (error) {
    console.error("[MaterialsActions] Error validating materials:", error);
    return createMaterialsActionError(getErrorMessage(error));
  }
}

export async function validateMaterialLessonAction(lessonId: string) {
  const context = await getAuthorizedLessonMaterialsContext(lessonId);
  if (!context.ok) {
    return context.errorResult;
  }

  try {
    const data = await callMaterialsNetlifyFunction(
      "validate-materials-background",
      { lessonId },
      "Error al validar la leccion",
      () => import("../../../../netlify/functions/validate-materials-background"),
    );

    return { success: true as const, ...data };
  } catch (error) {
    console.error("[MaterialsActions] Error validating lesson:", error);
    return createMaterialsActionError(getErrorMessage(error));
  }
}

export async function markMaterialLessonForFixAction(lessonId: string) {
  const context = await getAuthorizedLessonMaterialsContext(lessonId);
  if (!context.ok) {
    return context.errorResult;
  }

  try {
    await callMaterialsNetlifyFunction(
      "validate-materials-background",
      { lessonId, markForFix: true },
      "Error al marcar la leccion para correccion",
      () => import("../../../../netlify/functions/validate-materials-background"),
    );

    return { success: true as const };
  } catch (error) {
    console.error("[MaterialsActions] Error marking lesson for fix:", error);
    return createMaterialsActionError(getErrorMessage(error));
  }
}

export async function submitMaterialsToQaAction(materialsId: string) {
  const context = await getAuthorizedMaterialsContext(materialsId);
  if (!context.ok) {
    return context.errorResult;
  }

  const { count, error } = await countNonApprovableLessons(
    context.admin,
    materialsId,
  );

  if (error) {
    console.error("[MaterialsActions] Error loading lessons for QA:", error);
    return createMaterialsActionError(error.message);
  }

  if (count > 0) {
    return createMaterialsActionError(
      `${count} lecciones no estan listas para QA`,
    );
  }

  const { error: updateError } = await updateMaterialsState(
    context.admin,
    materialsId,
    "PHASE3_READY_FOR_QA",
  );

  if (updateError) {
    console.error(
      "[MaterialsActions] Error submitting materials to QA:",
      updateError,
    );
    return createMaterialsActionError(updateError.message);
  }

  return { success: true as const };
}

export async function applyMaterialsQaDecisionAction(
  materialsId: string,
  decision: "APPROVED" | "REJECTED",
  notes?: string,
) {
  const context = await getAuthorizedMaterialsReviewerContext(materialsId);
  if (!context.ok) {
    return context.errorResult;
  }

  const qaDecision: QADecision = {
    decision,
    notes,
    reviewed_by: context.authUser.email || context.authUser.userId,
    reviewed_at: new Date().toISOString(),
  };

  const { error } = await updateMaterialsState(
    context.admin,
    materialsId,
    decision === "APPROVED" ? "PHASE3_APPROVED" : "PHASE3_REJECTED",
    qaDecision,
  );

  if (error) {
    console.error("[MaterialsActions] Error applying QA decision:", error);
    return createMaterialsActionError(error.message);
  }

  return { success: true as const };
}

export async function forceResetMaterialsGenerationAction(artifactId: string) {
  const context = await getAuthorizedArtifactMaterialsContext(artifactId);
  if (!context.ok) {
    return context.errorResult;
  }

  const { data: materials, error: materialsError } =
    await fetchResettableMaterialsRecord(context.admin, artifactId);

  if (materialsError) {
    console.error(
      "[MaterialsActions] Error loading materials for reset:",
      materialsError,
    );
    return createMaterialsActionError(materialsError.message);
  }

  if (!materials) {
    return createMaterialsActionError("No hay materiales para resetear");
  }

  if (materials.state !== "PHASE3_GENERATING") {
    return createMaterialsActionError(
      `Estado actual (${materials.state}) no requiere reset`,
    );
  }

  const { error: resetMaterialsError } = await updateMaterialsState(
    context.admin,
    materials.id,
    "PHASE3_DRAFT",
  );

  if (resetMaterialsError) {
    console.error("[MaterialsActions] Error resetting materials:", resetMaterialsError);
    return createMaterialsActionError(resetMaterialsError.message);
  }

  const { error: resetLessonsError } = await resetGeneratingLessons(
    context.admin,
    materials.id,
  );

  if (resetLessonsError) {
    console.warn(
      "[MaterialsActions] Error resetting lesson states:",
      resetLessonsError,
    );
  }

  return { success: true as const };
}
