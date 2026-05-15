import type {
  LessonDod,
  MaterialComponent,
  MaterialLesson,
  ValidationCheck,
} from "../types/materials.types";
import { extractKeywords } from "./materials-validation-helpers";

const STABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && STABLE_ID_PATTERN.test(value);
}

function getRecordArray(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function getStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function validateComponentsComplete(
  lesson: MaterialLesson,
  components: MaterialComponent[],
): ValidationCheck {
  const expectedTypes = lesson.expected_components;
  const generatedTypes = components.map((component) => component.type);
  const missing = expectedTypes.filter((type) => !generatedTypes.includes(type));

  if (missing.length > 0) {
    return {
      code: "CTRL3_COMPONENTS_INCOMPLETE",
      lesson_id: lesson.lesson_id,
      message: `Faltan componentes: ${missing.join(", ")}`,
      pass: false,
      severity: "error",
    };
  }

  return {
    code: "CTRL3_COMPONENTS_COMPLETE",
    lesson_id: lesson.lesson_id,
    message: "Todos los componentes esperados fueron generados",
    pass: true,
    severity: "error",
  };
}

export function validateOAReflected(
  lesson: MaterialLesson,
  components: MaterialComponent[],
): ValidationCheck {
  const oaKeywords = extractKeywords(lesson.oa_text);
  const allContent = components
    .map((component) => JSON.stringify(component.content))
    .join(" ")
    .toLowerCase();
  const foundKeywords = oaKeywords.filter((keyword) =>
    allContent.includes(keyword.toLowerCase()),
  );
  const coverage = foundKeywords.length / Math.max(oaKeywords.length, 1);

  if (coverage < 0.5) {
    return {
      code: "CTRL3_OA_NOT_REFLECTED",
      lesson_id: lesson.lesson_id,
      message: `El OA no esta suficientemente reflejado en los materiales (cobertura: ${Math.round(coverage * 100)}%)`,
      pass: false,
      severity: "warning",
    };
  }

  return {
    code: "CTRL3_OA_REFLECTED",
    lesson_id: lesson.lesson_id,
    message: `OA reflejado correctamente (cobertura: ${Math.round(coverage * 100)}%)`,
    pass: true,
    severity: "error",
  };
}

export function validateRequiredDemoGuide(
  lesson: MaterialLesson,
  components: MaterialComponent[],
): ValidationCheck {
  if (!lesson.requires_demo_guide) {
    return {
      code: "CTRL3_DEMO_GUIDE_NOT_REQUIRED",
      lesson_id: lesson.lesson_id,
      message: "Demo guide no requerido",
      pass: true,
      severity: "error",
    };
  }

  const hasDemoGuide = components.some(
    (component) => component.type === "DEMO_GUIDE",
  );

  if (!hasDemoGuide) {
    return {
      code: "CTRL3_DEMO_GUIDE_MISSING",
      lesson_id: lesson.lesson_id,
      message: "La leccion requiere DEMO_GUIDE pero no fue generado",
      pass: false,
      severity: "error",
    };
  }

  return {
    code: "CTRL3_DEMO_GUIDE_PRESENT",
    lesson_id: lesson.lesson_id,
    message: "Demo guide presente como requerido",
    pass: true,
    severity: "error",
  };
}

export function validateNoExtraComponents(
  lesson: MaterialLesson,
  components: MaterialComponent[],
): ValidationCheck {
  const expectedTypes = lesson.expected_components;
  const extraComponents = components.filter(
    (component) => !expectedTypes.includes(component.type),
  );

  if (extraComponents.length > 0) {
    return {
      code: "CTRL3_EXTRA_COMPONENTS",
      lesson_id: lesson.lesson_id,
      message: `Componentes no solicitados: ${extraComponents.map((component) => component.type).join(", ")}`,
      pass: false,
      severity: "warning",
    };
  }

  return {
    code: "CTRL3_NO_EXTRA_COMPONENTS",
    lesson_id: lesson.lesson_id,
    message: "No hay componentes extra",
    pass: true,
    severity: "error",
  };
}

export function validateSofliaDialogueRuntime(
  lesson: MaterialLesson,
  components: MaterialComponent[],
): ValidationCheck {
  if (!lesson.expected_components.includes("DIALOGUE")) {
    return {
      code: "CTRL3_DIALOGUE_RUNTIME_NOT_REQUIRED",
      lesson_id: lesson.lesson_id,
      component: "DIALOGUE",
      message: "Dialogue runtime no requerido",
      pass: true,
      severity: "error",
    };
  }

  const dialogueComponent = components.find(
    (component) => component.type === "DIALOGUE",
  );

  if (!dialogueComponent) {
    return {
      code: "CTRL3_DIALOGUE_RUNTIME_MISSING",
      lesson_id: lesson.lesson_id,
      component: "DIALOGUE",
      message: "Se esperaba DIALOGUE pero no fue generado",
      pass: false,
      severity: "error",
    };
  }

  const content = dialogueComponent.content;
  if (!isRecord(content)) {
    return {
      code: "CTRL3_DIALOGUE_RUNTIME_INVALID",
      lesson_id: lesson.lesson_id,
      component: "DIALOGUE",
      message: "DIALOGUE debe ser un objeto JSON",
      pass: false,
      severity: "error",
    };
  }

  if (
    content.interactionType !== "soflia_dialogue" ||
    content.runtimeType !== "SOFLIA_DIALOGUE"
  ) {
    return {
      code: "CTRL3_DIALOGUE_RUNTIME_LEGACY",
      lesson_id: lesson.lesson_id,
      component: "DIALOGUE",
      message:
        "DIALOGUE usa formato legacy; regenera solo este componente para SOFLIA_DIALOGUE",
      pass: false,
      severity: "error",
    };
  }

  const errors: string[] = [];
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
      errors.push(`${field} requerido`);
    }
  }

  const criteria = getRecordArray(content.successCriteria);
  if (criteria.length < 1) {
    errors.push("successCriteria debe incluir al menos un criterio");
  }

  const criterionIds = new Set<string>();
  for (const criterion of criteria) {
    if (!isStableId(criterion.id)) {
      errors.push("successCriteria contiene ids no estables");
      break;
    }
    criterionIds.add(criterion.id);
    if (!isNonEmptyString(criterion.label) || !isNonEmptyString(criterion.description)) {
      errors.push("successCriteria requiere label y description");
      break;
    }
  }

  if (getStringArray(content.expectedEvidence).length === 0) {
    errors.push("expectedEvidence debe incluir al menos una evidencia");
  }

  if (getStringArray(content.commonMistakes).length === 0) {
    errors.push("commonMistakes debe incluir al menos un error frecuente");
  }

  const hints = getRecordArray(content.hintLadder);
  if (hints.length === 0) {
    errors.push("hintLadder debe incluir pistas progresivas");
  }

  for (const hint of hints) {
    if (!isStableId(hint.id)) {
      errors.push("hintLadder contiene ids no estables");
      break;
    }
    if (
      typeof hint.targetCriterionId !== "string" ||
      !criterionIds.has(hint.targetCriterionId)
    ) {
      errors.push("hintLadder debe apuntar a criterios existentes");
      break;
    }
  }

  if (getStringArray(content.challengePrompts).length === 0) {
    errors.push("challengePrompts debe incluir al menos un reto");
  }

  const rubric = getRecordArray(content.rubric);
  const rubricWeight = rubric.reduce(
    (total, item) =>
      total + (typeof item.weight === "number" && Number.isFinite(item.weight) ? item.weight : 0),
    0,
  );
  if (rubric.length === 0 || rubricWeight !== 100) {
    errors.push("rubric debe existir y sus pesos deben sumar 100");
  }

  for (const item of rubric) {
    if (!isStableId(item.id)) {
      errors.push("rubric contiene ids no estables");
      break;
    }
  }

  const policy = isRecord(content.policy) ? content.policy : {};
  const approvalMinimum = Number(policy.approvalMinimum);
  const maxTurns = Number(policy.maxTurns);
  const maxHints = Number(policy.maxHints);

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
  if (!Number.isNaN(maxHints) && (maxHints < 0 || maxHints > 30)) {
    errors.push("policy.maxHints debe estar entre 0 y 30");
  }

  const openingMessage = String(content.openingMessage || "").toLowerCase();
  if (openingMessage.includes("rubrica") || openingMessage.includes("rúbrica")) {
    errors.push("openingMessage no debe revelar la rubrica");
  }

  return {
    code:
      errors.length > 0
        ? "CTRL3_DIALOGUE_RUNTIME_INVALID"
        : "CTRL3_DIALOGUE_RUNTIME_VALID",
    lesson_id: lesson.lesson_id,
    component: "DIALOGUE",
    message:
      errors.length > 0
        ? `Contrato SOFLIA_DIALOGUE invalido: ${errors.join("; ")}`
        : "Contrato SOFLIA_DIALOGUE valido",
    pass: errors.length === 0,
    severity: "error",
  };
}

export function buildControl3Dod(
  lesson: MaterialLesson,
  components: MaterialComponent[],
) {
  return [
    validateComponentsComplete(lesson, components),
    validateOAReflected(lesson, components),
    validateRequiredDemoGuide(lesson, components),
    validateSofliaDialogueRuntime(lesson, components),
    validateNoExtraComponents(lesson, components),
  ];
}

export function buildLessonDod(
  checks: ValidationCheck[],
): LessonDod {
  const control3Checks = checks.filter((check) => check.code.startsWith("CTRL3"));
  const control4Checks = checks.filter((check) => check.code.startsWith("CTRL4"));
  const control5Checks = checks.filter((check) => check.code.startsWith("CTRL5"));

  return {
    control3_consistency: control3Checks.every((check) => check.pass)
      ? "PASS"
      : "FAIL",
    control4_sources: control4Checks.every((check) => check.pass)
      ? "PASS"
      : "FAIL",
    control5_quiz: control5Checks.every((check) => check.pass)
      ? "PASS"
      : "FAIL",
    errors: checks
      .filter((check) => !check.pass && check.severity === "error")
      .map((check) => check.message),
  };
}
