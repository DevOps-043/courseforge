import type { SyllabusModule } from "../types/syllabus.types";
import type {
  ImportOutline,
  SyllabusInputMode,
} from "../import/syllabus-import.schema";
import { SYLLABUS_IMPORT_POLICY } from "../import/syllabus-import.schema";
import { getFidelityIssues } from "../import/syllabus-fidelity";
import {
  runAllValidations,
  validateCourseDuration,
  validateObjectivesQuality,
  type ValidationResult,
} from "./syllabus.validators";

export function validateSyllabusForMode(
  modules: SyllabusModule[],
  objectives: string[],
  mode?: SyllabusInputMode,
  baseline?: ImportOutline,
): ValidationResult {
  if (mode !== "PROVIDED_SYLLABUS")
    return runAllValidations(modules, objectives);
  const ids = modules.flatMap((module) => [
    module.id,
    ...module.lessons.map((lesson) => lesson.id),
  ]);
  const structureValid =
    modules.length > 0 &&
    modules.length <= SYLLABUS_IMPORT_POLICY.maxModules &&
    modules.every(
      (module) =>
        Boolean(module.title.trim() && module.objective_general_ref.trim()) &&
        module.lessons.length > 0 &&
        module.lessons.length <= SYLLABUS_IMPORT_POLICY.maxLessonsPerModule &&
        module.lessons.every((lesson) => Boolean(lesson.title.trim())),
    ) &&
    ids.every(Boolean) &&
    new Set(ids).size === ids.length;
  const fidelityIssues = baseline
    ? getFidelityIssues(baseline, modules)
    : ["Falta el temario confirmado para verificar fidelidad."];
  const checks = [
    {
      code: "[IMPORT_STRUCTURE]",
      pass: structureValid,
      message: structureValid
        ? "Estructura importada íntegra e identificadores únicos."
        : "La estructura importada tiene campos faltantes o identificadores inválidos.",
    },
    {
      code: "[IMPORT_FIDELITY]",
      pass: fidelityIssues.length === 0,
      message: fidelityIssues.join(" ") || "Se conserva el temario confirmado.",
    },
    validateObjectivesQuality(modules),
    validateCourseDuration(modules),
  ];
  return { passed: checks.every((check) => check.pass), checks };
}
