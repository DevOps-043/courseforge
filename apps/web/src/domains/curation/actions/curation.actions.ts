"use server";

import { getErrorMessage } from "@/lib/errors";
import { markDownstreamDirtyAction } from "@/lib/server/pipeline-dirty-actions";
import {
  extractPlanComponents,
  mapCurationStatus,
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
  fetchArtifactAndPlanForCuration,
  fetchCurationSnapshot,
  markCurationBlocked,
} from "./curation-action-db";
import { buildLessonsToProcess } from "../../../../netlify/functions/shared/unified-curation-helpers";
import { getMissingLessonCoverage } from "../../../../netlify/functions/shared/curation-v2/coverage";
import {
  normalizeSourceUrl,
  validatePdfBuffer,
  validateUrlSource,
} from "../../../../netlify/functions/shared/curation-v2/validation";
import {
  validateAndPersistCurationSource,
  type PersistedCurationSource,
} from "../../../../netlify/functions/shared/curation-v2/sources";

interface ManualSourceLessonInput {
  lessonId: string;
  lessonTitle: string;
}

function normalizeLessonKey(value: string | null | undefined) {
  return (value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

async function resolveManualSourceLesson(
  admin: Awaited<ReturnType<typeof getArtifactAdminContext>>["admin"],
  artifactId: string,
  requestedLesson: ManualSourceLessonInput,
) {
  const { data: plan, error } = await admin
    .from("instructional_plans")
    .select("lesson_plans")
    .eq("artifact_id", artifactId)
    .single();
  if (error) throw new Error(error.message);
  const requestedTitle = normalizeLessonKey(requestedLesson.lessonTitle);
  const requestedId = normalizeLessonKey(requestedLesson.lessonId);
  const lesson = buildLessonsToProcess(plan.lesson_plans).find(
    (candidate) =>
      normalizeLessonKey(candidate.lesson_id) === requestedId ||
      normalizeLessonKey(candidate.lesson_title) === requestedTitle,
  );
  if (!lesson) {
    throw new Error("La leccion no pertenece al plan instruccional del curso.");
  }
  return {
    lessonId: lesson.lesson_id,
    lessonTitle: lesson.lesson_title,
  };
}

function getUrlSourceTitle(
  normalizedUrl: string,
  detectedTitle?: string,
) {
  if (detectedTitle) return detectedTitle;
  try {
    return new URL(normalizedUrl).hostname;
  } catch {
    return "URL invalida";
  }
}

async function getOrCreateCurationId(
  admin: Awaited<ReturnType<typeof getArtifactAdminContext>>["admin"],
  artifactId: string,
) {
  const { data: existing, error } = await admin
    .from("curation")
    .select("id")
    .eq("artifact_id", artifactId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (existing?.id) return existing.id;

  const { data: created, error: createError } = await admin
    .from("curation")
    .insert({
      artifact_id: artifactId,
      attempt_number: 1,
      state: "PHASE2_DRAFT",
    })
    .select("id")
    .single();
  if (createError || !created?.id) {
    throw new Error(createError?.message || "No se pudo crear la curaduria.");
  }
  return created.id;
}

function validationColumns(
  report: Awaited<ReturnType<typeof validateUrlSource>>["report"],
  isValid: boolean,
) {
  return {
    validation_report: report,
    url_status:
      report.status === "review_required"
        ? "REVIEW_REQUIRED"
        : isValid
          ? "OK"
          : "BROKEN",
    http_status_code: report.http_status_code ?? null,
    last_checked_at: report.checked_at,
    failure_reason: isValid ? null : report.reason,
    apta: isValid,
    cobertura_completa: isValid,
    motivo_no_apta: isValid ? null : report.reason,
    auto_evaluated: true,
    auto_reason: report.reason,
  };
}

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
    const message = getErrorMessage(error, "Error al obtener curaduria");
    if (message !== "Unauthorized") {
      console.error("[CurationActions] Snapshot error:", message);
    }
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

    try {
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
    } catch (error) {
      const triggerError = getErrorMessage(error);
      await markCurationBlocked(
        admin,
        curationId,
        `No se pudo iniciar el background de curaduria. Detalle: ${triggerError}`,
      );
      throw error;
    }

    return { success: true, curationId };
  } catch (error) {
    const message = getErrorMessage(error, "Error al iniciar curaduria");
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
    const message = getErrorMessage(error, "Error al validar curaduria");
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
    const message = getErrorMessage(error, "Error al actualizar fila");
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
    const message = getErrorMessage(error, "Error al eliminar fila");
    return { success: false, error: message };
  }
}

export async function clearSystemGeneratedCurationRowsAction(artifactId: string) {
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
    await markDownstreamDirtyAction(
      artifactId,
      4,
      "Curaduria (limpieza de fuentes generadas)",
    );
    return { success: true };
  } catch (error) {
    const message = getErrorMessage(
      error,
      "Error limpiando fuentes generadas",
    );
    console.error("[CurationActions] Error clearing generated rows:", message);
    return { success: false, error: message };
  }
}

export async function clearInvalidCurationRowsAction(artifactId: string) {
  try {
    const { admin } = await getArtifactAdminContext(artifactId);
    const { data: curation, error } = await admin
      .from("curation")
      .select("id")
      .eq("artifact_id", artifactId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!curation?.id) return { success: true, deleted: 0 };

    const { data: rows, error: rowsError } = await admin
      .from("curation_rows")
      .select("id, apta, validation_report")
      .eq("curation_id", curation.id);
    if (rowsError) throw new Error(rowsError.message);

    const ids = (rows || [])
      .filter((row) => {
        const report = row.validation_report as { status?: string } | null;
        return row.apta === false || report?.status === "invalid";
      })
      .map((row) => row.id)
      .filter(Boolean);

    if (ids.length === 0) return { success: true, deleted: 0 };

    const { error: deleteError } = await admin
      .from("curation_rows")
      .delete()
      .in("id", ids);
    if (deleteError) throw new Error(deleteError.message);

    await markDownstreamDirtyAction(
      artifactId,
      4,
      "Curaduria (fuentes no aptas eliminadas)",
    );
    return { success: true, deleted: ids.length };
  } catch (error) {
    const message = getErrorMessage(error, "Error eliminando fuentes no aptas");
    console.error("[CurationActions] Error clearing invalid rows:", message);
    return { success: false, error: message };
  }
}

export async function initializeManualCurationAction(artifactId: string) {
  try {
    const { admin } = await getArtifactAdminContext(artifactId);
    const curationId = await getOrCreateCurationId(admin, artifactId);
    return { success: true, curationId };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error, "No se pudo iniciar la curaduria manual."),
    };
  }
}

export async function addManualCurationUrlAction(
  artifactId: string,
  lesson: ManualSourceLessonInput,
  sourceUrl: string,
) {
  try {
    const { admin, authUser } = await getArtifactAdminContext(artifactId);
    const canonicalLesson = await resolveManualSourceLesson(
      admin,
      artifactId,
      lesson,
    );
    const curationId = await getOrCreateCurationId(admin, artifactId);
    const { data: existingRows, error: existingError } = await admin
      .from("curation_rows")
      .select("source_ref")
      .eq("curation_id", curationId)
      .eq("source_kind", "url");
    if (existingError) throw new Error(existingError.message);

    const normalizedExisting = (existingRows || []).flatMap((row) => {
      try {
        return [normalizeSourceUrl(row.source_ref)];
      } catch {
        return [];
      }
    });
    const validation = await validateUrlSource(sourceUrl, {
      existingNormalizedUrls: normalizedExisting,
    });
    if (validation.report.checks.duplicate) {
      throw new Error("La fuente ya esta registrada en esta curaduria.");
    }
    const { error } = await admin.from("curation_rows").insert({
      curation_id: curationId,
      lesson_id: canonicalLesson.lessonId,
      lesson_title: canonicalLesson.lessonTitle,
      component: "LESSON_SOURCE",
      is_critical: true,
      source_ref: validation.normalizedUrl,
      source_title: getUrlSourceTitle(
        validation.normalizedUrl,
        validation.report.detected_title,
      ),
      source_rationale: "Fuente agregada manualmente por el usuario.",
      origin: "manual",
      source_kind: "url",
      added_by: authUser.userId,
      ...validationColumns(validation.report, validation.isValid),
    });
    if (error) throw new Error(error.message);

    await markDownstreamDirtyAction(
      artifactId,
      4,
      "Curaduria (URL manual agregada)",
    );
    return { success: true, validation: validation.report };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error, "No se pudo agregar la URL."),
    };
  }
}

export async function registerManualCurationPdfAction(
  artifactId: string,
  lesson: ManualSourceLessonInput,
  file: {
    storagePath: string;
    fileName: string;
    mimeType: string;
    fileSizeBytes: number;
  },
) {
  try {
    const { admin, authUser, artifact } =
      await getArtifactAdminContext(artifactId);
    const canonicalLesson = await resolveManualSourceLesson(
      admin,
      artifactId,
      lesson,
    );
    if (file.mimeType !== "application/pdf") {
      throw new Error("Solo se permiten archivos PDF.");
    }
    if (file.fileSizeBytes <= 0 || file.fileSizeBytes > 25 * 1024 * 1024) {
      throw new Error("El PDF debe pesar entre 1 byte y 25 MB.");
    }
    const expectedPathPrefix = `organizations/${artifact.organization_id}/curation-sources/${artifactId}/`;
    if (!artifact.organization_id || !file.storagePath.startsWith(expectedPathPrefix)) {
      throw new Error("La ruta del PDF no pertenece a este curso.");
    }
    const curationId = await getOrCreateCurationId(admin, artifactId);
    const { data: blob, error: downloadError } = await admin.storage
      .from("curation-sources")
      .download(file.storagePath);
    if (downloadError || !blob) {
      throw new Error(downloadError?.message || "No se pudo leer el PDF subido.");
    }
    const validation = await validatePdfBuffer(
      new Uint8Array(await blob.arrayBuffer()),
      file.mimeType,
    );

    const { error } = await admin.from("curation_rows").insert({
      curation_id: curationId,
      lesson_id: canonicalLesson.lessonId,
      lesson_title: canonicalLesson.lessonTitle,
      component: "LESSON_SOURCE",
      is_critical: true,
      source_ref: `private://curation-sources/${file.storagePath}`,
      source_title: file.fileName,
      source_rationale: "PDF agregado manualmente por el usuario.",
      origin: "manual",
      source_kind: "pdf",
      storage_bucket: "curation-sources",
      storage_path: file.storagePath,
      file_name: file.fileName,
      mime_type: file.mimeType,
      file_size_bytes: file.fileSizeBytes,
      content_sha256: validation.sha256,
      added_by: authUser.userId,
      ...validationColumns(validation.report, validation.isValid),
    });
    if (error) throw new Error(error.message);

    await markDownstreamDirtyAction(
      artifactId,
      4,
      "Curaduria (PDF manual agregado)",
    );
    return { success: true, validation: validation.report };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error, "No se pudo registrar el PDF."),
    };
  }
}

export async function validateCurationRowAction(rowId: string) {
  try {
    const { admin, artifactId } = await getCurationRowAdminContext(rowId);
    const { data: row, error } = await admin
      .from("curation_rows")
      .select(
        "id, source_kind, source_ref, storage_bucket, storage_path, mime_type, apta, cobertura_completa, forbidden_override",
      )
      .eq("id", rowId)
      .single();
    if (error || !row) throw new Error(error?.message || "Fuente no encontrada.");
    const validation = await validateAndPersistCurationSource(
      admin,
      row as PersistedCurationSource,
    );
    await markDownstreamDirtyAction(
      artifactId,
      4,
      "Curaduria (fuente revalidada)",
    );
    return { success: true, validation: validation.report };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error, "No se pudo revalidar la fuente."),
    };
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
    if (finalStatus === "PHASE2_APPROVED") {
      const [{ data: plan, error: planError }, { data: curation, error: curationError }] =
        await Promise.all([
          admin
            .from("instructional_plans")
            .select("lesson_plans")
            .eq("artifact_id", artifactId)
            .single(),
          admin
            .from("curation")
            .select("id")
            .eq("artifact_id", artifactId)
            .single(),
        ]);
      if (planError) throw new Error(planError.message);
      if (curationError) throw new Error(curationError.message);
      const { data: rows, error: rowsError } = await admin
        .from("curation_rows")
        .select("id, lesson_id, lesson_title, apta, validation_report")
        .eq("curation_id", curation.id);
      if (rowsError) throw new Error(rowsError.message);
      const lessons = buildLessonsToProcess(plan.lesson_plans);
      const lessonIdByTitle = new Map(
        lessons.map((lesson) => [
          normalizeLessonKey(lesson.lesson_title),
          lesson.lesson_id,
        ]),
      );
      const rowsForCoverage = (rows || []).map((row) => ({
        ...row,
        lesson_id:
          lessonIdByTitle.get(normalizeLessonKey(row.lesson_title)) ||
          row.lesson_id,
      }));
      const missing = getMissingLessonCoverage(lessons, rowsForCoverage);
      if (missing.length > 0) {
        return {
          success: false,
          error: `No se puede aprobar: ${missing.length} leccion(es) no tienen una fuente valida.`,
          missingLessons: missing,
        };
      }
      const invalidIds = (rows || [])
        .filter((row) => {
          const report = row.validation_report as { status?: string } | null;
          return row.apta === false || report?.status === "invalid";
        })
        .map((row) => row.id)
        .filter(Boolean);
      if (invalidIds.length > 0) {
        const { error: deleteInvalidError } = await admin
          .from("curation_rows")
          .delete()
          .in("id", invalidIds);
        if (deleteInvalidError) throw new Error(deleteInvalidError.message);
      }
    }
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
    const message = getErrorMessage(error, "Error al actualizar estado");
    return { success: false, error: message };
  }
}

export async function deleteCurationAction(artifactId: string) {
  try {
    const { admin } = await getArtifactAdminContext(artifactId);
    await deleteCurationByArtifactId(admin, artifactId);
    return { success: true };
  } catch (error) {
    const message = getErrorMessage(error, "Error eliminando curaduria");
    console.error("[CurationActions] Error deleting curation:", message);
    return { success: false, error: message };
  }
}
