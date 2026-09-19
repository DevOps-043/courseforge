import { validateDialogueIdentifiers } from "../../materials/lib/dialogue-identifiers";

export const SOFLIA_DIALOGUE_ACTIVITY_SCHEMA_VERSION = 2;
export const SOFLIA_DIALOGUE_INTERACTION_TYPE = "soflia_dialogue";
export const SOFLIA_DIALOGUE_RUNTIME_TYPE = "SOFLIA_DIALOGUE";

export interface SofliaDialogueRuntimeValidationResult {
  valid: boolean;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getRecordArray(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function getStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function hasForbiddenOpeningDisclosure(openingMessage: string) {
  const normalized = openingMessage
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return (
    normalized.includes("rubrica") ||
    normalized.includes("respuesta modelo") ||
    normalized.includes("criterios de evaluacion")
  );
}

export function isSofliaDialogueRuntimeConfig(
  content: Record<string, unknown>,
) {
  return (
    content.interactionType === SOFLIA_DIALOGUE_INTERACTION_TYPE &&
    content.runtimeType === SOFLIA_DIALOGUE_RUNTIME_TYPE
  );
}

export function validateSofliaDialogueRuntimeConfig(
  content: Record<string, unknown>,
): SofliaDialogueRuntimeValidationResult {
  const errors: string[] = [];

  if (content.interactionType !== SOFLIA_DIALOGUE_INTERACTION_TYPE) {
    errors.push("activity_config.interactionType debe ser soflia_dialogue");
  }

  if (content.runtimeType !== SOFLIA_DIALOGUE_RUNTIME_TYPE) {
    errors.push("activity_config.runtimeType debe ser SOFLIA_DIALOGUE");
  }

  const requiredStringFields = [
    "schemaVersion",
    "title",
    "visibleGoal",
    "learningObjective",
    "scenario",
    "openingMessage",
    "studentRole",
    "sofliaRole",
    "rescueContent",
  ];

  for (const field of requiredStringFields) {
    if (!isNonEmptyString(content[field])) {
      errors.push(`activity_config.${field} es requerido`);
    }
  }

  const successCriteria = getRecordArray(content.successCriteria);
  if (successCriteria.length < 1) {
    errors.push("activity_config.successCriteria debe incluir al menos un criterio");
  }

  errors.push(...validateDialogueIdentifiers(content));
  if (successCriteria.some((criterion) => !isNonEmptyString(criterion.label) || !isNonEmptyString(criterion.description))) {
    errors.push("successCriteria requiere label y description");
  }

  if (getStringArray(content.expectedEvidence).length < 1) {
    errors.push("activity_config.expectedEvidence debe incluir evidencia esperada");
  }

  if (getStringArray(content.commonMistakes).length < 1) {
    errors.push("activity_config.commonMistakes debe incluir errores frecuentes");
  }

  if (getStringArray(content.challengePrompts).length < 1) {
    errors.push("activity_config.challengePrompts debe incluir al menos un reto");
  }

  const rubric = getRecordArray(content.rubric);
  if (rubric.length < 1) {
    errors.push("activity_config.rubric debe incluir al menos una dimension");
  }

  const rubricWeight = rubric.reduce(
    (total, item) =>
      total +
      (typeof item.weight === "number" && Number.isFinite(item.weight)
        ? item.weight
        : 0),
    0,
  );

  if (rubric.length > 0 && rubricWeight !== 100) {
    errors.push("activity_config.rubric.weight debe sumar 100");
  }

  const policy = isRecord(content.policy) ? content.policy : null;
  if (!policy) {
    errors.push("activity_config.policy es requerido");
  } else {
    const approvalMinimum = Number(policy.approvalMinimum);
    const maxTurns = Number(policy.maxTurns);

    if (
      !Number.isFinite(approvalMinimum) ||
      approvalMinimum < 0 ||
      approvalMinimum > 100
    ) {
      errors.push("policy.approvalMinimum debe estar entre 0 y 100");
    }

    if (!Number.isFinite(maxTurns) || maxTurns < 1 || maxTurns > 30) {
      errors.push("policy.maxTurns debe estar entre 1 y 30");
    }
  }

  const openingMessage = isNonEmptyString(content.openingMessage)
    ? content.openingMessage
    : "";
  if (hasForbiddenOpeningDisclosure(openingMessage)) {
    errors.push("openingMessage no debe revelar rubrica ni respuesta modelo");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function buildSofliaDialogueActivityData(
  content: Record<string, unknown>,
) {
  const introduction =
    typeof content.visibleGoal === "string" && content.visibleGoal.trim()
      ? content.visibleGoal
      : "Actividad conversacional con SofLIA.";

  return { introduction };
}
