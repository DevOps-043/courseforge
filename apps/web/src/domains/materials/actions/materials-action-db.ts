import type { SupabaseClient } from "@supabase/supabase-js";
import { isGenerationStale } from "@/lib/pipeline-generation-policy";
import type {
  Esp05StepState,
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

const MATERIALS_SNAPSHOT_SELECT = `
  id,
  artifact_id,
  version,
  prompt_version,
  state,
  qa_decision,
  package,
  lessons,
  global_blockers,
  dod,
  created_at,
  updated_at,
  upstream_dirty,
  upstream_dirty_source
`;

const MATERIAL_LESSONS_SNAPSHOT_SELECT = `
  id,
  materials_id,
  lesson_id,
  lesson_title,
  module_id,
  module_title,
  oa_text,
  expected_components,
  quiz_spec,
  requires_demo_guide,
  dod,
  state,
  iteration_count,
  max_iterations,
  created_at,
  updated_at
`;

const MATERIAL_COMPONENTS_SNAPSHOT_SELECT = `
  id,
  material_lesson_id,
  type,
  content,
  source_refs,
  validation_status,
  validation_errors,
  generated_at,
  iteration_number,
  assets
`;

export async function fetchMaterialsSnapshot(
  admin: SupabaseClient,
  artifactId: string,
) {
  const { data: materials, error: materialsError } = await admin
    .from("materials")
    .select(MATERIALS_SNAPSHOT_SELECT)
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (materialsError) {
    return { materials: null, lessons: [], error: materialsError };
  }

  if (!materials?.id) {
    return { materials: null, lessons: [], error: null };
  }
  if (materials.state === "PHASE3_GENERATING" && isGenerationStale(materials.updated_at)) {
    const { data: recovered, error } = await admin.rpc("reset_material_generation", {
      p_materials_id: materials.id, p_version: materials.version, p_stale_before: materials.updated_at,
    });
    if (error) return { materials: null, lessons: [], error };
    if (recovered) { materials.state = "PHASE3_NEEDS_FIX"; materials.version += 1; }
  }

  const { data: lessons, error: lessonsError } = await admin
    .from("material_lessons")
    .select(MATERIAL_LESSONS_SNAPSHOT_SELECT)
    .eq("materials_id", materials.id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

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
    .select(MATERIAL_COMPONENTS_SNAPSHOT_SELECT)
    .eq("material_lesson_id", lessonId)
    .order("iteration_number", { ascending: false });
}

export async function fetchArtifactComponentsSnapshot(
  admin: SupabaseClient,
  artifactId: string,
) {
  return admin
    .from("material_components")
    .select(`
      ${MATERIAL_COMPONENTS_SNAPSHOT_SELECT},
      material_lessons!inner (
        materials!inner (
          artifact_id
        )
      )
    `)
    .eq("material_lessons.materials.artifact_id", artifactId)
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

export async function startGenerationMaterialsRecord(
  admin: SupabaseClient,
  artifactId: string,
  existing: MaterialsRecord | null,
) {
  const { data, error } = await admin.rpc("start_material_generation", {
    p_artifact_id: artifactId, p_expected_version: existing?.version ?? null,
  });
  return { data: data as { id: string; version: number } | null, error };
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
    .select("id, state, version")
    .eq("artifact_id", artifactId)
    .maybeSingle();

  return {
    data: (data || null) as Pick<MaterialsRecord, "id" | "state" | "version"> | null,
    error,
  };
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
