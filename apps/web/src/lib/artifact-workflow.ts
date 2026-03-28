import {
  CURATION_STATES,
  MATERIALS_STATES,
  PLAN_STATES,
  SYLLABUS_STATES,
} from "@/lib/pipeline-constants";

// ---------------------------------------------------------------------------
// WorkflowSnapshot — DTO plano con campos primitivos de origen explícito.
// Elimina la contaminación cruzada: cada campo tiene un único origen
// documentado, sin fallback a campos del artifact padre.
// ---------------------------------------------------------------------------

export interface WorkflowSnapshot {
  /** artifact.state */
  baseState: string | null;
  /** artifact.qa_status */
  baseQaStatus: string | null;

  /** artifact.syllabus_state ?? artifact.syllabus_status (del join) */
  syllabusState: string | null;
  /** artifact.temario?.qa?.status ?? artifact.syllabus?.qa?.status */
  syllabusQaStatus: string | null;

  /** artifact.plan_state (del join) */
  planState: string | null;
  /** artifact.instructional_plan?.final_status */
  planFinalStatus: string | null;
  /** artifact.instructional_plan?.approvals?.architect_status */
  planArchitectStatus: string | null;

  /** artifact.curation_state (del join) */
  curationState: string | null;
  /** artifact.curation?.id */
  curationId: string | null;
  /** artifact.curation?.qa_decision?.decision */
  curationQaDecision: string | null;

  /** artifact.materials_state (del join) */
  materialsState: string | null;
  /** artifact.materials?.id */
  materialsId: string | null;
  /** artifact.materials?.qa_decision?.decision */
  materialsQaDecision: string | null;

  /** Boolean(artifact.production_complete) */
  productionComplete: boolean;
  /** Boolean(publicationRequest) */
  hasPublicationRequest: boolean;
  /** publicationRequest?.status */
  publicationStatus: string | null;
}

// ---------------------------------------------------------------------------
// Tipos mínimos para el extractor — se usan en buildWorkflowSnapshot
// para leer SOLO los campos que necesitamos del artifact, sin depender
// del tipo completo ni de `[key: string]: unknown`.
// ---------------------------------------------------------------------------

interface SnapshotSourceArtifact {
  state?: string | null;
  qa_status?: string | null;
  production_complete?: boolean | null;
  syllabus_state?: string | null;
  syllabus_status?: string | null;
  plan_state?: string | null;
  curation_state?: string | null;
  materials_state?: string | null;
  temario?: { qa?: { status?: string | null } | null } | null;
  syllabus?: { qa?: { status?: string | null } | null } | null;
  instructional_plan?: {
    final_status?: string | null;
    approvals?: { architect_status?: string | null } | null;
  } | null;
  curation?: {
    id?: string | null;
    qa_decision?: { decision?: string | null } | null;
  } | null;
  materials?: {
    id?: string | null;
    qa_decision?: { decision?: string | null } | null;
  } | null;
}

interface SnapshotSourcePublication {
  status?: string | null;
}

// ---------------------------------------------------------------------------
// Extractor — transforma artifact + publicationRequest en snapshot plano
// ---------------------------------------------------------------------------

export function buildWorkflowSnapshot(
  artifact: SnapshotSourceArtifact,
  publicationRequest?: SnapshotSourcePublication | null,
): WorkflowSnapshot {
  return {
    baseState: artifact.state ?? null,
    baseQaStatus: artifact.qa_status ?? null,

    syllabusState: artifact.syllabus_state ?? artifact.syllabus_status ?? null,
    syllabusQaStatus:
      artifact.temario?.qa?.status ??
      artifact.syllabus?.qa?.status ??
      null,

    planState: artifact.plan_state ?? null,
    planFinalStatus: artifact.instructional_plan?.final_status ?? null,
    planArchitectStatus:
      artifact.instructional_plan?.approvals?.architect_status ?? null,

    curationState: artifact.curation_state ?? null,
    curationId: artifact.curation?.id ?? null,
    curationQaDecision: artifact.curation?.qa_decision?.decision ?? null,

    materialsState: artifact.materials_state ?? null,
    materialsId: artifact.materials?.id ?? null,
    materialsQaDecision: artifact.materials?.qa_decision?.decision ?? null,

    productionComplete: Boolean(artifact.production_complete),
    hasPublicationRequest: Boolean(publicationRequest),
    publicationStatus: publicationRequest?.status ?? null,
  };
}

// ---------------------------------------------------------------------------
// Funciones de snapshot — operan SOLO sobre el DTO plano
// ---------------------------------------------------------------------------

export function isSyllabusApproved(s: WorkflowSnapshot): boolean {
  return (
    s.syllabusState === SYLLABUS_STATES.APPROVED ||
    s.syllabusQaStatus === "APPROVED"
  );
}

export function isInstructionalPlanApproved(s: WorkflowSnapshot): boolean {
  return (
    s.planState === PLAN_STATES.APPROVED ||
    s.planFinalStatus === "APPROVED_PHASE_1" ||
    s.planArchitectStatus === "APPROVED"
  );
}

export function isCurationApprovedFromSnapshot(s: WorkflowSnapshot): boolean {
  return (
    s.curationState === CURATION_STATES.APPROVED ||
    s.curationQaDecision === "APPROVED"
  );
}

export function isMaterialsApprovedFromSnapshot(s: WorkflowSnapshot): boolean {
  return (
    s.materialsState === MATERIALS_STATES.APPROVED ||
    s.materialsQaDecision === "APPROVED"
  );
}

// ---------------------------------------------------------------------------
// Resolución de paso — completamente inline y trazable
// ---------------------------------------------------------------------------

export function getWorkflowStep(s: WorkflowSnapshot): number {
  if (s.publicationStatus === "SENT" || s.publicationStatus === "APPROVED") {
    return 7;
  }

  if (s.hasPublicationRequest || s.productionComplete) {
    return 7;
  }

  // Materials aprobado o iniciado → paso 6
  if (
    s.materialsState === MATERIALS_STATES.APPROVED ||
    s.materialsQaDecision === "APPROVED"
  ) {
    return 6;
  }
  if (
    s.materialsId ||
    (s.materialsState && s.materialsState !== MATERIALS_STATES.DRAFT)
  ) {
    return 6;
  }

  // Curation aprobada → paso 5
  if (
    s.curationState === CURATION_STATES.APPROVED ||
    s.curationQaDecision === "APPROVED"
  ) {
    return 5;
  }

  // Curation iniciada o plan aprobado → paso 4
  if (s.curationId || s.curationState) {
    return 4;
  }
  if (
    s.planState === PLAN_STATES.APPROVED ||
    s.planFinalStatus === "APPROVED_PHASE_1" ||
    s.planArchitectStatus === "APPROVED"
  ) {
    return 4;
  }

  // Syllabus aprobado → paso 3
  if (
    s.syllabusState === SYLLABUS_STATES.APPROVED ||
    s.syllabusQaStatus === "APPROVED"
  ) {
    return 3;
  }

  // Base aprobada → paso 2
  if (s.baseState === "APPROVED" || s.baseQaStatus === "APPROVED") {
    return 2;
  }

  return 1;
}

// ---------------------------------------------------------------------------
// Funciones para registros standalone (ej: row de tabla curation).
// Usadas por SourcesCurationGenerationContainer que pasa un objeto
// Curation directamente, NO el artifact completo.
// ---------------------------------------------------------------------------

interface CurationRecordLike {
  state?: string | null;
  qa_decision?: { decision?: string | null } | null;
}

export function isCurationApprovedFromRecord(
  record: CurationRecordLike | null | undefined,
): boolean {
  if (!record) return false;
  return (
    record.state === CURATION_STATES.APPROVED ||
    record.qa_decision?.decision === "APPROVED"
  );
}

export function isCurationBlockedFromRecord(
  record: CurationRecordLike | null | undefined,
): boolean {
  if (!record) return false;
  const decision = record.qa_decision?.decision;
  return (
    record.state === CURATION_STATES.BLOCKED ||
    decision === "BLOCKED" ||
    decision === "REJECTED"
  );
}
