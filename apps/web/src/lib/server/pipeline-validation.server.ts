import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatPipelineValidationError,
  validatePipelinePhase,
  type PipelinePhase,
  type PipelineValidationInput,
  type PipelineValidationResult,
} from "@/lib/pipeline-validation";

const ARTIFACT_GATE_SELECT = `
  id,
  idea_central,
  objetivos,
  nombres,
  descripcion,
  state,
  production_complete,
  generation_metadata,
  organization_id
`;

const SYLLABUS_GATE_SELECT = `
  id,
  state,
  modules,
  validation,
  qa,
  upstream_dirty
`;

const PLAN_GATE_SELECT = `
  id,
  state,
  lesson_plans,
  blockers,
  dod,
  approvals,
  final_status,
  validation,
  upstream_dirty
`;

const CURATION_GATE_SELECT = `
  id,
  state,
  qa_decision,
  upstream_dirty
`;

const MATERIALS_GATE_SELECT = `
  id,
  state,
  qa_decision,
  package,
  global_blockers,
  dod,
  upstream_dirty
`;

export class PipelineValidationError extends Error {
  constructor(public readonly validation: PipelineValidationResult) {
    super(formatPipelineValidationError(validation));
    this.name = "PipelineValidationError";
  }
}

export async function loadPipelineValidationInput(
  admin: SupabaseClient,
  artifactId: string,
): Promise<PipelineValidationInput> {
  const { data: artifact, error: artifactError } = await admin
    .from("artifacts")
    .select(ARTIFACT_GATE_SELECT)
    .eq("id", artifactId)
    .maybeSingle();

  if (artifactError) {
    throw new Error(`No se pudo leer el artefacto: ${artifactError.message}`);
  }

  const { data: syllabus, error: syllabusError } = await admin
    .from("syllabus")
    .select(SYLLABUS_GATE_SELECT)
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (syllabusError) {
    throw new Error(`No se pudo leer el temario: ${syllabusError.message}`);
  }

  const { data: plan, error: planError } = await admin
    .from("instructional_plans")
    .select(PLAN_GATE_SELECT)
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (planError) {
    throw new Error(`No se pudo leer el plan instruccional: ${planError.message}`);
  }

  const { data: curation, error: curationError } = await admin
    .from("curation")
    .select(CURATION_GATE_SELECT)
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (curationError) {
    throw new Error(`No se pudo leer la curacion: ${curationError.message}`);
  }

  const { data: curationRows, error: rowsError } = curation?.id
    ? await admin
        .from("curation_rows")
        .select("apta, cobertura_completa, failure_reason, url_status")
        .eq("curation_id", curation.id)
    : { data: [], error: null };

  if (rowsError) {
    throw new Error(`No se pudieron leer las fuentes: ${rowsError.message}`);
  }

  const { data: materials, error: materialsError } = await admin
    .from("materials")
    .select(MATERIALS_GATE_SELECT)
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (materialsError) {
    throw new Error(`No se pudieron leer los materiales: ${materialsError.message}`);
  }

  const { data: materialLessons, error: lessonsError } = materials?.id
    ? await admin
        .from("material_lessons")
        .select("id, state, expected_components")
        .eq("materials_id", materials.id)
    : { data: [], error: null };

  if (lessonsError) {
    throw new Error(`No se pudieron leer las lecciones de materiales: ${lessonsError.message}`);
  }

  const lessonIds = (materialLessons || [])
    .map((lesson: { id?: string | null }) => lesson.id)
    .filter(Boolean) as string[];

  const { data: materialComponents, error: componentsError } =
    lessonIds.length > 0
      ? await admin
          .from("material_components")
          .select("type, validation_status, assets")
          .in("material_lesson_id", lessonIds)
      : { data: [], error: null };

  if (componentsError) {
    throw new Error(`No se pudieron leer los componentes de materiales: ${componentsError.message}`);
  }

  const { data: publicationRequest, error: publicationError } = await admin
    .from("publication_requests")
    .select(
      "status, category, level, instructor_email, slug, lesson_videos, selected_lessons, upstream_dirty",
    )
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (publicationError) {
    throw new Error(`No se pudo leer la publicacion: ${publicationError.message}`);
  }

  return {
    artifact,
    curation,
    curationRows: curationRows || [],
    materialComponents: materialComponents || [],
    materialLessons: materialLessons || [],
    materials,
    plan,
    publicationRequest,
    syllabus,
  };
}

export async function validatePipelinePhaseForArtifact(
  admin: SupabaseClient,
  artifactId: string,
  phase: PipelinePhase,
) {
  const input = await loadPipelineValidationInput(admin, artifactId);
  return validatePipelinePhase(phase, input);
}

export async function assertPipelinePhaseAllowed(
  admin: SupabaseClient,
  artifactId: string,
  phase: PipelinePhase,
) {
  const validation = await validatePipelinePhaseForArtifact(admin, artifactId, phase);
  if (!validation.allowed) {
    throw new PipelineValidationError(validation);
  }

  return validation;
}
