"use server";

import type { PlanLessonItem } from "@/domains/plan/components/plan-view.types";
import { getErrorMessage } from "@/lib/errors";
import { callBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { createClient } from "@/utils/supabase/server";
import {
  canReviewContent,
  getAuthenticatedUser,
  getAuthorizedArtifactAdmin,
} from "@/lib/server/artifact-action-auth";
import { markDownstreamDirtyAction } from "@/lib/server/pipeline-dirty-actions";
import {
  resolveArtifactVideoDurationPolicy,
  videoDurationPolicySchema,
  type VideoDurationPolicy,
} from "@/domains/video-duration/video-duration-policy";
import { applyVideoDurationPolicyToPlan } from "@/domains/video-duration/video-duration-plan";
import {
  canIteratePlan,
  getPlanIterationCount,
  getNextPlanIteration,
  PLAN_MAX_ITERATIONS,
} from "@/domains/plan/lib/plan-iteration";

export async function generateInstructionalPlanAction(
  artifactId: string,
  customPrompt?: string,
  useCustomPrompt: boolean = false,
  iterationInstructions?: string,
) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  if (!authorized) {
    return { success: false, error: "Artifact not found or inaccessible" };
  }

  const { admin } = authorized;
  let reservedIteration: number | undefined;

  try {
    const { data: currentPlan, error: lookupError } = await admin
      .from("instructional_plans")
      .select("id, iteration_count")
      .eq("artifact_id", artifactId)
      .maybeSingle();

    if (lookupError) {
      throw lookupError;
    }

    const currentIteration = getPlanIterationCount(
      currentPlan?.iteration_count,
      Boolean(currentPlan),
    );

    if (!canIteratePlan(currentIteration)) {
      return {
        success: false,
        error: `El plan instruccional alcanzo el limite de ${PLAN_MAX_ITERATIONS} iteraciones.`,
      };
    }

    reservedIteration = getNextPlanIteration(currentIteration);

    if (currentPlan) {
      const { data: reservedPlan, error: reservationError } = await admin
        .from("instructional_plans")
        .update({
          iteration_count: reservedIteration,
          state: "STEP_PROCESSING",
          validation: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", currentPlan.id)
        .eq("iteration_count", currentPlan.iteration_count || 0)
        .select("id")
        .maybeSingle();

      if (reservationError) {
        throw reservationError;
      }

      if (!reservedPlan) {
        return {
          success: false,
          error:
            "Otra iteracion del plan fue iniciada al mismo tiempo. Actualiza la pagina antes de reintentar.",
        };
      }
    } else {
      const { error: reservationError } = await admin
        .from("instructional_plans")
        .insert({
          artifact_id: artifactId,
          lesson_plans: [],
          blockers: [],
          validation: null,
          state: "STEP_PROCESSING",
          iteration_count: reservedIteration,
        });

      if (reservationError) {
        if (reservationError.code === "23505") {
          return {
            success: false,
            error:
              "Otra iteracion del plan fue iniciada al mismo tiempo. Actualiza la pagina antes de reintentar.",
          };
        }
        throw reservationError;
      }
    }

    await callBackgroundFunctionJson(
      "instructional-plan-background",
      {
        artifactId,
        organizationId: authorized.artifact.organization_id,
        customPrompt,
        useCustomPrompt,
        iterationInstructions,
        iterationNumber: reservedIteration,
      },
      {
        fallbackError: "Error al iniciar la generacion del plan",
        localHandlerLoader: () =>
          import("../../../../netlify/functions/instructional-plan-background"),
      },
    );

    return { success: true };
  } catch (error: unknown) {
    console.error("[PlanActions] Generation trigger error:", error);
    if (reservedIteration !== undefined) {
      await admin
        .from("instructional_plans")
        .update({ state: "STEP_FAILED", updated_at: new Date().toISOString() })
        .eq("artifact_id", artifactId)
        .eq("iteration_count", reservedIteration);
    }
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function validateInstructionalPlanAction(artifactId: string) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  if (!authorized) {
    return { success: false, error: "Artifact not found or inaccessible" };
  }

  const { admin } = authorized;

  try {
    await admin
      .from("instructional_plans")
      .update({ validation: null })
      .eq("artifact_id", artifactId);

    await callBackgroundFunctionJson(
      "validate-plan-background",
      {
        artifactId,
        organizationId: authorized.artifact.organization_id,
      },
      {
        fallbackError: "Error al validar el plan instruccional",
        localHandlerLoader: () =>
          import("../../../../netlify/functions/validate-plan-background"),
      },
    );

    return { success: true };
  } catch (error: unknown) {
    console.error("[PlanActions] Validation trigger error:", error);
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function updateInstructionalPlanStatusAction(
  artifactId: string,
  status: string,
  feedback?: string,
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

  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  if (!authorized) {
    return { success: false, error: "Artifact not found or inaccessible" };
  }

  const { admin } = authorized;
  const { error } = await admin
    .from("instructional_plans")
    .update({
      state: status,
      approvals: {
        notes: feedback || "",
        reviewed_at: new Date().toISOString(),
        reviewed_by: authUser.email || "user",
        architect_status: status === "STEP_APPROVED" ? "APPROVED" : "REJECTED",
      },
    })
    .eq("artifact_id", artifactId);

  if (error) {
    console.error("[PlanActions] Error updating status:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function updateInstructionalPlanContentAction(
  artifactId: string,
  lessonPlans: PlanLessonItem[],
) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  if (!authorized) {
    return { success: false, error: "Artifact not found or inaccessible" };
  }

  const { admin } = authorized;
  const { error } = await admin
    .from("instructional_plans")
    .update({
      lesson_plans: lessonPlans,
      updated_at: new Date().toISOString(),
    })
    .eq("artifact_id", artifactId);

  if (error) {
    console.error("[PlanActions] Error updating content:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function updateInstructionalPlanVideoDurationPolicyAction(
  artifactId: string,
  policyInput: VideoDurationPolicy,
) {
  const parsedPolicy = videoDurationPolicySchema.safeParse(policyInput);
  if (!parsedPolicy.success) {
    return {
      success: false,
      error: parsedPolicy.error.issues[0]?.message || "Duración inválida",
    };
  }

  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  if (!authorized) {
    return { success: false, error: "Artifact not found or inaccessible" };
  }

  const { admin } = authorized;
  const [{ data: artifact, error: artifactError }, { data: plan, error: planError }] =
    await Promise.all([
      admin.from("artifacts").select("generation_metadata").eq("id", artifactId).single(),
      admin.from("instructional_plans").select("lesson_plans").eq("artifact_id", artifactId).maybeSingle(),
    ]);

  if (artifactError || !artifact) {
    return { success: false, error: artifactError?.message || "Artifact not found" };
  }
  if (planError) {
    return { success: false, error: planError.message };
  }

  const previousMetadata = (artifact.generation_metadata || {}) as Record<string, unknown>;
  const originalInput = isRecord(previousMetadata.original_input)
    ? previousMetadata.original_input
    : {};
  const nextMetadata = {
    ...previousMetadata,
    original_input: {
      ...originalInput,
      videoDurationPolicy: parsedPolicy.data,
    },
    video_duration_policy: parsedPolicy.data,
  };
  const previousLessonPlans = Array.isArray(plan?.lesson_plans)
    ? plan.lesson_plans as PlanLessonItem[]
    : [];
  const nextLessonPlans = applyVideoDurationPolicyToPlan(
    previousLessonPlans,
    parsedPolicy.data,
  );

  const { error: metadataUpdateError } = await admin
    .from("artifacts")
    .update({ generation_metadata: nextMetadata })
    .eq("id", artifactId);
  if (metadataUpdateError) {
    return { success: false, error: metadataUpdateError.message };
  }

  if (plan) {
    const { error: planUpdateError } = await admin
      .from("instructional_plans")
      .update({ lesson_plans: nextLessonPlans, updated_at: new Date().toISOString() })
      .eq("artifact_id", artifactId);
    if (planUpdateError) {
      await admin
        .from("artifacts")
        .update({ generation_metadata: previousMetadata })
        .eq("id", artifactId);
      return { success: false, error: planUpdateError.message };
    }
  }

  await markDownstreamDirtyAction(artifactId, 3, "Duración objetivo del plan");
  return {
    success: true,
    lessonPlans: nextLessonPlans,
    videoDurationPolicy: parsedPolicy.data,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function deleteInstructionalPlanAction(artifactId: string) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  if (!authorized) {
    return { success: false, error: "Artifact not found or inaccessible" };
  }

  const { admin } = authorized;
  const { error } = await admin
    .from("instructional_plans")
    .delete()
    .eq("artifact_id", artifactId);

  if (error) {
    console.error("[PlanActions] Error deleting plan:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function getInstructionalPlanSnapshotAction(artifactId: string) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  if (!authorized) {
    return { success: false, error: "Artifact not found or inaccessible" };
  }

  const { admin } = authorized;
  const [{ data, error }, { data: artifact, error: artifactError }] = await Promise.all([
    admin.from("instructional_plans").select("*").eq("artifact_id", artifactId).maybeSingle(),
    admin.from("artifacts").select("generation_metadata").eq("id", artifactId).single(),
  ]);

  if (error) {
    console.error("[PlanActions] Snapshot error:", error);
    return { success: false, error: error.message };
  }
  if (artifactError) {
    console.error("[PlanActions] Artifact duration snapshot error:", artifactError);
    return { success: false, error: artifactError.message };
  }

  return {
    success: true,
    plan: data,
    videoDurationPolicy: resolveArtifactVideoDurationPolicy(artifact?.generation_metadata),
  };
}
