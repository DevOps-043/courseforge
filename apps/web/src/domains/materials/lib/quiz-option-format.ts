const QUIZ_OPTION_PREFIX_PATTERN = /^\s*(?:[A-Da-d]|\d{1,2})\s*[\.)\-:]\s*/;

export function stripQuizOptionPrefix(option: string) {
  return option.replace(QUIZ_OPTION_PREFIX_PATTERN, "").trim();
}

export function hasQuizOptionPrefix(option: string) {
  return QUIZ_OPTION_PREFIX_PATTERN.test(option);
}

export function resolveQuizCorrectAnswer(params: {
  rawCorrect: unknown;
  rawOptions: string[];
  cleanOptions: string[];
}) {
  const { rawCorrect, rawOptions, cleanOptions } = params;

  if (typeof rawCorrect === "number") {
    return rawCorrect >= 0 && rawCorrect < cleanOptions.length
      ? cleanOptions[rawCorrect]
      : "";
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
