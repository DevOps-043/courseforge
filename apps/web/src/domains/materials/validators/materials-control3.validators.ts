import type {
  LessonDod,
  MaterialComponent,
  MaterialLesson,
  ValidationCheck,
} from "../types/materials.types";
import { extractKeywords } from "./materials-validation-helpers";

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

export function buildControl3Dod(
  lesson: MaterialLesson,
  components: MaterialComponent[],
) {
  return [
    validateComponentsComplete(lesson, components),
    validateOAReflected(lesson, components),
    validateRequiredDemoGuide(lesson, components),
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
