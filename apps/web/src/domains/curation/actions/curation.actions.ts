"use server";

import { createClient } from "@/utils/supabase/server";
import { getActiveOrganizationId } from "@/utils/auth/session";
import {
  assertArtifactOrgAccess,
  canReviewContent,
  getAccessToken,
  getAuthenticatedUser,
  getAuthorizedArtifactAdmin,
  getAuthorizedCurationRowAdmin,
  getBackgroundFunctionsBaseUrl,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { CURATION_STATES } from "@/lib/pipeline-constants";
import { markDownstreamDirtyAction } from "@/lib/server/pipeline-dirty-actions";
import {
  buildImportedRows,
  extractPlanComponents,
  mapCurationStatus,
  parseImportedSourcesPayload,
  triggerCurationGeneration,
  triggerCurationValidation,
} from "../lib/curation-action-helpers";

export async function getCurationSnapshotAction(artifactId: string) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };
  const activeOrgId = await getActiveOrganizationId();
  const artifact = await assertArtifactOrgAccess(artifactId, activeOrgId);
  if (!artifact) {
    return { success: false, error: "Artifact not found or inaccessible" };
  }
  const admin = getServiceRoleClient();
  const { data: curation, error: curationError } = await admin
    .from("curation")
    .select("*")
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (curationError) {
    console.error("[CurationActions] Snapshot error:", curationError);
    return { success: false, error: curationError.message };
  }
  let rows: any[] = [];
  if (curation?.id) {
    const { data: rowData, error: rowsError } = await admin
      .from("curation_rows")
      .select("*")
      .eq("curation_id", curation.id)
      .order("lesson_title", { ascending: true });

    if (rowsError) {
      console.error("[CurationActions] Snapshot rows error:", rowsError);
      return { success: false, error: rowsError.message };
    }
    rows = rowData || [];
  }
  return { success: true, curation, rows };
}

export async function startCurationAction(
  artifactId: string,
  attemptNumber: number = 1,
  gaps: string[] = [],
  resume: boolean = false,
) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };
  const accessToken = await getAccessToken(supabase);
  if (!accessToken) return { success: false, error: "Unauthorized" };
  try {
    const authorized = await getAuthorizedArtifactAdmin(artifactId);
    if (!authorized) {
      throw new Error("Artifact not found or inaccessible");
    }
    const { admin } = authorized;
    const { data: artifact } = await admin
      .from("artifacts")
      .select("idea_central, course_id")
      .eq("id", artifactId)
      .single();

    if (!artifact) {
      throw new Error("Artifact not found");
    }
    const { data: plan, error: planError } = await admin
      .from("instructional_plans")
      .select("lesson_plans")
      .eq("artifact_id", artifactId)
      .maybeSingle();

    if (planError) {
      console.error("[CurationActions] DB error fetching plan:", planError);
      throw new Error(`Database error fetching plan: ${planError.message}`);
    }
    if (!plan) {
      throw new Error(
        "No Instructional Plan found. Please go back to Step 3 and generate/approve the plan first.",
      );
    }

    if (
      !plan.lesson_plans ||
      (Array.isArray(plan.lesson_plans) && plan.lesson_plans.length === 0)
    ) {
      throw new Error(
        "Instructional Plan is empty. Please regenerate the plan in Step 3.",
      );
    }

    const components = extractPlanComponents(plan.lesson_plans);

    if (components.length === 0) {
      throw new Error("No components found in the plan");
    }

    const { data: existingCuration } = await admin
      .from("curation")
      .select("id")
      .eq("artifact_id", artifactId)
      .maybeSingle();

    let curationId = existingCuration?.id;

    if (existingCuration?.id) {
      await admin
        .from("curation")
        .update({
          state: CURATION_STATES.GENERATING,
          attempt_number: attemptNumber,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingCuration.id);
    } else {
      const { data: newCuration, error: createError } = await admin
        .from("curation")
        .insert({
          artifact_id: artifactId,
          state: CURATION_STATES.GENERATING,
          attempt_number: attemptNumber,
        })
        .select("id")
        .single();

      if (createError || !newCuration?.id) {
        throw new Error(
          `Failed to create curation record: ${createError?.message || "Unknown error"}`,
        );
      }

      curationId = newCuration.id;
    }

    const triggerResponse = await triggerCurationGeneration({
      accessToken,
      artifactId,
      attemptNumber,
      baseUrl: getBackgroundFunctionsBaseUrl(),
      components,
      courseName: artifact.course_id || "Untitled Course",
      curationId,
      gaps,
      ideaCentral: artifact.idea_central,
      resume,
    });

    if (!triggerResponse.ok) {
      console.warn(
        `[CurationActions] Trigger failed with status ${triggerResponse.status}`,
      );
    }

    return { success: true, curationId };
  } catch (error: any) {
    console.error("[CurationActions] Start error:", error);
    return { success: false, error: error.message };
  }
}

export async function validateCurationAction(artifactId: string) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };
  const accessToken = await getAccessToken(supabase);
  if (!accessToken) return { success: false, error: "Unauthorized" };
  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  if (!authorized) {
    return { success: false, error: "Artifact not found or inaccessible" };
  }

  try {
    const response = await triggerCurationValidation(
      artifactId,
      accessToken,
      getBackgroundFunctionsBaseUrl(),
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || "Error en el servicio de validacion");
    }

    return { success: true };
  } catch (error: any) {
    console.error("[CurationActions] Validate error:", error);
    return { success: false, error: error.message };
  }
}

export async function updateCurationRowAction(
  rowId: string,
  updates: Record<string, unknown>,
) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const authorized = await getAuthorizedCurationRowAdmin(rowId);
  if (!authorized) {
    return { success: false, error: "Curation row not found or inaccessible" };
  }

  const { admin, artifactId } = authorized;
  const allowedUpdates: Record<string, unknown> = {};

  if (updates.apta !== undefined) allowedUpdates.apta = updates.apta;
  if (updates.cobertura_completa !== undefined) {
    allowedUpdates.cobertura_completa = updates.cobertura_completa;
  }
  if (updates.motivo_no_apta !== undefined) {
    allowedUpdates.motivo_no_apta = updates.motivo_no_apta;
  }
  if (updates.notes !== undefined) {
    allowedUpdates.notes = updates.notes;
  }

  const { error } = await admin
    .from("curation_rows")
    .update(allowedUpdates)
    .eq("id", rowId);

  if (error) {
    return { success: false, error: error.message };
  }

  await markDownstreamDirtyAction(
    artifactId,
    4,
    "Curaduria (fila actualizada)",
  );

  return { success: true };
}

export async function deleteCurationRowAction(rowId: string) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const authorized = await getAuthorizedCurationRowAdmin(rowId);
  if (!authorized) {
    return { success: false, error: "Curation row not found or inaccessible" };
  }

  const { admin, artifactId } = authorized;
  const { error } = await admin.from("curation_rows").delete().eq("id", rowId);

  if (error) {
    console.error("[CurationActions] Error deleting curation row:", error);
    return { success: false, error: error.message };
  }

  await markDownstreamDirtyAction(
    artifactId,
    4,
    "Curaduria (fila eliminada)",
  );

  return { success: true };
}

export async function clearGPTCurationRowsAction(artifactId: string) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  if (!authorized) {
    return { success: false, error: "Artifact not found or inaccessible" };
  }

  const { admin } = authorized;
  const { data: curation } = await admin
    .from("curation")
    .select("id")
    .eq("artifact_id", artifactId)
    .single();

  if (!curation?.id) return { success: true };

  const { error } = await admin
    .from("curation_rows")
    .delete()
    .eq("curation_id", curation.id)
    .eq("source_rationale", "GPT_GENERATED");

  if (error) {
    console.error("[CurationActions] Error clearing GPT rows:", error);
    return { success: false, error: error.message };
  }

  await markDownstreamDirtyAction(artifactId, 4, "Curaduria (limpieza GPT)");
  return { success: true };
}

export async function updateCurationStatusAction(
  artifactId: string,
  status: string,
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

  const { finalStatus, decision } = mapCurationStatus(status);
  const { admin } = authorized;
  const { error } = await admin
    .from("curation")
    .update({
      state: finalStatus,
      qa_decision: {
        notes: notes || "",
        reviewed_at: new Date().toISOString(),
        reviewed_by: authUser.email || authUser.userId,
        decision,
      },
    })
    .eq("artifact_id", artifactId);

  if (error) {
    console.error("[CurationActions] Error updating status:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function deleteCurationAction(artifactId: string) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  if (!authorized) {
    return { success: false, error: "Artifact not found or inaccessible" };
  }

  const { admin } = authorized;
  const { error } = await admin
    .from("curation")
    .delete()
    .eq("artifact_id", artifactId);

  if (error) {
    console.error("[CurationActions] Error deleting curation:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function importCurationJsonAction(
  artifactId: string,
  jsonString: string,
) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "No autorizado" };

  try {
    const authorized = await getAuthorizedArtifactAdmin(artifactId);
    if (!authorized) {
      return { success: false, error: "Artifact not found or inaccessible" };
    }

    const { admin } = authorized;
    const parsedSources = parseImportedSourcesPayload(jsonString);

    if (!parsedSources.success) {
      return {
        success: false,
        error: parsedSources.error,
      };
    }

    let curationId: string;
    const { data: existingCuration } = await admin
      .from("curation")
      .select("id")
      .eq("artifact_id", artifactId)
      .maybeSingle();

    if (existingCuration?.id) {
      curationId = existingCuration.id;
      const { error: deleteError } = await admin
        .from("curation_rows")
        .delete()
        .eq("curation_id", curationId)
        .eq("source_rationale", "GPT_GENERATED");

      if (deleteError) {
        console.warn(
          "[CurationActions] Could not clear old GPT rows:",
          deleteError,
        );
      }
    } else {
      const { data: newCuration, error: createError } = await admin
        .from("curation")
        .insert({
          artifact_id: artifactId,
          state: CURATION_STATES.READY_FOR_QA,
          attempt_number: 1,
        })
        .select("id")
        .single();

      if (createError || !newCuration?.id) {
        console.error(
          "[CurationActions] Failed to create curation:",
          createError,
        );
        return {
          success: false,
          error: "Error creando registro de curaduria.",
        };
      }

      curationId = newCuration.id;
    }

    const rowsToInsert = buildImportedRows(curationId, parsedSources.sources);

    const { error: insertError } = await admin
      .from("curation_rows")
      .insert(rowsToInsert);

    if (insertError) {
      console.error("[CurationActions] Insert error:", insertError);
      return {
        success: false,
        error: `Error insertando fuentes: ${insertError.message}`,
      };
    }

    await admin
      .from("curation")
      .update({
        state: CURATION_STATES.READY_FOR_QA,
        updated_at: new Date().toISOString(),
      })
      .eq("id", curationId);

    await markDownstreamDirtyAction(
      artifactId,
      4,
      "Curacion (JSON importado)",
    );

    return {
      success: true,
      message: `${parsedSources.sources.length} fuentes importadas exitosamente.`,
      sourcesSaved: parsedSources.sources.length,
    };
  } catch (error: any) {
    console.error("[CurationActions] Import error:", error);
    return {
      success: false,
      error: error.message || "Error interno del servidor",
    };
  }
}
