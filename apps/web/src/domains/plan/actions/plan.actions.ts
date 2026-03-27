"use server";

import type { PlanLessonItem } from "@/domains/plan/components/plan-view.types";
import { getErrorMessage } from "@/lib/errors";
import { callBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrganizationId } from "@/utils/auth/session";
import {
  assertArtifactOrgAccess,
  canReviewContent,
  getAccessToken,
  getAuthenticatedUser,
  getAuthorizedArtifactAdmin,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";

export async function generateInstructionalPlanAction(
  artifactId: string,
  customPrompt?: string,
  useCustomPrompt: boolean = false,
) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const accessToken = await getAccessToken(supabase);
  if (!accessToken) return { success: false, error: "Unauthorized" };

  try {
    await callBackgroundFunctionJson(
      "instructional-plan-background",
      {
        artifactId,
        userToken: accessToken,
        customPrompt,
        useCustomPrompt,
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
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function validateInstructionalPlanAction(artifactId: string) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const accessToken = await getAccessToken(supabase);
  if (!accessToken) return { success: false, error: "Unauthorized" };

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
        userToken: accessToken,
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

  const activeOrgId = await getActiveOrganizationId();
  const artifact = await assertArtifactOrgAccess(artifactId, activeOrgId);
  if (!artifact) {
    return { success: false, error: "Artifact not found or inaccessible" };
  }

  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("instructional_plans")
    .select("*")
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (error) {
    console.error("[PlanActions] Snapshot error:", error);
    return { success: false, error: error.message };
  }

  return { success: true, plan: data };
}
