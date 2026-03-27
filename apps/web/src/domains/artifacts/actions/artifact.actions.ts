"use server";

import { createClient } from "@/utils/supabase/server";
import { getActiveOrganizationId } from "@/utils/auth/session";
import {
  canReviewContent,
  getAccessToken,
  getAuthenticatedUser,
  getAuthorizedArtifactAdmin,
  getBackgroundFunctionsBaseUrl,
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

    const triggerResponse = await fetch(
      `${getBackgroundFunctionsBaseUrl()}/.netlify/functions/generate-artifact-background`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          artifactId: artifact.id,
          formData,
          userToken: accessToken,
        }),
      },
    );

    if (!triggerResponse.ok) {
      console.warn(
        `[ArtifactActions] Background trigger failed: ${triggerResponse.status}`,
      );
    }

    return { success: true, artifactId: artifact.id, status: "queued" };
  } catch (error: any) {
    console.error("[ArtifactActions] Generation error:", error);
    return {
      success: false,
      error: error.message || "Error initiating generation",
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
    const triggerResponse = await fetch(
      `${getBackgroundFunctionsBaseUrl()}/.netlify/functions/generate-artifact-background`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          artifactId,
          userToken: session.access_token,
          formData: originalInput,
          feedback,
        }),
      },
    );

    if (!triggerResponse.ok) {
      console.warn(
        `[ArtifactActions] Background regeneration trigger failed: ${triggerResponse.status}`,
      );
    }

    return { success: true };
  } catch (error: any) {
    console.error("[ArtifactActions] Regeneration error:", error);
    return { success: false, error: error.message };
  }
}

export async function updateArtifactContentAction(
  artifactId: string,
  updates: { nombres?: string[]; objetivos?: string[]; descripcion?: any },
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
  } catch (error: any) {
    console.error("[ArtifactActions] Delete error:", error);
    return { success: false, error: error.message };
  }
}
