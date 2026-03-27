import {
  CURATION_STATES,
  MATERIALS_STATES,
  PLAN_STATES,
  SYLLABUS_STATES,
} from "@/lib/pipeline-constants";

const APPROVED_DECISION = "APPROVED";

export function isSyllabusApproved(artifactLike: any): boolean {
  const syllabusState =
    artifactLike?.syllabus_status ?? artifactLike?.syllabus_state;
  const qaStatus =
    artifactLike?.temario?.qa?.status ?? artifactLike?.syllabus?.qa?.status;

  return (
    syllabusState === SYLLABUS_STATES.APPROVED ||
    qaStatus === APPROVED_DECISION
  );
}

export function isInstructionalPlanApproved(planLike: any): boolean {
  const planState = planLike?.plan_state ?? planLike?.state;
  const finalStatus =
    planLike?.instructional_plan?.final_status ?? planLike?.final_status;
  const architectStatus =
    planLike?.instructional_plan?.approvals?.architect_status ??
    planLike?.approvals?.architect_status;

  return (
    planState === PLAN_STATES.APPROVED ||
    finalStatus === "APPROVED_PHASE_1" ||
    architectStatus === APPROVED_DECISION
  );
}

export function hasCurationStarted(curationLike: any): boolean {
  const curationState = curationLike?.curation_state ?? curationLike?.state;

  return Boolean(
    curationLike?.curation?.id || curationLike?.id || curationState,
  );
}

export function isCurationApproved(curationLike: any): boolean {
  const curationState = curationLike?.curation_state ?? curationLike?.state;
  const qaDecision =
    curationLike?.curation?.qa_decision?.decision ??
    curationLike?.qa_decision?.decision;

  return (
    curationState === CURATION_STATES.APPROVED ||
    qaDecision === APPROVED_DECISION
  );
}

export function isCurationBlocked(curationLike: any): boolean {
  const curationState = curationLike?.curation_state ?? curationLike?.state;
  const qaDecision =
    curationLike?.curation?.qa_decision?.decision ??
    curationLike?.qa_decision?.decision;

  return (
    curationState === CURATION_STATES.BLOCKED ||
    qaDecision === "BLOCKED" ||
    qaDecision === "REJECTED"
  );
}

export function hasMaterialsStarted(materialsLike: any): boolean {
  const materialsState = materialsLike?.materials_state ?? materialsLike?.state;

  return Boolean(
    materialsLike?.materials?.id ||
      materialsLike?.id ||
      (materialsState && materialsState !== MATERIALS_STATES.DRAFT),
  );
}

export function isMaterialsApproved(materialsLike: any): boolean {
  const materialsState = materialsLike?.materials_state ?? materialsLike?.state;
  const qaDecision =
    materialsLike?.materials?.qa_decision?.decision ??
    materialsLike?.qa_decision?.decision;

  return (
    materialsState === MATERIALS_STATES.APPROVED ||
    qaDecision === APPROVED_DECISION
  );
}

export function getArtifactWorkflowStep(
  artifact: any,
  publicationRequest?: any,
): number {
  if (
    publicationRequest?.status === "SENT" ||
    publicationRequest?.status === "APPROVED"
  ) {
    return 7;
  }

  if (publicationRequest || artifact?.production_complete) {
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

  if (artifact?.state === "APPROVED" || artifact?.qa_status === "APPROVED") {
    return 2;
  }

  return 1;
}
