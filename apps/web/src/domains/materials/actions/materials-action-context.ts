import {
  canReviewContent,
  getAuthenticatedUser,
  getAuthorizedArtifactAdmin,
} from "@/lib/server/artifact-action-auth";
import { createClient } from "@/utils/supabase/server";
import {
  getAuthorizedMaterialLessonAdmin,
  getAuthorizedMaterialsAdmin,
} from "./materials-action-helpers";

interface ErrorResult {
  success: false;
  error: string;
}

type MaterialsActionContext<TContext> =
  | ({ ok: true } & TContext)
  | { ok: false; errorResult: ErrorResult };

export function createMaterialsActionError(error: string): ErrorResult {
  return { success: false, error };
}

export async function getAuthorizedArtifactMaterialsContext(
  artifactId: string,
) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) {
    return {
      ok: false,
      errorResult: createMaterialsActionError("Unauthorized"),
    } satisfies MaterialsActionContext<never>;
  }

  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  if (!authorized) {
    return {
      ok: false,
      errorResult: createMaterialsActionError(
        "Artifact not found or inaccessible",
      ),
    } satisfies MaterialsActionContext<never>;
  }

  return {
    ok: true,
    admin: authorized.admin,
    artifact: authorized.artifact,
    authUser,
  } satisfies MaterialsActionContext<{
    admin: typeof authorized.admin;
    artifact: typeof authorized.artifact;
    authUser: NonNullable<typeof authUser>;
  }>;
}

export async function getAuthorizedLessonMaterialsContext(lessonId: string) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) {
    return {
      ok: false,
      errorResult: createMaterialsActionError("Unauthorized"),
    } satisfies MaterialsActionContext<never>;
  }

  const authorizedLesson = await getAuthorizedMaterialLessonAdmin(lessonId);
  if (!authorizedLesson) {
    return {
      ok: false,
      errorResult: createMaterialsActionError(
        "Lesson not found or inaccessible",
      ),
    } satisfies MaterialsActionContext<never>;
  }

  return {
    ok: true,
    admin: authorizedLesson.admin,
    artifactId: authorizedLesson.artifactId,
    authUser,
    lesson: authorizedLesson.lesson,
  } satisfies MaterialsActionContext<{
    admin: typeof authorizedLesson.admin;
    artifactId: string;
    authUser: NonNullable<typeof authUser>;
    lesson: typeof authorizedLesson.lesson;
  }>;
}

export async function getAuthorizedMaterialsContext(materialsId: string) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) {
    return {
      ok: false,
      errorResult: createMaterialsActionError("Unauthorized"),
    } satisfies MaterialsActionContext<never>;
  }

  const authorizedMaterials = await getAuthorizedMaterialsAdmin(materialsId);
  if (!authorizedMaterials) {
    return {
      ok: false,
      errorResult: createMaterialsActionError(
        "Materials not found or inaccessible",
      ),
    } satisfies MaterialsActionContext<never>;
  }

  return {
    ok: true,
    admin: authorizedMaterials.admin,
    artifactId: authorizedMaterials.artifactId,
    authUser,
    materials: authorizedMaterials.materials,
  } satisfies MaterialsActionContext<{
    admin: typeof authorizedMaterials.admin;
    artifactId: string;
    authUser: NonNullable<typeof authUser>;
    materials: typeof authorizedMaterials.materials;
  }>;
}

export async function getAuthorizedMaterialsReviewerContext(materialsId: string) {
  const context = await getAuthorizedMaterialsContext(materialsId);
  if (!context.ok) {
    return context;
  }

  const hasPermission = await canReviewContent(context.authUser.userId);
  if (!hasPermission) {
    return {
      ok: false,
      errorResult: createMaterialsActionError(
        "Forbidden: Requiere rol de Arquitecto o Admin",
      ),
    } satisfies MaterialsActionContext<never>;
  }

  return context;
}
