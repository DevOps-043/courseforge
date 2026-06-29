import {
  CURATION_STATES,
  MATERIALS_STATES,
  PLAN_STATES,
  SYLLABUS_STATES,
} from "./pipeline-constants";

export type PipelinePhase =
  | "BASE"
  | "SYLLABUS"
  | "INSTRUCTIONAL_PLAN"
  | "CURATION"
  | "MATERIALS"
  | "PRODUCTION"
  | "PUBLICATION";

export interface PipelineValidationError {
  code: string;
  message: string;
  field?: string;
}

export interface PipelineValidationResult {
  allowed: boolean;
  errors: PipelineValidationError[];
  phase: PipelinePhase;
}

interface ArtifactGateRecord {
  descripcion?: unknown;
  generation_metadata?: Record<string, unknown> | null;
  idea_central?: string | null;
  nombres?: unknown;
  objetivos?: unknown;
  production_complete?: boolean | null;
  state?: string | null;
}

interface SyllabusGateRecord {
  modules?: unknown;
  qa?: { status?: string | null } | null;
  state?: string | null;
  validation?: {
    automatic_pass?: boolean | null;
    checks?: Array<{ pass?: boolean | null }> | null;
  } | null;
  upstream_dirty?: boolean | null;
}

interface PlanGateRecord {
  approvals?: { architect_status?: string | null } | null;
  blockers?: unknown;
  final_status?: string | null;
  lesson_plans?: unknown;
  state?: string | null;
  upstream_dirty?: boolean | null;
  validation?: unknown;
}

interface CurationGateRecord {
  qa_decision?: { decision?: string | null } | null;
  state?: string | null;
  upstream_dirty?: boolean | null;
}

interface CurationRowGateRecord {
  apta?: boolean | null;
  cobertura_completa?: boolean | null;
  failure_reason?: string | null;
  url_status?: string | null;
}

interface MaterialsGateRecord {
  dod?: { automatic_checks?: Array<{ pass?: boolean | null }> | null } | null;
  global_blockers?: unknown;
  package?: unknown;
  qa_decision?: { decision?: string | null } | null;
  state?: string | null;
  upstream_dirty?: boolean | null;
}

interface MaterialLessonGateRecord {
  expected_components?: unknown;
  state?: string | null;
}

interface MaterialComponentGateRecord {
  assets?: Record<string, unknown> | null;
  type?: string | null;
  validation_status?: string | null;
}

interface PublicationRequestGateRecord {
  category?: string | null;
  instructor_email?: string | null;
  lesson_videos?: unknown;
  level?: string | null;
  selected_lessons?: unknown;
  slug?: string | null;
  status?: string | null;
  upstream_dirty?: boolean | null;
}

export interface PipelineValidationInput {
  artifact?: ArtifactGateRecord | null;
  curation?: CurationGateRecord | null;
  curationRows?: CurationRowGateRecord[];
  materialComponents?: MaterialComponentGateRecord[];
  materialLessons?: MaterialLessonGateRecord[];
  materials?: MaterialsGateRecord | null;
  plan?: PlanGateRecord | null;
  publicationRequest?: PublicationRequestGateRecord | null;
  syllabus?: SyllabusGateRecord | null;
}

function result(
  phase: PipelinePhase,
  errors: PipelineValidationError[],
): PipelineValidationResult {
  return {
    allowed: errors.length === 0,
    errors,
    phase,
  };
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasItems(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

function qaApproved(value?: { status?: string | null } | null) {
  return value?.status === "APPROVED";
}

function validationPassed(
  validation?: SyllabusGateRecord["validation"],
): boolean {
  if (!validation) return false;
  if (validation.automatic_pass === true) return true;
  const checks = validation.checks;
  return Array.isArray(checks) && checks.length > 0 && checks.every((check) => check.pass === true);
}

export function validateBaseGate(
  input: PipelineValidationInput,
): PipelineValidationResult {
  const artifact = input.artifact;
  const errors: PipelineValidationError[] = [];

  if (!artifact) {
    errors.push({ code: "BASE_MISSING", message: "No existe el artefacto base." });
  } else {
    if (!hasText(artifact.idea_central)) {
      errors.push({
        code: "BASE_IDEA_REQUIRED",
        field: "idea_central",
        message: "La idea central es obligatoria antes de aprobar BASE.",
      });
    }
    if (!hasItems(artifact.objetivos)) {
      errors.push({
        code: "BASE_OBJECTIVES_REQUIRED",
        field: "objetivos",
        message: "BASE requiere al menos un objetivo de aprendizaje generado.",
      });
    }
    if (!hasItems(artifact.nombres)) {
      errors.push({
        code: "BASE_NAMES_REQUIRED",
        field: "nombres",
        message: "BASE requiere al menos una propuesta de nombre para el curso.",
      });
    }
    if (artifact.state === "GENERATING") {
      errors.push({
        code: "BASE_STILL_GENERATING",
        field: "state",
        message: "BASE sigue en generacion; espera a que termine antes de aprobar.",
      });
    }
  }

  return result("BASE", errors);
}

export function validateSyllabusGate(
  input: PipelineValidationInput,
): PipelineValidationResult {
  const errors = [...validateBaseGate(input).errors];
  const syllabus = input.syllabus;

  if (!syllabus) {
    errors.push({ code: "SYLLABUS_MISSING", message: "No existe un temario para validar." });
  } else {
    if (syllabus.upstream_dirty) {
      errors.push({
        code: "SYLLABUS_UPSTREAM_DIRTY",
        message: "El temario tiene cambios previos sin reconciliar.",
      });
    }
    if (!hasItems(syllabus.modules)) {
      errors.push({
        code: "SYLLABUS_MODULES_REQUIRED",
        field: "modules",
        message: "El temario requiere modulos y lecciones antes de aprobar.",
      });
    } else {
      const invalidModule = (syllabus.modules as Array<Record<string, unknown>>).find(
        (module) => !hasText(module.title) || !hasItems(module.lessons),
      );
      if (invalidModule) {
        errors.push({
          code: "SYLLABUS_INVALID_STRUCTURE",
          field: "modules",
          message: "Cada modulo del temario debe tener titulo y al menos una leccion.",
        });
      }
    }
    if (!validationPassed(syllabus.validation)) {
      errors.push({
        code: "SYLLABUS_VALIDATION_REQUIRED",
        field: "validation",
        message: "El temario debe tener validacion automatica aprobada.",
      });
    }
  }

  return result("SYLLABUS", errors);
}

export function validateInstructionalPlanGate(
  input: PipelineValidationInput,
): PipelineValidationResult {
  const errors = [...validateSyllabusGate(input).errors];
  const syllabus = input.syllabus;
  const plan = input.plan;

  if (syllabus && syllabus.state !== SYLLABUS_STATES.APPROVED && !qaApproved(syllabus.qa)) {
    errors.push({
      code: "SYLLABUS_QA_REQUIRED",
      field: "syllabus.state",
      message: "El temario debe estar aprobado por QA antes de aprobar el plan instruccional.",
    });
  }

  if (!plan) {
    errors.push({
      code: "PLAN_MISSING",
      message: "No existe plan instruccional para aprobar.",
    });
  } else {
    if (plan.upstream_dirty) {
      errors.push({
        code: "PLAN_UPSTREAM_DIRTY",
        message: "El plan instruccional tiene cambios previos sin reconciliar.",
      });
    }
    if (!hasItems(plan.lesson_plans)) {
      errors.push({
        code: "PLAN_LESSONS_REQUIRED",
        field: "lesson_plans",
        message: "El plan instruccional requiere lecciones generadas.",
      });
    }
    if (hasItems(plan.blockers)) {
      errors.push({
        code: "PLAN_BLOCKERS_OPEN",
        field: "blockers",
        message: "El plan instruccional mantiene bloqueadores abiertos.",
      });
    }
    if (!plan.validation) {
      errors.push({
        code: "PLAN_VALIDATION_REQUIRED",
        field: "validation",
        message: "Ejecuta la validacion del plan antes de aprobarlo.",
      });
    }
    if (plan.state === PLAN_STATES.PROCESSING) {
      errors.push({
        code: "PLAN_STILL_PROCESSING",
        field: "state",
        message: "El plan sigue en proceso; espera a que termine.",
      });
    }
  }

  return result("INSTRUCTIONAL_PLAN", errors);
}

export function validateCurationGate(
  input: PipelineValidationInput,
): PipelineValidationResult {
  const errors = [...validateInstructionalPlanGate(input).errors];
  const plan = input.plan;
  const curation = input.curation;
  const rows = input.curationRows || [];

  if (
    plan &&
    plan.state !== PLAN_STATES.APPROVED &&
    plan.final_status !== "APPROVED_PHASE_1" &&
    plan.approvals?.architect_status !== "APPROVED"
  ) {
    errors.push({
      code: "PLAN_QA_REQUIRED",
      field: "instructional_plans.state",
      message: "El plan instruccional debe estar aprobado antes de aprobar curacion.",
    });
  }

  if (!curation) {
    errors.push({
      code: "CURATION_MISSING",
      message: "No existe curacion para aprobar.",
    });
  } else {
    if (curation.upstream_dirty) {
      errors.push({
        code: "CURATION_UPSTREAM_DIRTY",
        message: "La curacion tiene cambios previos sin reconciliar.",
      });
    }
    if (curation.state !== CURATION_STATES.READY_FOR_QA && curation.state !== CURATION_STATES.APPROVED) {
      errors.push({
        code: "CURATION_STATE_INVALID",
        field: "curation.state",
        message: "La curacion debe estar lista para QA antes de aprobar.",
      });
    }
  }

  if (rows.length === 0) {
    errors.push({
      code: "CURATION_ROWS_REQUIRED",
      field: "curation_rows",
      message: "La curacion requiere fuentes antes de aprobar.",
    });
  }

  const pendingRows = rows.filter((row) => row.apta === null || row.apta === undefined);
  if (pendingRows.length > 0) {
    errors.push({
      code: "CURATION_ROWS_PENDING",
      field: "curation_rows.apta",
      message: `Hay ${pendingRows.length} fuentes pendientes de decision QA.`,
    });
  }

  const brokenRows = rows.filter((row) => row.apta === true && row.url_status && row.url_status !== "OK");
  if (brokenRows.length > 0) {
    errors.push({
      code: "CURATION_APPROVED_BROKEN_ROWS",
      field: "curation_rows.url_status",
      message: `Hay ${brokenRows.length} fuentes aprobadas sin URL valida.`,
    });
  }

  return result("CURATION", errors);
}

export function validateMaterialsGate(
  input: PipelineValidationInput,
): PipelineValidationResult {
  const errors = [...validateCurationGate(input).errors];
  const curation = input.curation;
  const materials = input.materials;
  const lessons = input.materialLessons || [];

  if (
    curation &&
    curation.state !== CURATION_STATES.APPROVED &&
    curation.qa_decision?.decision !== "APPROVED"
  ) {
    errors.push({
      code: "CURATION_QA_REQUIRED",
      field: "curation.state",
      message: "La curacion debe estar aprobada antes de aprobar materiales.",
    });
  }

  if (!materials) {
    errors.push({
      code: "MATERIALS_MISSING",
      message: "No existe paquete de materiales para aprobar.",
    });
  } else {
    if (materials.upstream_dirty) {
      errors.push({
        code: "MATERIALS_UPSTREAM_DIRTY",
        message: "Los materiales tienen cambios previos sin reconciliar.",
      });
    }
    if (materials.state !== MATERIALS_STATES.READY_FOR_QA && materials.state !== MATERIALS_STATES.APPROVED) {
      errors.push({
        code: "MATERIALS_STATE_INVALID",
        field: "materials.state",
        message: "Los materiales deben estar listos para QA antes de aprobar.",
      });
    }
    if (hasItems(materials.global_blockers)) {
      errors.push({
        code: "MATERIALS_BLOCKERS_OPEN",
        field: "materials.global_blockers",
        message: "Existen bloqueadores globales de materiales.",
      });
    }
  }

  if (lessons.length === 0) {
    errors.push({
      code: "MATERIAL_LESSONS_REQUIRED",
      field: "material_lessons",
      message: "Los materiales requieren lecciones generadas.",
    });
  }

  const notApprovable = lessons.filter((lesson) => lesson.state !== "APPROVABLE");
  if (notApprovable.length > 0) {
    errors.push({
      code: "MATERIAL_LESSONS_NOT_APPROVABLE",
      field: "material_lessons.state",
      message: `${notApprovable.length} lecciones de materiales no estan aprobables.`,
    });
  }

  return result("MATERIALS", errors);
}

function componentHasProductionAsset(component: MaterialComponentGateRecord) {
  const assets = component.assets || {};
  return Boolean(
    assets.final_video_url ||
      assets.video_url ||
      assets.slides_url ||
      (assets.slides as Record<string, unknown> | undefined)?.html_public_url,
  );
}

export function validateProductionGate(
  input: PipelineValidationInput,
): PipelineValidationResult {
  const errors = [...validateMaterialsGate(input).errors];
  const materials = input.materials;
  const components = input.materialComponents || [];
  const artifact = input.artifact;

  if (
    materials &&
    materials.state !== MATERIALS_STATES.APPROVED &&
    materials.qa_decision?.decision !== "APPROVED"
  ) {
    errors.push({
      code: "MATERIALS_QA_REQUIRED",
      field: "materials.state",
      message: "Los materiales deben estar aprobados antes de cerrar produccion visual.",
    });
  }

  if (!artifact?.production_complete && artifact?.generation_metadata?.assets_complete !== true) {
    errors.push({
      code: "PRODUCTION_NOT_MARKED_COMPLETE",
      field: "artifacts.production_complete",
      message: "La produccion visual aun no esta marcada como completa.",
    });
  }

  const producedComponents = components.filter(componentHasProductionAsset);
  if (producedComponents.length === 0) {
    errors.push({
      code: "PRODUCTION_ASSETS_REQUIRED",
      field: "material_components.assets",
      message: "No hay assets visuales o videos finales asociados a los materiales.",
    });
  }

  return result("PRODUCTION", errors);
}

export function validatePublicationGate(
  input: PipelineValidationInput,
): PipelineValidationResult {
  const errors = [...validateProductionGate(input).errors];
  const request = input.publicationRequest;

  if (!request) {
    errors.push({
      code: "PUBLICATION_REQUEST_MISSING",
      message: "No existe borrador de publicacion.",
    });
  } else {
    if (request.upstream_dirty) {
      errors.push({
        code: "PUBLICATION_UPSTREAM_DIRTY",
        message: "La publicacion tiene cambios previos sin reconciliar.",
      });
    }
    if (request.status !== "READY" && request.status !== "SENT" && request.status !== "APPROVED") {
      errors.push({
        code: "PUBLICATION_NOT_READY",
        field: "publication_requests.status",
        message: "La publicacion debe estar en READY antes de enviarse a Soflia.",
      });
    }
    if (!hasText(request.slug)) {
      errors.push({
        code: "PUBLICATION_SLUG_REQUIRED",
        field: "publication_requests.slug",
        message: "El slug estable del curso es obligatorio.",
      });
    }
    if (!hasText(request.category) || !hasText(request.level) || !hasText(request.instructor_email)) {
      errors.push({
        code: "PUBLICATION_METADATA_REQUIRED",
        message: "Categoria, nivel e instructor son obligatorios para publicar.",
      });
    }
  }

  return result("PUBLICATION", errors);
}

export function validatePipelinePhase(
  phase: PipelinePhase,
  input: PipelineValidationInput,
): PipelineValidationResult {
  switch (phase) {
    case "BASE":
      return validateBaseGate(input);
    case "SYLLABUS":
      return validateSyllabusGate(input);
    case "INSTRUCTIONAL_PLAN":
      return validateInstructionalPlanGate(input);
    case "CURATION":
      return validateCurationGate(input);
    case "MATERIALS":
      return validateMaterialsGate(input);
    case "PRODUCTION":
      return validateProductionGate(input);
    case "PUBLICATION":
      return validatePublicationGate(input);
  }
}

export function formatPipelineValidationError(
  validation: PipelineValidationResult,
) {
  return validation.errors.map((error) => error.message).join(" ");
}
