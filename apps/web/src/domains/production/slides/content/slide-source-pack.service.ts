export interface SlideSourceItem {
  coberturaCompleta?: boolean | null;
  excerpt?: string | null;
  isCritical?: boolean | null;
  notes?: string | null;
  rationale?: string | null;
  ref: string;
  title?: string | null;
}

export interface SlideSourceInsight {
  bodyItems: string[];
  sourceRef: string;
  title: string;
  type: "concept" | "practice" | "question" | "summary";
}

export interface SlideSourcePack {
  insights?: SlideSourceInsight[];
  items: SlideSourceItem[];
  sourceRefs: string[];
}

export const EMPTY_SLIDE_SOURCE_PACK: SlideSourcePack = {
  insights: [],
  items: [],
  sourceRefs: [],
};

function compactText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeForAnalysis(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericSourceNote(value: string) {
  const normalized = normalizeForAnalysis(value);
  return /fuente agregada manualmente|fuente agregada por el usuario|pdf agregado manualmente/.test(normalized) ||
    /\bpuede complementar( la leccion)?\b/.test(normalized) ||
    /\b(complementar|aporta|puede aportar|sirve para|util para)\b.{0,80}\b(leccion|evidencia|base|fundamentos|contexto)\b/.test(normalized);
}

function sourceClaim(item: SlideSourceItem) {
  const claim = compactText(item.notes) || compactText(item.rationale);
  return claim && !isGenericSourceNote(claim) ? claim : "";
}

function looksMostlySpanish(value: string) {
  const normalized = ` ${normalizeForAnalysis(value)} `;
  const spanishMarkers = [
    " de ",
    " que ",
    " para ",
    " con ",
    " una ",
    " el ",
    " la ",
    " los ",
    " las ",
    " aprendizaje ",
    " leccion ",
    " atencion ",
    " estres ",
    " habitos ",
  ];
  const englishMarkers = [
    " the ",
    " and ",
    " with ",
    " for ",
    " learning ",
    " focus ",
    " stress ",
    " health ",
    " teaching ",
  ];
  const spanishScore = spanishMarkers.filter((marker) => normalized.includes(marker)).length;
  const englishScore = englishMarkers.filter((marker) => normalized.includes(marker)).length;

  return spanishScore >= englishScore;
}

function cleanSourceFraming(value: string) {
  return compactText(value)
    .replace(/^(fuente|pagina|página|recurso)\s+[^.;:]{0,120}\b(que\s+explica|que\s+presenta|sobre|con|para|ofrece|aporta)\b\s*/i, "")
    .replace(/^(fuente|pagina|página|recurso)\s+[^.;:]{0,80}[:;-]\s*/i, "")
    .replace(/\b(aporta|puede aportar|puede complementar)\s+(base|fundamentos|contexto)\s+(cientifica|científica|practico|práctico)\s+(para|y)\s*/gi, "")
    .trim();
}

function limitText(value: string, maxLength: number) {
  const compact = compactText(value);
  if (compact.length <= maxLength) {
    return compact;
  }

  const sliced = compact.slice(0, maxLength - 1).trimEnd();
  const sentenceBreak = Math.max(
    sliced.lastIndexOf(". "),
    sliced.lastIndexOf("? "),
    sliced.lastIndexOf("! "),
  );
  const wordBreak = sliced.lastIndexOf(" ");
  const breakAt = sentenceBreak >= Math.floor(maxLength * 0.45)
    ? sentenceBreak + 1
    : wordBreak >= Math.floor(maxLength * 0.55)
      ? wordBreak
      : sliced.length;

  return `${sliced.slice(0, breakAt).trimEnd()}...`;
}

function isSourceMetadataSentence(sentence: string, item: SlideSourceItem) {
  const normalizedSentence = normalizeForAnalysis(sentence);
  const normalizedTitle = normalizeForAnalysis(compactText(item.title));
  const normalizedRef = normalizeForAnalysis(compactText(item.ref));

  if (normalizedTitle && normalizedSentence === normalizedTitle) {
    return true;
  }
  if (normalizedRef && normalizedSentence.includes(normalizedRef.slice(0, 80))) {
    return true;
  }

  return /\b(source|fuente|pagina|page|website|http|www|copyright|all rights reserved|privacy policy|terms of use)\b/i
    .test(normalizedSentence);
}

function isCurationRationaleSentence(sentence: string) {
  const normalized = normalizeForAnalysis(sentence);
  return isGenericSourceNote(sentence) ||
    /\bpuede complementar( la leccion)?\b/.test(normalized) ||
    /^complementar la leccion\b/.test(normalized) ||
    /\b(fundamentos cognitivos y estrategias practicas|base cientifica para|contexto practico para)\b/.test(normalized);
}

function splitEducationalSentences(value: string, item: SlideSourceItem) {
  const sentences = compactText(value)
    .replace(/\s([.!?])\s/g, "$1\n")
    .split(/\n|(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim().replace(/\s+/g, " "))
    .filter((sentence) => sentence.length >= 45 && sentence.length <= 320)
    .filter((sentence) => !isSourceMetadataSentence(sentence, item))
    .filter((sentence) => !isCurationRationaleSentence(sentence));

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const sentence of sentences) {
    const key = normalizeForAnalysis(sentence).slice(0, 160);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(limitText(sentence, 220));
    }
  }

  return unique.slice(0, 12);
}

function classifySentence(sentence: string): SlideSourceInsight["type"] {
  const normalized = normalizeForAnalysis(sentence);

  if (/\b(pregunta|evalua|reflexion|considera|why|how|what|cuando|como)\b/.test(normalized)) {
    return "question";
  }
  if (/\b(practica|estrategia|aplica|usa|utiliza|organiza|reduce|cierra|programa|calendari|habit|exercise|practice|strategy|use|reduce|build)\b/.test(normalized)) {
    return "practice";
  }
  if (/\b(resumen|conclusion|clave|importante|therefore|overall|in summary)\b/.test(normalized)) {
    return "summary";
  }

  return "concept";
}

const TOPIC_TITLE_RULES: Array<{ pattern: RegExp; title: string }> = [
  {
    pattern: /\b(distraccion|distracciones|distractores|notificacion|notificaciones|interrupcion|interrupciones)\b/,
    title: "Reduce distracciones",
  },
  {
    pattern: /\b(energia cognitiva|picos de energia|claridad mental|recursos cognitivos)\b/,
    title: "Alinea tareas con energía cognitiva",
  },
  {
    pattern: /\b(deep work|trabajo profundo|tareas profundas|alto valor|alta demanda)\b/,
    title: "Protege el trabajo profundo",
  },
  {
    pattern: /\b(reserva tiempo|tiempo de enfoque|bloques de enfoque|bloques|calendari|ventanas)\b/,
    title: "Reserva tiempo para enfocarte",
  },
  {
    pattern: /\b(estres|relajacion|mindfulness|sueno|mente-cuerpo|activacion fisiologica)\b/,
    title: "Regula el estrés",
  },
  {
    pattern: /\b(resiliencia|autocuidado|apoyo social|regulacion emocional|habitos saludables)\b/,
    title: "Fortalece resiliencia y autocuidado",
  },
  {
    pattern: /\b(evaluacion|pregunta|reflexion|comprueba|verifica|revision)\b/,
    title: "Comprueba la idea central",
  },
];

const FALLBACK_TITLES: Record<SlideSourceInsight["type"], string> = {
  concept: "Idea central de la fuente",
  practice: "Aplicación con evidencia",
  question: "Pregunta de verificación",
  summary: "Síntesis de la lección",
};

function removeTrailingPunctuation(value: string) {
  return value.replace(/[.,;:!?]+$/g, "").trim();
}

function sentenceTitleCandidate(value: string) {
  const firstClause = cleanSourceFraming(value)
    .replace(/^(puede|pueden|ayuda a|ayudan a|permite|permiten|consiste en|se refiere a)\s+/i, "")
    .split(/[.;:]/)[0] || "";
  const title = removeTrailingPunctuation(limitText(firstClause, 64).replace(/\.\.\.$/, ""));
  if (title.length < 8) {
    return "";
  }

  return title.charAt(0).toUpperCase() + title.slice(1);
}

function titleForInsight(type: SlideSourceInsight["type"], bodyItems: string[]) {
  const evidenceText = bodyItems.join(" ");
  const normalizedEvidence = normalizeForAnalysis(evidenceText);
  const topicTitle = TOPIC_TITLE_RULES.find((rule) => rule.pattern.test(normalizedEvidence))?.title;
  if (topicTitle) {
    return topicTitle;
  }

  const candidate = sentenceTitleCandidate(bodyItems[0] || "");
  return candidate || FALLBACK_TITLES[type];
}

function sourceTextForExtraction(item: SlideSourceItem) {
  const excerpt = compactText(item.excerpt);
  const claim = cleanSourceFraming(sourceClaim(item));

  if (!excerpt) {
    return claim;
  }
  if (!looksMostlySpanish(excerpt) && claim) {
    return claim;
  }

  return excerpt;
}

export function buildSourceInsights(items: SlideSourceItem[]): SlideSourceInsight[] {
  const insights: SlideSourceInsight[] = [];

  for (const item of items) {
    const sentences = splitEducationalSentences(sourceTextForExtraction(item), item);
    const grouped = new Map<SlideSourceInsight["type"], string[]>();

    for (const sentence of sentences) {
      const type = classifySentence(sentence);
      const current = grouped.get(type) || [];
      if (current.length < 3) {
        grouped.set(type, [...current, sentence]);
      }
    }

    for (const [type, bodyItems] of grouped) {
      if (bodyItems.length === 0) continue;
      insights.push({
        bodyItems,
        sourceRef: item.ref,
        title: titleForInsight(type, bodyItems),
        type,
      });
    }
  }

  return insights.slice(0, 24);
}

function insightTypeForSlideType(slideType?: string): SlideSourceInsight["type"] {
  if (slideType === "exercise" || slideType === "worked_example") return "practice";
  if (slideType === "knowledge_check") return "question";
  if (slideType === "summary") return "summary";
  return "concept";
}

export function sourceLinesForSlide(
  sourcePack: SlideSourcePack | undefined,
  slideIndex: number,
  options: {
    slideType?: string;
  } = {},
) {
  const insightType = insightTypeForSlideType(options.slideType);
  const availableInsights = sourcePack?.insights?.length
    ? sourcePack.insights
    : buildSourceInsights(sourcePack?.items || []);
  const matchingInsights = availableInsights.filter((insight) => insight.type === insightType);
  const insights = matchingInsights.length > 0 ? matchingInsights : availableInsights;
  const insight = insights.length > 0 ? insights[slideIndex % insights.length] : null;
  if (insight) {
    return [insight.title, ...insight.bodyItems];
  }

  const items = sourcePack?.items || [];
  if (items.length === 0) {
    return [];
  }

  const item = items[slideIndex % items.length];
  if (!item) {
    return [];
  }

  const claim = sourceClaim(item);
  if (claim) {
    return ["Evidencia disponible", claim];
  }

  return [];
}

export function firstSourceLead(sourcePack: SlideSourcePack | undefined) {
  const firstInsight = sourcePack?.insights?.[0] || buildSourceInsights(sourcePack?.items || [])[0];
  if (firstInsight?.bodyItems[0]) {
    return firstInsight.bodyItems[0];
  }

  const items = sourcePack?.items || [];
  for (const item of items) {
    const claim = sourceClaim(item);
    if (claim) {
      return claim;
    }
  }

  return "";
}
