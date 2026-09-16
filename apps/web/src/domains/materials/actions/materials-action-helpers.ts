"use server";

import { callBackgroundFunctionJson, dispatchBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { generationFailureMessage } from "@/lib/pipeline-generation-policy";
import {
  getAuthorizedArtifactAdmin,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import type { Esp05StepState } from "../types/materials.types";

interface MaterialsAdminRow {
  artifact_id: string;
  id: string;
  state: Esp05StepState;
  version: number;
}

interface LessonMaterialsRelation {
  artifact_id: string;
}

interface MaterialLessonAdminRow {
  state: string;
  id: string;
  iteration_count: number;
  lesson_title: string;
  materials:
    | LessonMaterialsRelation
    | LessonMaterialsRelation[]
    | null;
  materials_id: string;
  max_iterations: number;
}

export async function getAuthorizedMaterialsAdmin(materialsId: string) {
  const admin = getServiceRoleClient();
  const { data: materials, error } = await admin
    .from("materials")
    .select("id, artifact_id, state, version")
    .eq("id", materialsId)
    .maybeSingle();

  if (error) {
    console.error("[MaterialsActions] Error loading materials:", error);
    return null;
  }

  const normalizedMaterials = materials as MaterialsAdminRow | null;

  if (!normalizedMaterials?.artifact_id) {
    return null;
  }

  const authorized = await getAuthorizedArtifactAdmin(
    normalizedMaterials.artifact_id,
  );
  if (!authorized) {
    return null;
  }

  return {
    admin,
    artifactId: normalizedMaterials.artifact_id,
    materials: normalizedMaterials,
  };
}

export async function getAuthorizedMaterialLessonAdmin(lessonId: string) {
  const admin = getServiceRoleClient();
  const { data: lesson, error } = await admin
    .from("material_lessons")
    .select(
      `
        id,
        materials_id,
        lesson_title,
        iteration_count,
        max_iterations,
        state,
        materials!inner (
          artifact_id
        )
      `,
    )
    .eq("id", lessonId)
    .maybeSingle();

  if (error) {
    console.error("[MaterialsActions] Error loading lesson:", error);
    return null;
  }

  const normalizedLesson = lesson as MaterialLessonAdminRow | null;
  const materialsRelation = Array.isArray(normalizedLesson?.materials)
    ? normalizedLesson.materials[0]
    : normalizedLesson?.materials;
  const artifactId = materialsRelation?.artifact_id;

  if (!artifactId || !normalizedLesson) {
    return null;
  }

  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  if (!authorized) {
    return null;
  }

  return {
    admin,
    artifactId,
    lesson: normalizedLesson,
  };
}

export async function callMaterialsNetlifyFunction<
  TData extends Record<string, unknown> = Record<string, unknown>,
>(
  functionName: string,
  payload: Record<string, unknown>,
  fallbackError: string,
  localHandlerLoader?: () => Promise<Record<string, unknown>>,
) {
  if (functionName === "materials-generation-background") {
    await dispatchBackgroundFunctionJson(functionName, payload, {
      fallbackError, localHandlerLoader,
      onFailure: async (error) => {
        const admin = getServiceRoleClient();
        if (payload.lessonId) {
          await admin.rpc("commit_material_generation", {
            p_materials_id: payload.materialsId, p_version: payload.version, p_lesson_id: payload.lessonId,
            p_iteration: payload.iterationNumber, p_rows: [], p_success: false, p_error: generationFailureMessage(error),
          });
        }
        await admin.from("materials").update({ state: "PHASE3_NEEDS_FIX", updated_at: new Date().toISOString() })
          .eq("id", payload.materialsId).eq("version", payload.version).eq("state", "PHASE3_GENERATING");
      },
    });
    return {} as TData;
  }
  return callBackgroundFunctionJson<TData>(functionName, payload, {
    fallbackError,
    localHandlerLoader,
  });
}
