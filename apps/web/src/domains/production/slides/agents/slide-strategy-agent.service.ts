import type { CourseSlideSpec, SlideDeckGenerateInput } from "../specs/course-deck.schema";
import type { DeckBrief } from "./deck-brief-agent.service";
import type { EvidencePack } from "./lesson-evidence-agent.service";
import { buildScriptSlideSegments } from "../planning/slide-coverage-policy.service";

export interface PlannedSlide {
  id: string;
  order: number;
  purpose: string;
  sourceRefs: string[];
  type: CourseSlideSpec["type"];
}

export interface SlidePlan {
  evidenceSourceCount: number;
  slides: PlannedSlide[];
  sourceMode: DeckBrief["sourceMode"];
  targetSlideCount: number;
  template: DeckBrief["template"];
}

interface BuildSlidePlanParams {
  brief: DeckBrief;
  component: {
    content?: unknown;
  };
  evidence: EvidencePack;
  input: SlideDeckGenerateInput;
}

interface ScriptSectionLike {
  duration_seconds?: number;
  best_practices?: unknown[];
  common_errors?: unknown[];
  on_screen_action?: string;
  on_screen_text?: string;
  reflection_question?: string;
  section_number?: number;
  section_type?: string;
  success_criteria?: string;
  visual_notes?: string;
}

interface StoryboardItemLike {
  on_screen_action?: string;
  on_screen_text?: string;
  success_criteria_visible?: string;
  take_number?: number;
  visual_content?: string;
  visual_type?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
}

function compactText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function visualBeatCount(section: ScriptSectionLike) {
  const visibleLines = (typeof section.on_screen_text === "string" ? section.on_screen_text : "")
    .split(/\n|\u2022|- /)
    .map((line) => line.trim())
    .filter(Boolean).length;
  return Math.min(Math.max(visibleLines + Number(Boolean(compactText(section.success_criteria))), 1), 3);
}

function includesAny(value: string, patterns: string[]) {
  const normalized = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return patterns.some((pattern) => normalized.includes(pattern));
}

function evidenceRefsForSlide(evidence: EvidencePack) {
  return evidence.sourceRefs.slice(0, 4);
}

function sourceInsightTypeForSlideType(type: CourseSlideSpec["type"]) {
  if (type === "exercise" || type === "worked_example") return "practice";
  if (type === "knowledge_check") return "question";
  if (type === "summary") return "summary";
  return "concept";
}

function hasSourceEvidenceForSlideType(
  evidence: EvidencePack,
  type: CourseSlideSpec["type"],
) {
  return evidence.sourceInsightCounts[sourceInsightTypeForSlideType(type)] > 0;
}

function hasExplicitScriptContentForType(
  section: ScriptSectionLike,
  type: CourseSlideSpec["type"],
) {
  if (type === "knowledge_check") {
    return Boolean(
      compactText(section.reflection_question) ||
      (Array.isArray(section.common_errors) && section.common_errors.length > 0),
    );
  }

  if (type === "worked_example" || type === "exercise") {
    const text = [
      section.on_screen_text,
      section.on_screen_action,
      section.success_criteria,
    ].map(compactText).join(" ");
    return Boolean(
      (Array.isArray(section.best_practices) && section.best_practices.length > 0) ||
      includesAny(text, ["paso", "ejemplo", "aplicacion", "demostracion", "demo", "actividad", "ejercicio", "practica"]),
    );
  }

  return Boolean(
    compactText(section.on_screen_text) ||
    compactText(section.success_criteria),
  );
}

function hasExplicitStoryboardContentForType(
  item: StoryboardItemLike,
  type: CourseSlideSpec["type"],
) {
  const text = [
    item.visual_type,
    item.visual_content,
    item.on_screen_action,
    item.on_screen_text,
    item.success_criteria_visible,
  ].map(compactText).join(" ");

  if (type === "knowledge_check") {
    return includesAny(text, ["quiz", "pregunta", "check", "evaluacion"]);
  }

  if (type === "worked_example" || type === "exercise") {
    return includesAny(text, ["paso", "ejemplo", "aplicacion", "demo", "tutorial", "actividad", "ejercicio", "practica"]);
  }

  return Boolean(compactText(item.on_screen_text) || compactText(item.success_criteria_visible));
}

function evidenceBackedFallbackType(
  evidence: EvidencePack,
  index: number,
): CourseSlideSpec["type"] {
  if (index === 0) {
    return "concept";
  }
  if (evidence.sourceInsightCounts.concept > 0) {
    return "concept";
  }
  if (evidence.sourceInsightCounts.practice > 0) {
    return "worked_example";
  }
  if (evidence.sourceInsightCounts.question > 0) {
    return "knowledge_check";
  }
  if (evidence.sourceInsightCounts.summary > 0) {
    return "summary";
  }
  return "concept";
}

function resolveFillableSlideType(params: {
  desiredType: CourseSlideSpec["type"];
  evidence: EvidencePack;
  hasExplicitContent: boolean;
  index: number;
}) {
  if (
    params.desiredType === "cover" ||
    params.desiredType === "data_explainer" ||
    params.desiredType === "objectives"
  ) {
    return params.desiredType;
  }

  if (params.hasExplicitContent || hasSourceEvidenceForSlideType(params.evidence, params.desiredType)) {
    return params.desiredType;
  }

  return evidenceBackedFallbackType(params.evidence, params.index);
}

function planTypeFromScriptSection(
  section: ScriptSectionLike,
  index: number,
  evidence: EvidencePack,
): CourseSlideSpec["type"] {
  const text = [
    section.section_type,
    section.on_screen_text,
    section.on_screen_action,
    section.visual_notes,
    section.success_criteria,
    section.reflection_question,
  ].map(compactText).join(" ");

  const desiredType = (() => {
    if (Array.isArray(section.common_errors) && section.common_errors.length > 0) {
      return "knowledge_check";
    }
    if (Array.isArray(section.best_practices) && section.best_practices.length >= 2) {
      return "objectives";
    }
    if (includesAny(text, ["pregunta", "reflexion", "quiz", "check", "evaluacion"])) {
      return "knowledge_check";
    }
    if (includesAny(text, ["paso", "ejemplo", "aplicacion", "demostracion", "demo"])) {
      return "worked_example";
    }
    if (includesAny(text, ["actividad", "ejercicio", "practica"])) {
      return "exercise";
    }

    return "concept";
  })();

  return resolveFillableSlideType({
    desiredType,
    evidence,
    hasExplicitContent: hasExplicitScriptContentForType(section, desiredType),
    index,
  });
}

function planTypeFromStoryboardItem(
  item: StoryboardItemLike,
  index: number,
  evidence: EvidencePack,
): CourseSlideSpec["type"] {
  const text = [
    item.visual_type,
    item.visual_content,
    item.on_screen_action,
    item.on_screen_text,
    item.success_criteria_visible,
  ].map(compactText).join(" ");

  const desiredType = (() => {
    if (includesAny(text, ["quiz", "pregunta", "check", "evaluacion"])) {
      return "knowledge_check";
    }
    if (includesAny(text, ["paso", "ejemplo", "aplicacion", "demo", "pantalla", "captura", "tutorial"])) {
      return "worked_example";
    }
    if (includesAny(text, ["actividad", "ejercicio", "practica"])) {
      return "exercise";
    }

    return "concept";
  })();

  return resolveFillableSlideType({
    desiredType,
    evidence,
    hasExplicitContent: hasExplicitStoryboardContentForType(item, desiredType),
    index,
  });
}

function planCustomSlides(
  input: SlideDeckGenerateInput,
  evidence: EvidencePack,
): PlannedSlide[] {
  return (input.customSlides || []).map((slide, index) => ({
    id: `custom-slide-${index + 1}`,
    order: index + 1,
    purpose: slide.chart ? "Explicar datos proporcionados manualmente." : "Presentar contenido personalizado.",
    sourceRefs: slide.chart?.sourceRefs.length ? slide.chart.sourceRefs : evidenceRefsForSlide(evidence),
    type: slide.chart ? "data_explainer" : slide.type || (index === 0 ? "cover" : "concept"),
  }));
}

function planScriptSlides(
  componentContent: Record<string, unknown>,
  evidence: EvidencePack,
): PlannedSlide[] {
  const script = asRecord(componentContent.script);
  const sections = Array.isArray(script.sections)
    ? script.sections as ScriptSectionLike[]
    : [];

  return [
    {
      id: "cover",
      order: 1,
      purpose: "Abrir la leccion y situar el objetivo.",
      sourceRefs: ["component.content.script", ...evidenceRefsForSlide(evidence)],
      type: "cover",
    },
    ...buildScriptSlideSegments(sections.map((section) => ({
      visibleBeatCount: visualBeatCount(section),
    }))).map((segment, index): PlannedSlide => {
      const section = sections[segment.sectionIndex]!;
      const sectionNumber = section.section_number || segment.sectionIndex + 1;
      return {
        id: segment.part === 1
          ? `script-section-${sectionNumber}`
          : `script-section-${sectionNumber}-part-${segment.part}`,
        order: index + 2,
        purpose: segment.totalParts === 1
          ? "Convertir una seccion del guion en apoyo visual breve."
          : "Convertir un tramo narrativo en apoyo visual breve y secuencial.",
        sourceRefs: ["component.content.script", ...evidenceRefsForSlide(evidence)],
        type: planTypeFromScriptSection(section, segment.part - 1, evidence),
      };
    }),
  ];
}

function planStoryboardSlides(
  componentContent: Record<string, unknown>,
  evidence: EvidencePack,
): PlannedSlide[] {
  const storyboard = Array.isArray(componentContent.storyboard)
    ? componentContent.storyboard as StoryboardItemLike[]
    : [];

  return [
    {
      id: "cover",
      order: 1,
      purpose: "Abrir la secuencia visual aprobada.",
      sourceRefs: ["component.content.storyboard", ...evidenceRefsForSlide(evidence)],
      type: "cover",
    },
    ...storyboard.slice(0, 10).map((item, index): PlannedSlide => ({
      id: `storyboard-${item.take_number || index + 1}`,
      order: index + 2,
      purpose: "Transformar una toma del storyboard en apoyo visual.",
      sourceRefs: ["component.content.storyboard", ...evidenceRefsForSlide(evidence)],
      type: planTypeFromStoryboardItem(item, index, evidence),
    })),
  ];
}

function planFallbackSlide(): PlannedSlide[] {
  return [{
    id: "fallback-cover",
    order: 1,
    purpose: "Crear una slide base cuando no hay guion ni storyboard.",
    sourceRefs: [],
    type: "cover",
  }];
}

export function buildSlidePlan(params: BuildSlidePlanParams): SlidePlan {
  const content = asRecord(params.component.content);
  const slides = params.brief.sourceMode === "custom_request"
    ? planCustomSlides(params.input, params.evidence)
    : params.brief.sourceMode === "script"
      ? planScriptSlides(content, params.evidence)
      : params.brief.sourceMode === "storyboard"
        ? planStoryboardSlides(content, params.evidence)
        : planFallbackSlide();

  return {
    evidenceSourceCount: params.evidence.sourceRefs.length,
    slides,
    sourceMode: params.brief.sourceMode,
    targetSlideCount: params.brief.targetSlideCount,
    template: params.brief.template,
  };
}
