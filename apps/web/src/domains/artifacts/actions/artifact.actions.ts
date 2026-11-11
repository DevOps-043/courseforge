"use server";

import { dispatchBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { readCourseSourcePolicy } from "@/domains/course-sources/course-source-settings";
import { CourseSourceError } from "@/domains/course-sources/course-source-error";
import { SOURCE_GENERATION_LIMITS } from "@/domains/course-sources/course-source-generation";
import { markArtifactGenerationFailed } from "../lib/artifact-generation-failure";
import { isGenerationStale } from "@/lib/pipeline-generation-policy";
import { getErrorMessage } from "@/lib/errors";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrganizationId } from "@/utils/auth/session";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import type { ArtifactContentUpdates } from "@/app/admin/artifacts/[id]/artifact-view.types";
import {
  canReviewContent,
  getAuthenticatedUser,
  getAuthorizedArtifactAdmin,
} from "@/lib/server/artifact-action-auth";
import { markDownstreamDirtyAction } from "@/lib/server/pipeline-dirty-actions";
import type { CloudStorageProvider } from "@/domains/production/cloud-storage/types";
import {
  resolveVideoDurationPolicy,
  videoDurationPolicySchema,
  type VideoDurationPolicy,
} from "@/domains/video-duration/video-duration-policy";

/**
 * Narrow snapshot for phase-one progress. It deliberately avoids loading the
 * complete artifact workspace while a background job is updating the record.
 */
export async function getArtifactGenerationSnapshotAction(artifactId: string) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false as const, error: "Unauthorized" };

  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  if (!authorized) {
    return { success: false as const, error: "Artifact not found or inaccessible" };
  }

  const { data: artifact, error } = await authorized.admin
    .from("artifacts")
    .select("descripcion, generation_metadata, nombres, objetivos, production_complete, qa_status, state, validation_report, updated_at")
    .eq("id", artifactId)
    .single();

  if (error || !artifact) {
    return { success: false as const, error: error?.message || "Artifact snapshot unavailable" };
  }

  const generationStartedAt = artifact.generation_metadata?.base_progress?.started_at || artifact.updated_at;
  if (artifact.state === "GENERATING" && isGenerationStale(generationStartedAt)) {
    await markArtifactGenerationFailed(authorized.admin, artifactId, artifact.generation_metadata?.run_id, new Error("timeout"), artifact.updated_at);
    return getArtifactGenerationSnapshotAction(artifactId);
  }
  return { success: true as const, artifact };
}

export async function generateArtifactAction(formData: {
  title: string;
  description: string;
  targetAudience: string;
  expectedResults: string;
  courseId?: string;
  cloudStorageProvider?: CloudStorageProvider | null;
  useGoogleDrive?: boolean;
  videoDurationPolicy?: VideoDurationPolicy;
  requestId?: string;
}) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized (No User)" };

  const tenant = await resolveActiveTenantContext();
  const activeOrgId = tenant?.organizationId ?? (await getActiveOrganizationId());
  const artifactId = formData.requestId;
  const runId = randomUUID();
  let created = false;

  try {
    if (!artifactId || !z.uuid().safeParse(artifactId).success || !formData.description?.trim()) {
      return { success: false, error: "Solicitud inválida: se requiere una descripción y un identificador válido." };
    }
    const parsedVideoDurationPolicy = videoDurationPolicySchema.safeParse(formData.videoDurationPolicy);
    if (formData.videoDurationPolicy && !parsedVideoDurationPolicy.success) {
      return {
        success: false,
        error: parsedVideoDurationPolicy.error.issues[0]?.message || "Configuracion de duracion invalida",
      };
    }
    const videoDurationPolicy = resolveVideoDurationPolicy(parsedVideoDurationPolicy.data);
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
        id: artifactId,
        course_id: finalCourseId,
        idea_central: formData.title,
        nombres: [],
        objetivos: [],
        descripcion: {},
        generation_metadata: {
          run_id: runId,
          original_input: { ...formData, videoDurationPolicy },
          started_at: new Date().toISOString(),
          video_duration_policy: videoDurationPolicy,
        },
        state: "GENERATING",
        created_by: authUser.userId,
        organization_id: activeOrgId,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        const { data: existing } = await supabase.from("artifacts").select("id, state")
          .eq("id", artifactId).eq("created_by", authUser.userId).maybeSingle();
        if (existing) {
          return {
            success: true,
            artifactId: existing.id,
            artifactState: existing.state,
            status: "existing",
          };
        }
      }
      throw new Error(`Database Error: ${error.message}`);
    }
    created = true;

    await dispatchBackgroundFunctionJson(
      "generate-artifact-background",
      {
        artifactId: artifact.id,
        runId,
        formData: { ...formData, videoDurationPolicy },
        userId: authUser.userId,
          cloudStorageProvider:
            formData.cloudStorageProvider ||
            (formData.useGoogleDrive ? "google_drive" : null),
          organizationId: activeOrgId,
        },
      {
        fallbackError: "Error al iniciar la generacion del artefacto",
        localHandlerLoader: () =>
          import("../../../../netlify/functions/generate-artifact-background"),
        onFailure: (error) => markArtifactGenerationFailed(supabase, artifactId, runId, error),
      },
    );

    return { success: true, artifactId: artifact.id, status: "queued" };
  } catch (error: unknown) {
    if (created && artifactId) {
      await markArtifactGenerationFailed(supabase, artifactId, runId, error);
    }
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
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  const tenant = await resolveActiveTenantContext();
  const activeOrgId = tenant?.organizationId ?? (await getActiveOrganizationId());
  let artifactQuery = supabase
    .from("artifacts")
    .select("generation_metadata, state")
    .eq("id", artifactId);

  if (activeOrgId) {
    artifactQuery = artifactQuery.eq("organization_id", activeOrgId);
  }

  const { data: artifact } = await artifactQuery.single();
  if (!artifact) return { success: false, error: "Artifact not found" };
  if (artifact.state === "GENERATING") return { success: false, error: "La generación ya está en curso." };
  const runId = randomUUID();

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
        run_id: runId,
        base_progress: null,
        started_at: new Date().toISOString(),
        feedback_history: [
          ...(artifact.generation_metadata.feedback_history || []),
          { date: new Date(), feedback },
        ],
        last_feedback: feedback,
      },
    })
    .eq("id", artifactId).eq("state", artifact.state);

  if (activeOrgId) {
    resetQuery = resetQuery.eq("organization_id", activeOrgId);
  }

  const { data: resetArtifact, error: resetError } = await resetQuery.select("id").maybeSingle();
  if (resetError) return { success: false, error: resetError.message };
  if (!resetArtifact) return { success: false, error: "Otra solicitud ya inició la generación." };

  try {
    await dispatchBackgroundFunctionJson(
      "generate-artifact-background",
      {
        artifactId,
        runId,
        userId: authUser.userId,
        organizationId: activeOrgId,
        formData: originalInput,
        feedback,
      },
      {
        fallbackError: "Error al relanzar la generacion del artefacto",
        localHandlerLoader: () =>
          import("../../../../netlify/functions/generate-artifact-background"),
        onFailure: (error) => markArtifactGenerationFailed(supabase, artifactId, runId, error),
      },
    );

    return { success: true };
  } catch (error: unknown) {
    await markArtifactGenerationFailed(supabase, artifactId, runId, error);
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
  const parsed = z.object({
    nombres: z.array(z.string().max(500)).max(20).optional(),
    objetivos: z.array(z.string().max(2000)).max(30).optional(),
    descripcion: z.record(z.string(), z.unknown()).optional(),
  }).strict().safeParse(updates);
  if (!z.uuid().safeParse(artifactId).success || !parsed.success) return { success: false, error: "Los campos de edición no cumplen el contrato permitido." };
  try {
    if (JSON.stringify(parsed.data).length > SOURCE_GENERATION_LIMITS.outputCharacters) return { success: false, error: "El contenido editado supera el límite permitido." };
    const authorized = await getAuthorizedArtifactAdmin(artifactId);
    if (!authorized) return { success: false, error: "Curso no encontrado o sin permiso de edición." };
    const policy = await readCourseSourcePolicy(authorized.admin, artifactId);
    if (policy && policy.policy !== "WEB_ONLY") return { success: false, error: "Para cambiar contenido documental, usa Regenerar con tu retroalimentación. La nueva versión debe comprobar sus fuentes antes de guardarse." };
    let query = authorized.admin.from("artifacts").update(parsed.data).eq("id", artifactId);
    query = authorized.artifact.organization_id ? query.eq("organization_id", authorized.artifact.organization_id) : query.is("organization_id", null);
    const result = await query.select("id").maybeSingle();
    if (result.error || !result.data) return { success: false, error: "No se pudo guardar el contenido. Actualiza antes de reintentar." };
    await markDownstreamDirtyAction(artifactId, 1, "Idea Central");
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof CourseSourceError ? error.message : "No se pudo guardar el contenido de forma segura. Actualiza antes de reintentar." };
  }
}

export async function updateArtifactAssetsCompleteAction(
  artifactId: string,
  isComplete: boolean,
) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) return { success: false, error: "Unauthorized" };

  try {
    const tenant = await resolveActiveTenantContext();
    const activeOrgId = tenant?.organizationId ?? (await getActiveOrganizationId());
    let query = supabase.from("artifacts").select("generation_metadata").eq("id", artifactId);
    if (activeOrgId) {
      query = query.eq("organization_id", activeOrgId);
    }
    
    const { data: artifact, error: fetchError } = await query.single();
    if (fetchError || !artifact) {
      return { success: false, error: "Artifact not found" };
    }

    const currentMetadata = artifact.generation_metadata || {};
    const updatedMetadata = {
      ...currentMetadata,
      assets_complete: isComplete,
    };

    let updateQuery = supabase
      .from("artifacts")
      .update({ generation_metadata: updatedMetadata })
      .eq("id", artifactId);

    if (activeOrgId) {
      updateQuery = updateQuery.eq("organization_id", activeOrgId);
    }

    const { error: updateError } = await updateQuery;
    if (updateError) {
      return { success: false, error: updateError.message };
    }

    return { success: true };
  } catch (error: unknown) {
    console.error("[ArtifactActions] Error updating assets complete status:", error);
    return { success: false, error: getErrorMessage(error) };
  }
}
