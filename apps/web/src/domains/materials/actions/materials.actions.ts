"use server";

import { getErrorMessage } from "@/lib/errors";
import { getAuthorizedMaterialComponentAdmin } from "@/lib/server/artifact-action-auth";
import { markDownstreamDirtyAction } from "@/lib/server/pipeline-dirty-actions";
import type { PlanLessonItem } from "@/domains/plan/components/plan-view.types";
import {
  buildVideoDurationContract,
  isVideoComponentType,
  videoDurationPolicySchema,
  type VideoDurationPolicy,
} from "@/domains/video-duration/video-duration-policy";
import { applyVideoDurationContractToPlanComponent } from "@/domains/video-duration/video-duration-plan";
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
  fetchArtifactComponentsSnapshot,
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

async function withMaterialsActionBoundary<T>(
  label: string,
  action: () => Promise<T>,
) {
  try {
    return await action();
  } catch (error) {
    console.error(`[MaterialsActions] ${label}:`, error);
    return createMaterialsActionError(getErrorMessage(error));
  }
}

export async function getMaterialsSnapshotAction(artifactId: string) {
  return withMaterialsActionBoundary("Unhandled snapshot error", async () => {
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
  });
}

export async function getLessonComponentsSnapshotAction(lessonId: string) {
  return withMaterialsActionBoundary("Unhandled components snapshot error", async () => {
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
  });
}

export async function getArtifactComponentsSnapshotAction(artifactId: string) {
  return withMaterialsActionBoundary("Unhandled artifact components snapshot error", async () => {
    const context = await getAuthorizedArtifactMaterialsContext(artifactId);
    if (!context.ok) {
      return context.errorResult;
    }

    const { data: components, error } = await fetchArtifactComponentsSnapshot(
      context.admin,
      artifactId,
    );

    if (error) {
      console.error("[MaterialsActions] Artifact components snapshot error:", error);
      return createMaterialsActionError(error.message);
    }

    return { success: true as const, components: components || [] };
  });
}

export async function startMaterialsGenerationAction(artifactId: string) {
  return withMaterialsActionBoundary("Unhandled start generation error", async () => {
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
  });
}

export async function runMaterialsFixIterationAction(
  lessonId: string,
  fixInstructions: string,
  componentTypes?: string[],
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
        mode: componentTypes && componentTypes.length > 0 ? "single-component" : "single-lesson",
        ...(componentTypes && componentTypes.length > 0 ? { componentTypes } : {}),
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

export async function updateMaterialComponentVideoDurationAction(
  componentId: string,
  policyInput: VideoDurationPolicy,
) {
  return withMaterialsActionBoundary("Unhandled video duration update error", async () => {
    const parsedPolicy = videoDurationPolicySchema.safeParse(policyInput);
    if (!parsedPolicy.success) {
      return createMaterialsActionError(
        parsedPolicy.error.issues[0]?.message || "Duración inválida",
      );
    }

    const authorized = await getAuthorizedMaterialComponentAdmin(componentId);
    if (!authorized) {
      return createMaterialsActionError("Component not found or inaccessible");
    }
    const componentType = authorized.component.type;
    if (!isVideoComponentType(componentType)) {
      return createMaterialsActionError("La duración solo se puede aplicar a componentes de video");
    }

    const contract = buildVideoDurationContract(parsedPolicy.data, componentType);
    const { admin, artifactId, component } = authorized;
    const [{ data: lesson, error: lessonError }, { data: plan, error: planError }] = await Promise.all([
      admin.from("material_lessons").select("lesson_id").eq("id", component.material_lesson_id).single(),
      admin.from("instructional_plans").select("lesson_plans").eq("artifact_id", artifactId).single(),
    ]);
    if (lessonError || !lesson?.lesson_id) {
      return createMaterialsActionError(lessonError?.message || "No se pudo resolver la lección");
    }
    if (planError || !plan) {
      return createMaterialsActionError(planError?.message || "No se pudo resolver el plan instruccional");
    }
    const sourceLessonId = lesson.lesson_id;

    const previousLessonPlans = Array.isArray(plan.lesson_plans)
      ? plan.lesson_plans as PlanLessonItem[]
      : [];
    const nextLessonPlans = applyVideoDurationContractToPlanComponent(
      previousLessonPlans,
      sourceLessonId,
      componentType,
      contract,
    );
    const { error: updatePlanError } = await admin
      .from("instructional_plans")
      .update({ lesson_plans: nextLessonPlans, updated_at: new Date().toISOString() })
      .eq("artifact_id", artifactId);
    if (updatePlanError) return createMaterialsActionError(updatePlanError.message);

    const { error: updateAssetsError } = await admin.rpc("patch_material_component_assets", {
      p_assets_patch: {
        assembly_target_duration_seconds: contract.targetDurationSeconds,
        final_video_assembly_stale: true,
        video_duration_contract: contract,
      },
      p_component_id: componentId,
    });
    if (updateAssetsError) {
      await admin.from("instructional_plans")
        .update({ lesson_plans: previousLessonPlans, updated_at: new Date().toISOString() })
        .eq("artifact_id", artifactId);
      return createMaterialsActionError(updateAssetsError.message);
    }

    await markDownstreamDirtyAction(artifactId, 5, "Duración objetivo de video");
    return { success: true as const, contract };
  });
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
