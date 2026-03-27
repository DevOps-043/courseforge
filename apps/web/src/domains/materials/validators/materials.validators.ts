import type {
  MaterialComponent,
  MaterialLesson,
  ValidationCheck,
} from "../types/materials.types";
import {
  buildControl3Dod,
  buildLessonDod,
  validateComponentsComplete,
  validateNoExtraComponents,
  validateOAReflected,
  validateRequiredDemoGuide,
} from "./materials-control3.validators";
import {
  buildControl4Checks,
  validateNoNonAptaSources,
  validateSourcesUsage,
} from "./materials-control4.validators";
import {
  buildControl5Checks,
  validateQuizDifficulty,
  validateQuizExplanations,
  validateQuizPassingScore,
  validateQuizQuantity,
  validateQuizTypes,
} from "./materials-control5.validators";

export {
  validateComponentsComplete,
  validateNoExtraComponents,
  validateNoNonAptaSources,
  validateOAReflected,
  validateQuizDifficulty,
  validateQuizExplanations,
  validateQuizPassingScore,
  validateQuizQuantity,
  validateQuizTypes,
  validateRequiredDemoGuide,
  validateSourcesUsage,
};

export function runAllValidations(
  lesson: MaterialLesson,
  components: MaterialComponent[],
  aptaSourceIds: string[],
  nonAptaSourceIds: string[],
): { dod: MaterialLesson["dod"]; checks: ValidationCheck[] } {
  const quizComponent = components.find((component) => component.type === "QUIZ");
  const checks = [
    ...buildControl3Dod(lesson, components),
    ...buildControl4Checks(components, aptaSourceIds, nonAptaSourceIds),
    ...buildControl5Checks(quizComponent, lesson.quiz_spec),
  ];

  return {
    dod: buildLessonDod(checks),
    checks,
  };
}
