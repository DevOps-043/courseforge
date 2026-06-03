const QUIZ_OPTION_PREFIX_PATTERN = /^\s*(?:[A-Da-d]|\d{1,2})\s*[\.)\-:]\s*/;
const BARE_QUIZ_OPTION_LABEL_PATTERN = /^\s*(?:[A-Da-d]|\d{1,2})\s*[\.)\-:]?\s*$/;
const TRUE_OPTION_LABELS = new Set(["verdadero", "true"]);
const FALSE_OPTION_LABELS = new Set(["falso", "false"]);

export function stripQuizOptionPrefix(option: string) {
  return option.replace(QUIZ_OPTION_PREFIX_PATTERN, "").trim();
}

export function hasQuizOptionPrefix(option: string) {
  return QUIZ_OPTION_PREFIX_PATTERN.test(option);
}

export function hasSubstantiveQuizOptionText(option: unknown) {
  if (typeof option !== "string") {
    return false;
  }

  const trimmed = option.trim();
  if (!trimmed || BARE_QUIZ_OPTION_LABEL_PATTERN.test(trimmed)) {
    return false;
  }

  return stripQuizOptionPrefix(trimmed).length > 0;
}

export function resolveQuizCorrectAnswer(params: {
  rawCorrect: unknown;
  rawOptions: string[];
  cleanOptions: string[];
  questionType?: string;
}) {
  const { rawCorrect, rawOptions, cleanOptions, questionType } = params;

  if (typeof rawCorrect === "number") {
    return rawCorrect >= 0 && rawCorrect < cleanOptions.length
      ? cleanOptions[rawCorrect]
      : "";
  }

  const trueFalseAnswer = resolveTrueFalseCorrectAnswer({
    rawCorrect,
    cleanOptions,
    questionType,
  });
  if (trueFalseAnswer) {
    return trueFalseAnswer;
  }

  const rawCorrectText = String(rawCorrect || "").trim();
  if (!rawCorrectText) {
    return "";
  }

  const letterIndex = /^[A-Da-d]$/.test(rawCorrectText)
    ? rawCorrectText.toUpperCase().charCodeAt(0) - "A".charCodeAt(0)
    : -1;

  if (letterIndex >= 0 && letterIndex < cleanOptions.length) {
    return cleanOptions[letterIndex];
  }

  const rawOptionIndex = rawOptions.findIndex((option) => option === rawCorrectText);
  if (rawOptionIndex >= 0) {
    return cleanOptions[rawOptionIndex] || "";
  }

  return stripQuizOptionPrefix(rawCorrectText);
}

export function resolveTrueFalseCorrectAnswer(params: {
  rawCorrect: unknown;
  cleanOptions: string[];
  questionType?: string;
}) {
  const { rawCorrect, cleanOptions, questionType } = params;
  const isTrueFalseQuestion =
    typeof questionType === "string" &&
    ["true_false", "true-false", "truefalse", "verdadero_falso"].includes(
      questionType.toLowerCase(),
    );

  if (!isTrueFalseQuestion && typeof rawCorrect !== "boolean") {
    return "";
  }

  const normalized =
    typeof rawCorrect === "boolean"
      ? rawCorrect
        ? "verdadero"
        : "falso"
      : String(rawCorrect || "")
          .trim()
          .toLowerCase();

  const targetLabels = TRUE_OPTION_LABELS.has(normalized)
    ? TRUE_OPTION_LABELS
    : FALSE_OPTION_LABELS.has(normalized)
      ? FALSE_OPTION_LABELS
      : null;

  if (!targetLabels) {
    return "";
  }

  const matchingOption = cleanOptions.find((option) =>
    targetLabels.has(option.trim().toLowerCase()),
  );

  return matchingOption || (targetLabels === TRUE_OPTION_LABELS ? "Verdadero" : "Falso");
}

export function hasValidQuizCorrectAnswer(params: {
  rawCorrect: unknown;
  rawOptions: string[];
  cleanOptions: string[];
  questionType?: string;
}) {
  const resolved = resolveQuizCorrectAnswer(params);

  if (!resolved) {
    return false;
  }

  if (params.cleanOptions.length === 0) {
    return true;
  }

  return params.cleanOptions.includes(resolved);
}
