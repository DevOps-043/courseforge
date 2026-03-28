"use server";

import { callBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { getErrorMessage } from "@/lib/errors";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrganizationId } from "@/utils/auth/session";
import type { ArtifactContentUpdates } from "@/app/admin/artifacts/[id]/artifact-view.types";
import {
  canReviewContent,
  getAccessToken,
  getAuthenticatedUser,
  getAuthorizedArtifactAdmin,
} from "@/lib/server/artifact-action-auth";
import { markDownstreamDirtyAction } from "@/lib/server/pipeline-dirty-actions";

export async function generateArtifactAction(formData: {
  title: string;
  description: string;
  targetAudience: string;
  expectedResults: string;
  courseId?: string;
}) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized (No User)" };

  const accessToken = await getAccessToken(supabase);
  if (!accessToken) return { success: false, error: "Unauthorized (No Token)" };

  const activeOrgId = await getActiveOrganizationId();

  try {
    let finalCourseId = formData.courseId?.trim();
    if (!finalCourseId) {
      const prefix = formData.title
        .split(" ")[0]
        .toUpperCase()
        .substring(0, 10)
        .replace(/[^A-Z0-9]/g, "");
      const random = Math.floor(1000 + Math.random() * 9000);
      finalCourseId = `${prefix || "COURSE"}-${random}`;
    }

    const { data: artifact, error } = await supabase
      .from("artifacts")
      .insert({
        course_id: finalCourseId,
        idea_central: formData.title,
        nombres: [],
        objetivos: [],
        descripcion: {},
        generation_metadata: {
          original_input: formData,
          started_at: new Date().toISOString(),
        },
        state: "GENERATING",
        created_by: authUser.userId,
        organization_id: activeOrgId,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Database Error: ${error.message}`);
    }

    await callBackgroundFunctionJson(
      "generate-artifact-background",
      {
        artifactId: artifact.id,
        formData,
        userToken: accessToken,
      },
      {
        fallbackError: "Error al iniciar la generacion del artefacto",
        localHandlerLoader: () =>
          import("../../../../netlify/functions/generate-artifact-background"),
      },
    );

    return { success: true, artifactId: artifact.id, status: "queued" };
  } catch (error: unknown) {
    console.error("[ArtifactActions] Generation error:", error);
    return {
      success: false,
      error: getErrorMessage(error, "Error initiating generation"),
    };
  }
}

export async function updateArtifactStatusAction(
  artifactId: string,
  status: string,
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
    .from("artifacts")
    .update({ state: status })
    .eq("id", artifactId);

  if (error) {
    console.error("[ArtifactActions] Error updating artifact status:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function regenerateArtifactAction(
  artifactId: string,
  feedback?: string,
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

  const activeOrgId = await getActiveOrganizationId();
  let artifactQuery = supabase
    .from("artifacts")
    .select("generation_metadata")
    .eq("id", artifactId);

  if (activeOrgId) {
    artifactQuery = artifactQuery.eq("organization_id", activeOrgId);
  }

  const { data: artifact } = await artifactQuery.single();
  if (!artifact) return { success: false, error: "Artifact not found" };

  const originalInput = artifact.generation_metadata?.original_input;
  if (!originalInput) return { success: false, error: "Original input lost" };

  let resetQuery = supabase
    .from("artifacts")
    .update({
      nombres: [],
      objetivos: [],
      descripcion: {},
      state: "GENERATING",
      generation_metadata: {
        ...artifact.generation_metadata,
        feedback_history: [
          ...(artifact.generation_metadata.feedback_history || []),
          { date: new Date(), feedback },
        ],
        last_feedback: feedback,
      },
    })
    .eq("id", artifactId);

  if (activeOrgId) {
    resetQuery = resetQuery.eq("organization_id", activeOrgId);
  }

  const { error: resetError } = await resetQuery;
  if (resetError) return { success: false, error: resetError.message };

  try {
    await callBackgroundFunctionJson(
      "generate-artifact-background",
      {
        artifactId,
        userToken: session.access_token,
        formData: originalInput,
        feedback,
      },
      {
        fallbackError: "Error al relanzar la generacion del artefacto",
        localHandlerLoader: () =>
          import("../../../../netlify/functions/generate-artifact-background"),
      },
    );

    return { success: true };
  } catch (error: unknown) {
    console.error("[ArtifactActions] Regeneration error:", error);
    return {
      success: false,
      error: getErrorMessage(error, "Error regenerating artifact"),
    };
  }
}

export async function updateArtifactContentAction(
  artifactId: string,
  updates: ArtifactContentUpdates,
) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const activeOrgId = await getActiveOrganizationId();
  let query = supabase.from("artifacts").update(updates).eq("id", artifactId);
  if (activeOrgId) {
    query = query.eq("organization_id", activeOrgId);
  }

  const { error } = await query;
  if (error) return { success: false, error: error.message };

  await markDownstreamDirtyAction(artifactId, 1, "Idea Central");
  return { success: true };
}

export async function deleteArtifactAction(artifactId: string) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized (No User)" };

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

  try {
    // Orden de eliminación respeta dependencias FK (hijos antes que padres):
    // 1. Tablas sin hijos propios
    // 2. curation_rows/curation_blockers antes de curation
    // 3. material_components → material_lessons → materials
    const deleteSequence: Array<{
      table: string;
      filterColumn: string;
      parentTable?: string;
      parentFilterColumn?: string;
    }> = [
      { table: "publication_requests", filterColumn: "artifact_id" },
      { table: "pipeline_events", filterColumn: "artifact_id" },
      { table: "syllabus", filterColumn: "artifact_id" },
      { table: "instructional_plans", filterColumn: "artifact_id" },
    ];

    // Eliminar hijos de curation (curation_rows, curation_blockers)
    const { data: curations } = await admin
      .from("curation")
      .select("id")
      .eq("artifact_id", artifactId);

    if (curations && curations.length > 0) {
      const curationIds = curations.map((c) => c.id);
      for (const table of ["curation_rows", "curation_blockers"] as const) {
        const { error } = await admin
          .from(table)
          .delete()
          .in("curation_id", curationIds);
        if (error) {
          console.warn(`[DeleteArtifact] Error deleting ${table}:`, error.message);
        }
      }
    }

    // Eliminar hijos de materials (material_components → material_lessons)
    const { data: materialsRows } = await admin
      .from("materials")
      .select("id")
      .eq("artifact_id", artifactId);

    if (materialsRows && materialsRows.length > 0) {
      const materialsIds = materialsRows.map((m) => m.id);
      const { data: lessons } = await admin
        .from("material_lessons")
        .select("id")
        .in("materials_id", materialsIds);

      if (lessons && lessons.length > 0) {
        const lessonIds = lessons.map((l) => l.id);
        const { error: compError } = await admin
          .from("material_components")
          .delete()
          .in("material_lesson_id", lessonIds);
        if (compError) {
          console.warn("[DeleteArtifact] Error deleting material_components:", compError.message);
        }
      }

      const { error: lessonsError } = await admin
        .from("material_lessons")
        .delete()
        .in("materials_id", materialsIds);
      if (lessonsError) {
        console.warn("[DeleteArtifact] Error deleting material_lessons:", lessonsError.message);
      }
    }

    // Eliminar tablas padre directas del artefacto
    for (const target of [...deleteSequence, { table: "curation", filterColumn: "artifact_id" }, { table: "materials", filterColumn: "artifact_id" }]) {
      const { error } = await admin
        .from(target.table)
        .delete()
        .eq(target.filterColumn, artifactId);
      if (error) {
        console.warn(`[DeleteArtifact] Error deleting ${target.table}:`, error.message);
      }
    }

    // Eliminar el artefacto
    const { error: artifactError } = await admin
      .from("artifacts")
      .delete()
      .eq("id", artifactId);

    if (artifactError) {
      console.error("[DeleteArtifact] Error deleting artifact:", artifactError.message);
      return { success: false, error: artifactError.message };
    }

    return { success: true };
  } catch (error: unknown) {
    console.error("[DeleteArtifact] Unexpected error:", error);
    return {
      success: false,
      error: getErrorMessage(error, "Error deleting artifact"),
    };
  }
}
