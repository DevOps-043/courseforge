import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Esp05StepState,
  LessonMaterialState,
  QADecision,
} from "../types/materials.types";

interface MaterialsRecord {
  id: string;
  state: Esp05StepState;
  version?: number | null;
}

interface LessonStateRow {
  state: string;
}

export async function fetchMaterialsSnapshot(
  admin: SupabaseClient,
  artifactId: string,
) {
  const { data: materials, error: materialsError } = await admin
    .from("materials")
    .select("*")
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (materialsError) {
    return { materials: null, lessons: [], error: materialsError };
  }

  if (!materials?.id) {
    return { materials: null, lessons: [], error: null };
  }

  const { data: lessons, error: lessonsError } = await admin
    .from("material_lessons")
    .select("*")
    .eq("materials_id", materials.id)
    .order("module_id", { ascending: true })
    .order("lesson_id", { ascending: true });

  return {
    materials,
    lessons: lessons || [],
    error: lessonsError,
  };
}

export async function fetchLessonComponentsSnapshot(
  admin: SupabaseClient,
  lessonId: string,
) {
  return admin
    .from("material_components")
    .select("*")
    .eq("material_lesson_id", lessonId)
    .order("iteration_number", { ascending: false });
}

export async function fetchArtifactMaterialsRecord(
  admin: SupabaseClient,
  artifactId: string,
) {
  const { data, error } = await admin
    .from("materials")
    .select("id, state, version")
    .eq("artifact_id", artifactId)
    .maybeSingle();

  return {
    data: (data || null) as MaterialsRecord | null,
    error,
  };
}

export async function upsertGenerationMaterialsRecord(
  admin: SupabaseClient,
  artifactId: string,
  existing: MaterialsRecord | null,
) {
  return admin
    .from("materials")
    .upsert(
      {
        artifact_id: artifactId,
        state: "PHASE3_GENERATING" as Esp05StepState,
        prompt_version: "prompt05",
        version: existing?.version ? existing.version + 1 : 1,
        qa_decision: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "artifact_id" },
    )
    .select("id")
    .single();
}

export async function updateMaterialsState(
  admin: SupabaseClient,
  materialsId: string,
  state: Esp05StepState,
  qaDecision?: QADecision | null,
) {
  const payload: {
    state: Esp05StepState;
    updated_at: string;
    qa_decision?: QADecision | null;
  } = {
    state,
    updated_at: new Date().toISOString(),
  };

  if (qaDecision !== undefined) {
    payload.qa_decision = qaDecision;
  }

  return admin.from("materials").update(payload).eq("id", materialsId);
}

export async function countNonApprovableLessons(
  admin: SupabaseClient,
  materialsId: string,
) {
  const { count, error } = await admin
    .from("material_lessons")
    .select("id", { count: "exact", head: true })
    .eq("materials_id", materialsId)
    .neq("state", "APPROVABLE");

  return {
    count: count || 0,
    error,
  };
}

export async function fetchResettableMaterialsRecord(
  admin: SupabaseClient,
  artifactId: string,
) {
  const { data, error } = await admin
    .from("materials")
    .select("id, state")
    .eq("artifact_id", artifactId)
    .maybeSingle();

  return {
    data: (data || null) as Pick<MaterialsRecord, "id" | "state"> | null,
    error,
  };
}

export async function resetGeneratingLessons(
  admin: SupabaseClient,
  materialsId: string,
) {
  return admin
    .from("material_lessons")
    .update({
      state: "PENDING" as LessonMaterialState,
      updated_at: new Date().toISOString(),
    })
    .eq("materials_id", materialsId)
    .eq("state", "GENERATING");
}

export function getLessonNotReadyError(
  lessonRows: LessonStateRow[] | null,
) {
  const notReadyCount =
    lessonRows?.filter((lesson) => lesson.state !== "APPROVABLE").length || 0;

  if (notReadyCount === 0) {
    return null;
  }

  return `${notReadyCount} lecciones no estan listas para QA`;
}
