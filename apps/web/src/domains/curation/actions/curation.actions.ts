"use server";

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
import {
  getArtifactAdminContext,
  getCurationRowAdminContext,
} from "./curation-action-context";
import {
  clearGeneratedCurationRows,
  deleteCurationByArtifactId,
  ensureGeneratingCurationRecord,
  ensureImportReadyCurationRecord,
  fetchArtifactAndPlanForCuration,
  fetchCurationSnapshot,
} from "./curation-action-db";

export async function getCurationSnapshotAction(artifactId: string) {
  try {
    const { admin } = await getArtifactAdminContext(artifactId);
    const snapshot = await fetchCurationSnapshot(admin, artifactId);

    return {
      success: true,
      curation: snapshot.curation,
      rows: snapshot.rows,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error al obtener curaduria";
    console.error("[CurationActions] Snapshot error:", message);
    return { success: false, error: message };
  }
}

export async function startCurationAction(
  artifactId: string,
  attemptNumber: number = 1,
  gaps: string[] = [],
  resume: boolean = false,
) {
  try {
    const { admin, accessToken } = await getArtifactAdminContext(artifactId, {
      requireAccessToken: true,
    });
    const { artifact, plan } = await fetchArtifactAndPlanForCuration(
      admin,
      artifactId,
    );

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

    const curationId = await ensureGeneratingCurationRecord(
      admin,
      artifactId,
      attemptNumber,
    );

    await triggerCurationGeneration({
      accessToken: accessToken!,
      artifactId,
      attemptNumber,
      components,
      courseName: artifact.course_id || "Untitled Course",
      curationId,
      gaps,
      ideaCentral: artifact.idea_central,
      resume,
    });

    return { success: true, curationId };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error al iniciar curaduria";
    console.error("[CurationActions] Start error:", message);
    return { success: false, error: message };
  }
}

export async function validateCurationAction(artifactId: string) {
  try {
    const { accessToken } = await getArtifactAdminContext(artifactId, {
      requireAccessToken: true,
    });
    await triggerCurationValidation(artifactId, accessToken!);

    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error al validar curaduria";
    console.error("[CurationActions] Validate error:", message);
    return { success: false, error: message };
  }
}

export async function updateCurationRowAction(
  rowId: string,
  updates: Record<string, unknown>,
) {
  try {
    const { admin, artifactId } = await getCurationRowAdminContext(rowId);
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
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error al actualizar fila";
    return { success: false, error: message };
  }
}

export async function deleteCurationRowAction(rowId: string) {
  try {
    const { admin, artifactId } = await getCurationRowAdminContext(rowId);
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
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error al eliminar fila";
    return { success: false, error: message };
  }
}

export async function clearGPTCurationRowsAction(artifactId: string) {
  try {
    const { admin } = await getArtifactAdminContext(artifactId);
    const { data: curation, error } = await admin
      .from("curation")
      .select("id")
      .eq("artifact_id", artifactId)
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    if (!curation?.id) return { success: true };

    await clearGeneratedCurationRows(admin, curation.id);
    await markDownstreamDirtyAction(artifactId, 4, "Curaduria (limpieza GPT)");
    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error limpiando filas GPT";
    console.error("[CurationActions] Error clearing GPT rows:", message);
    return { success: false, error: message };
  }
}

export async function updateCurationStatusAction(
  artifactId: string,
  status: string,
  notes?: string,
) {
  try {
    const { admin, authUser } = await getArtifactAdminContext(artifactId, {
      requireReviewer: true,
    });
    const { finalStatus, decision } = mapCurationStatus(status);
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
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error al actualizar estado";
    return { success: false, error: message };
  }
}

export async function deleteCurationAction(artifactId: string) {
  try {
    const { admin } = await getArtifactAdminContext(artifactId);
    await deleteCurationByArtifactId(admin, artifactId);
    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error eliminando curaduria";
    console.error("[CurationActions] Error deleting curation:", message);
    return { success: false, error: message };
  }
}

export async function importCurationJsonAction(
  artifactId: string,
  jsonString: string,
) {
  try {
    const { admin } = await getArtifactAdminContext(artifactId);
    const parsedSources = parseImportedSourcesPayload(jsonString);

    if (!parsedSources.success) {
      return {
        success: false,
        error: parsedSources.error,
      };
    }

    const curationId = await ensureImportReadyCurationRecord(admin, artifactId);

    try {
      await clearGeneratedCurationRows(admin, curationId);
    } catch (clearError) {
      console.warn(
        "[CurationActions] Could not clear old GPT rows:",
        clearError,
      );
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
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error interno del servidor";
    console.error("[CurationActions] Import error:", message);
    return {
      success: false,
      error: message,
    };
  }
}
