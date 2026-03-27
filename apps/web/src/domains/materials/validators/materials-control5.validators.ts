import type {
  MaterialComponent,
  QuizContent,
  QuizSpec,
  ValidationCheck,
} from "../types/materials.types";

function getQuizContent(quizComponent: MaterialComponent | undefined) {
  return (quizComponent?.content as QuizContent | undefined) || undefined;
}

export function validateQuizQuantity(
  quizComponent: MaterialComponent | undefined,
  spec: QuizSpec | null,
): ValidationCheck {
  if (!quizComponent) {
    return {
      code: "CTRL5_QUIZ_MISSING",
      message: "No se encontro componente QUIZ",
      pass: false,
      severity: "error",
    };
  }

  const content = getQuizContent(quizComponent);
  const itemCount = content?.items?.length || 0;
  const minQuestions = spec?.min_questions || 3;
  const maxQuestions = spec?.max_questions || 5;

  if (itemCount < minQuestions) {
    return {
      code: "CTRL5_QUIZ_TOO_FEW",
      component: "QUIZ",
      message: `Quiz tiene ${itemCount} preguntas, minimo requerido: ${minQuestions}`,
      pass: false,
      severity: "error",
    };
  }

  if (itemCount > maxQuestions) {
    return {
      code: "CTRL5_QUIZ_TOO_MANY",
      component: "QUIZ",
      message: `Quiz tiene ${itemCount} preguntas, maximo permitido: ${maxQuestions}`,
      pass: false,
      severity: "warning",
    };
  }

  return {
    code: "CTRL5_QUIZ_QUANTITY_OK",
    component: "QUIZ",
    message: `Quiz tiene ${itemCount} preguntas (rango: ${minQuestions}-${maxQuestions})`,
    pass: true,
    severity: "error",
  };
}

export function validateQuizTypes(
  quizComponent: MaterialComponent | undefined,
  spec: QuizSpec | null,
): ValidationCheck {
  if (!quizComponent) {
    return {
      code: "CTRL5_QUIZ_MISSING",
      message: "No se encontro componente QUIZ",
      pass: false,
      severity: "error",
    };
  }

  const content = getQuizContent(quizComponent);
  const allowedTypes = spec?.types || ["MULTIPLE_CHOICE", "TRUE_FALSE"];
  const usedTypes = content?.items?.map((item) => item.type) || [];
  const invalidTypes = usedTypes.filter((type) => !allowedTypes.includes(type));

  if (invalidTypes.length > 0) {
    return {
      code: "CTRL5_QUIZ_INVALID_TYPES",
      component: "QUIZ",
      message: `Tipos de pregunta no permitidos: ${[...new Set(invalidTypes)].join(", ")}`,
      pass: false,
      severity: "error",
    };
  }

  return {
    code: "CTRL5_QUIZ_TYPES_OK",
    component: "QUIZ",
    message: "Todos los tipos de pregunta son validos",
    pass: true,
    severity: "error",
  };
}

export function validateQuizDifficulty(
  quizComponent: MaterialComponent | undefined,
): ValidationCheck {
  if (!quizComponent) {
    return {
      code: "CTRL5_QUIZ_MISSING",
      message: "No se encontro componente QUIZ",
      pass: false,
      severity: "error",
    };
  }

  const content = getQuizContent(quizComponent);
  const difficulties = content?.items?.map((item) => item.difficulty) || [];
  const uniqueDifficulties = [...new Set(difficulties)];

  if ((content?.items?.length || 0) >= 3 && uniqueDifficulties.length < 2) {
    return {
      code: "CTRL5_QUIZ_NO_VARIETY",
      component: "QUIZ",
      message: `El Quiz solo tiene dificultad: ${uniqueDifficulties.join(", ")}. Se requiere variedad.`,
      pass: false,
      severity: "warning",
    };
  }

  return {
    code: "CTRL5_QUIZ_DIFFICULTY_OK",
    component: "QUIZ",
    message: `Dificultades variadas: ${uniqueDifficulties.join(", ")}`,
    pass: true,
    severity: "error",
  };
}

export function validateQuizExplanations(
  quizComponent: MaterialComponent | undefined,
): ValidationCheck {
  if (!quizComponent) {
    return {
      code: "CTRL5_QUIZ_MISSING",
      message: "No se encontro componente QUIZ",
      pass: false,
      severity: "error",
    };
  }

  const content = getQuizContent(quizComponent);
  const withoutExplanation =
    content?.items?.filter(
      (item) => !item.explanation || item.explanation.trim().length < 10,
    ) || [];

  if (withoutExplanation.length > 0) {
    return {
      code: "CTRL5_QUIZ_MISSING_EXPLANATIONS",
      component: "QUIZ",
      message: `${withoutExplanation.length} pregunta(s) sin explicacion adecuada`,
      pass: false,
      severity: "error",
    };
  }

  return {
    code: "CTRL5_QUIZ_EXPLANATIONS_OK",
    component: "QUIZ",
    message: "Todas las preguntas tienen explicacion",
    pass: true,
    severity: "error",
  };
}

export function validateQuizPassingScore(
  quizComponent: MaterialComponent | undefined,
): ValidationCheck {
  if (!quizComponent) {
    return {
      code: "CTRL5_QUIZ_MISSING",
      message: "No se encontro componente QUIZ",
      pass: false,
      severity: "error",
    };
  }

  const content = getQuizContent(quizComponent);

  if (content?.passing_score !== 80) {
    return {
      code: "CTRL5_QUIZ_WRONG_PASSING_SCORE",
      component: "QUIZ",
      message: `passing_score es ${content?.passing_score}, debe ser 80`,
      pass: false,
      severity: "error",
    };
  }

  return {
    code: "CTRL5_QUIZ_PASSING_SCORE_OK",
    component: "QUIZ",
    message: "passing_score = 80 correcto",
    pass: true,
    severity: "error",
  };
}

export function buildControl5Checks(
  quizComponent: MaterialComponent | undefined,
  spec: QuizSpec | null,
) {
  return [
    validateQuizQuantity(quizComponent, spec),
    validateQuizTypes(quizComponent, spec),
    validateQuizDifficulty(quizComponent),
    validateQuizExplanations(quizComponent),
    validateQuizPassingScore(quizComponent),
  ];
}
