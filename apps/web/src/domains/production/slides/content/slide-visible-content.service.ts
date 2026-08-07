interface ScriptSectionVisualInput {
  best_practices?: unknown;
  common_errors?: unknown;
  narration_text?: unknown;
  on_screen_action?: unknown;
  on_screen_text?: unknown;
  reflection_question?: unknown;
  success_criteria?: unknown;
  visual_notes?: unknown;
}

interface StoryboardVisualInput {
  narration_text?: unknown;
  on_screen_action?: unknown;
  on_screen_text?: unknown;
  success_criteria_visible?: unknown;
  visual_content?: unknown;
  visual_type?: unknown;
}

function compactText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function compactItems(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(compactText).filter(Boolean)
    : [];
}

function normalizeForTextAnalysis(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s\/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PRODUCTION_DIRECTION_PATTERNS = [
  /\basset\b/,
  /\bb[-\s]?roll\b/,
  /\bstoryboard\b/,
  /\banimacion\b/,
  /\banimada?\b/,
  /\btransicion\b/,
  /\bcamara\b/,
  /\bplano\b/,
  /\btoma\b/,
  /\bescena\b/,
  /\bpantalla de titulo\b/,
  /\bgrafico abstracto\b/,
  /\bgrafico\b.{0,80}\bmostrando\b/,
  /\bimagen final\b/,
  /\breloj que acelera\b/,
  /\bsiluetas?\b/,
  /\biconos? representando\b/,
  /\bejemplos visuales\b/,
  /\ben pantalla\b/,
  /\bmostrar(?:ndo)?\b/,
  /\baparece(?:n)?\b/,
  /\bfade\b/,
  /\bzoom\b/,
];

export function isProductionDirectionText(value: unknown) {
  const text = compactText(value);
  if (!text) {
    return false;
  }

  const normalized = normalizeForTextAnalysis(text);
  return PRODUCTION_DIRECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function compactEducationalText(value: unknown) {
  const text = compactText(value);
  return text && !isProductionDirectionText(text) ? text : "";
}

export function splitVisibleText(value: string) {
  return value
    .split(/\n|\u2022|- /)
    .map((line) => line.trim())
    .filter(Boolean);
}

function educationalLinesFromText(value: unknown) {
  return splitVisibleText(compactText(value)).filter((line) => !isProductionDirectionText(line));
}

function tokenSet(value: string) {
  return new Set(
    normalizeForTextAnalysis(value)
      .split(" ")
      .filter((token) => token.length >= 4),
  );
}

function similarityRatio(left: string, right: string) {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

export function isLikelyNarrationLeak(params: {
  narration?: unknown;
  visibleText: string;
}) {
  const narration = compactText(params.narration);
  const visibleText = compactText(params.visibleText);
  if (!narration || !visibleText) {
    return false;
  }

  if (visibleText.length > 80 && normalizeForTextAnalysis(narration).includes(normalizeForTextAnalysis(visibleText))) {
    return true;
  }

  return visibleText.length > 120 && similarityRatio(visibleText, narration) >= 0.72;
}

export function buildVisibleLinesFromScriptSection(
  section: ScriptSectionVisualInput,
): string[] {
  const explicitLines = educationalLinesFromText(section.on_screen_text);
  if (explicitLines.length > 0) {
    return explicitLines;
  }

  const nonNarrationCandidates = [
    compactEducationalText(section.success_criteria),
    ...compactItems(section.best_practices).filter((item) => !isProductionDirectionText(item)),
    ...compactItems(section.common_errors).filter((item) => !isProductionDirectionText(item)),
    compactEducationalText(section.reflection_question),
    compactEducationalText(section.on_screen_action),
    compactEducationalText(section.visual_notes),
  ].filter(Boolean);

  return nonNarrationCandidates.length > 0
    ? nonNarrationCandidates
    : ["Idea clave de la leccion"];
}

export function buildVisibleLinesFromStoryboardItem(
  item: StoryboardVisualInput,
): string[] {
  const explicitLines = educationalLinesFromText(item.on_screen_text);
  if (explicitLines.length > 0) {
    return explicitLines;
  }

  const nonNarrationCandidates = [
    compactEducationalText(item.success_criteria_visible),
    compactEducationalText(item.on_screen_action),
  ].filter(Boolean);

  return nonNarrationCandidates.length > 0
    ? nonNarrationCandidates
    : ["Apoyo visual de la leccion"];
}
