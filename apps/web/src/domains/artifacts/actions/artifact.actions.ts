"use server";

import { callBackgroundFunctionJson } from "@/lib/server/background-function-client";
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
      error:
        error instanceof Error
          ? error.message
          : "Error initiating generation",
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
      error: error instanceof Error ? error.message : "Error regenerating artifact",
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
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { success: false, error: "Unauthorized" };

  try {
    const deleteTargets = [
      "publication_requests",
      "pipeline_events",
      "curation",
      "materials",
      "instructional_plans",
      "syllabus",
    ] as const;

    for (const table of deleteTargets) {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq("artifact_id", artifactId);
      if (error) {
        console.warn(`[ArtifactActions] Error deleting ${table}:`, error);
      }
    }

    const { error: artifactError } = await supabase
      .from("artifacts")
      .delete()
      .eq("id", artifactId);

    if (artifactError) {
      return { success: false, error: artifactError.message };
    }

    return { success: true };
  } catch (error: unknown) {
    console.error("[ArtifactActions] Delete error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error deleting artifact",
    };
  }
}
