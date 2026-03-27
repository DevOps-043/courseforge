import {
  CURATION_STATES,
  MATERIALS_STATES,
  PLAN_STATES,
  SYLLABUS_STATES,
} from "@/lib/pipeline-constants";

const APPROVED_DECISION = "APPROVED";

interface QaStatusLike {
  status?: string | null;
}

interface QaDecisionLike {
  decision?: string | null;
}

interface ApprovalsLike {
  architect_status?: string | null;
}

interface NestedWorkflowStateLike {
  id?: string | null;
  state?: string | null;
  qa?: QaStatusLike | null;
  qa_decision?: QaDecisionLike | null;
  final_status?: string | null;
  approvals?: ApprovalsLike | null;
}

export interface ArtifactWorkflowLike {
  id?: string | null;
  state?: string | null;
  qa_status?: string | null;
  qa_decision?: QaDecisionLike | null;
  production_complete?: boolean | null;
  syllabus_status?: string | null;
  syllabus_state?: string | null;
  plan_state?: string | null;
  curation_state?: string | null;
  materials_state?: string | null;
  final_status?: string | null;
  approvals?: ApprovalsLike | null;
  temario?: {
    qa?: QaStatusLike | null;
  } | null;
  syllabus?: NestedWorkflowStateLike | null;
  instructional_plan?: NestedWorkflowStateLike | null;
  curation?: NestedWorkflowStateLike | null;
  materials?: NestedWorkflowStateLike | null;
}

export interface PublicationWorkflowLike {
  status?: string | null;
}

function getNestedQaStatus(
  value?: { qa?: QaStatusLike | null } | null,
) {
  return value?.qa?.status;
}

function getNestedQaDecision(
  value?: { qa_decision?: QaDecisionLike | null } | null,
) {
  return value?.qa_decision?.decision;
}

export function isSyllabusApproved(artifactLike: ArtifactWorkflowLike): boolean {
  const syllabusState =
    artifactLike.syllabus_status ?? artifactLike.syllabus_state;
  const qaStatus =
    getNestedQaStatus(artifactLike.temario) ??
    getNestedQaStatus(artifactLike.syllabus);

  return (
    syllabusState === SYLLABUS_STATES.APPROVED ||
    qaStatus === APPROVED_DECISION
  );
}

export function isInstructionalPlanApproved(
  planLike?: ArtifactWorkflowLike | NestedWorkflowStateLike | null,
): boolean {
  if (!planLike) {
    return false;
  }

  const planState =
    "plan_state" in planLike ? planLike.plan_state : planLike.state;
  const instructionalPlan =
    "instructional_plan" in planLike
      ? planLike.instructional_plan
      : undefined;
  const finalStatus = instructionalPlan?.final_status ?? planLike.final_status;
  const architectStatus =
    instructionalPlan?.approvals?.architect_status ??
    planLike.approvals?.architect_status;

  return (
    planState === PLAN_STATES.APPROVED ||
    finalStatus === "APPROVED_PHASE_1" ||
    architectStatus === APPROVED_DECISION
  );
}

export function hasCurationStarted(
  curationLike?: ArtifactWorkflowLike | NestedWorkflowStateLike | null,
): boolean {
  if (!curationLike) {
    return false;
  }

  const curationState =
    "curation_state" in curationLike ? curationLike.curation_state : curationLike.state;
  const nestedCuration =
    "curation" in curationLike ? curationLike.curation : undefined;

  return Boolean(nestedCuration?.id || curationLike.id || curationState);
}

export function isCurationApproved(
  curationLike?: ArtifactWorkflowLike | NestedWorkflowStateLike | null,
): boolean {
  if (!curationLike) {
    return false;
  }

  const curationState =
    "curation_state" in curationLike ? curationLike.curation_state : curationLike.state;
  const nestedCuration =
    "curation" in curationLike ? curationLike.curation : undefined;
  const qaDecision =
    getNestedQaDecision(nestedCuration) ?? getNestedQaDecision(curationLike);

  return (
    curationState === CURATION_STATES.APPROVED ||
    qaDecision === APPROVED_DECISION
  );
}

export function isCurationBlocked(
  curationLike?: ArtifactWorkflowLike | NestedWorkflowStateLike | null,
): boolean {
  if (!curationLike) {
    return false;
  }

  const curationState =
    "curation_state" in curationLike ? curationLike.curation_state : curationLike.state;
  const nestedCuration =
    "curation" in curationLike ? curationLike.curation : undefined;
  const qaDecision =
    getNestedQaDecision(nestedCuration) ?? getNestedQaDecision(curationLike);

  return (
    curationState === CURATION_STATES.BLOCKED ||
    qaDecision === "BLOCKED" ||
    qaDecision === "REJECTED"
  );
}

export function hasMaterialsStarted(
  materialsLike?: ArtifactWorkflowLike | NestedWorkflowStateLike | null,
): boolean {
  if (!materialsLike) {
    return false;
  }

  const materialsState =
    "materials_state" in materialsLike ? materialsLike.materials_state : materialsLike.state;
  const nestedMaterials =
    "materials" in materialsLike ? materialsLike.materials : undefined;

  return Boolean(
    nestedMaterials?.id ||
      materialsLike.id ||
      (materialsState && materialsState !== MATERIALS_STATES.DRAFT),
  );
}

export function isMaterialsApproved(
  materialsLike?: ArtifactWorkflowLike | NestedWorkflowStateLike | null,
): boolean {
  if (!materialsLike) {
    return false;
  }

  const materialsState =
    "materials_state" in materialsLike ? materialsLike.materials_state : materialsLike.state;
  const nestedMaterials =
    "materials" in materialsLike ? materialsLike.materials : undefined;
  const qaDecision =
    getNestedQaDecision(nestedMaterials) ?? getNestedQaDecision(materialsLike);

  return (
    materialsState === MATERIALS_STATES.APPROVED ||
    qaDecision === APPROVED_DECISION
  );
}

export function getArtifactWorkflowStep(
  artifact: ArtifactWorkflowLike,
  publicationRequest?: PublicationWorkflowLike | null,
): number {
  if (
    publicationRequest?.status === "SENT" ||
    publicationRequest?.status === "APPROVED"
  ) {
    return 7;
  }

  if (publicationRequest || artifact.production_complete) {
    return 7;
  }

  if (isMaterialsApproved(artifact) || hasMaterialsStarted(artifact)) {
    return 6;
  }

  if (isCurationApproved(artifact)) {
    return 5;
  }

  if (hasCurationStarted(artifact) || isInstructionalPlanApproved(artifact)) {
    return 4;
  }

  if (isSyllabusApproved(artifact)) {
    return 3;
  }

  if (artifact.state === "APPROVED" || artifact.qa_status === "APPROVED") {
    return 2;
  }

  return 1;
}
