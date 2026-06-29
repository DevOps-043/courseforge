"use server";

import { getErrorMessage } from "@/lib/errors";
import { SYLLABUS_STATES } from "@/lib/pipeline-constants";
import {
  canReviewContent,
  getAuthenticatedUser,
  getAuthorizedArtifactAdmin,
} from "@/lib/server/artifact-action-auth";
import { assertPipelinePhaseAllowed } from "@/lib/server/pipeline-validation.server";
import { createClient } from "@/utils/supabase/server";
import type { Esp02StepState } from "../types/syllabus.types";

export async function updateSyllabusStatusAction(
  artifactId: string,
  status: Esp02StepState,
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

  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  if (!authorized) {
    return { success: false, error: "Artifact not found or inaccessible" };
  }

  if (status === SYLLABUS_STATES.APPROVED) {
    try {
      await assertPipelinePhaseAllowed(authorized.admin, artifactId, "SYLLABUS");
    } catch (error) {
      return {
        success: false,
        error: getErrorMessage(
          error,
          "El temario no cumple los requisitos para aprobar.",
        ),
      };
    }
  }

  const payload: {
    state: Esp02StepState;
    updated_at: string;
    qa?: {
      notes?: string;
      reviewed_at: string;
      reviewed_by: string;
      status: "PENDING" | "APPROVED" | "REJECTED";
    };
  } = {
    state: status,
    updated_at: new Date().toISOString(),
  };

  if (notes !== undefined) {
    payload.qa = {
      notes,
      reviewed_at: new Date().toISOString(),
      reviewed_by: authUser.email || authUser.userId,
      status:
        status === SYLLABUS_STATES.APPROVED
          ? "APPROVED"
          : status === SYLLABUS_STATES.REJECTED
            ? "REJECTED"
            : "PENDING",
    };
  }

  const { error } = await authorized.admin
    .from("syllabus")
    .update(payload)
    .eq("artifact_id", artifactId);

  if (error) {
    console.error("[SyllabusActions] Error updating status:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}
