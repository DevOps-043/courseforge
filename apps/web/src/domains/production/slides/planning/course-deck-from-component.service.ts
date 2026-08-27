import {
  COURSE_DECK_HEIGHT,
  COURSE_DECK_SCHEMA_VERSION,
  COURSE_DECK_WIDTH,
  courseDeckSpecSchema,
  type CourseDeckSpec,
  type CourseSlideSpec,
  type SlideDeckGenerateInput,
} from "../specs/course-deck.schema";
import {
  buildVisibleLinesFromScriptSection,
  buildVisibleLinesFromStoryboardItem,
  compactEducationalText,
} from "../content/slide-visible-content.service";
import { copyBudgetForSlideType, limitSlideCopy } from "../content/slide-copy-policy.service";
import { buildInstructionalChartsFromContent } from "../charts/instructional-chart-agent.service";
import { buildDeckBrief } from "../agents/deck-brief-agent.service";
import { buildEvidencePack, type EvidencePack } from "../agents/lesson-evidence-agent.service";
import { buildSlidePlan, type SlidePlan } from "../agents/slide-strategy-agent.service";
import { buildVisibleSlideCopy } from "../agents/visible-copy-agent.service";
import {
  buildVisualAssignmentMap,
  visualAssignmentForSlide,
  type VisualAssignmentMap,
} from "../agents/visual-template-selection-agent.service";
import {
  buildSourceInsights,
  firstSourceLead,
  sourceLinesForSlide,
  type SlideSourcePack,
} from "../content/slide-source-pack.service";

interface BuildCourseDeckSpecParams {
  artifactId: string;
  component: {
    content?: unknown;
    id: string;
    source_refs?: unknown;
    sourcePack?: SlideSourcePack;
    type?: string | null;
  };
  input: SlideDeckGenerateInput;
  planning?: {
    evidence: EvidencePack;
    slidePlan: SlidePlan;
    visualAssignments?: VisualAssignmentMap;
  };
}

interface ScriptSectionLike {
  best_practices?: string[];
  common_errors?: string[];
  duration_seconds?: number;
  narration_text?: string;
  on_screen_action?: string;
  on_screen_text?: string;
  reflection_question?: string;
  section_number?: number;
  success_criteria?: string;
  visual_notes?: string;
}

interface StoryboardItemLike {
  narration_text?: string;
  on_screen_action?: string;
  on_screen_text?: string;
  success_criteria_visible?: string;
  take_number?: number;
  timecode_end?: string;
  timecode_start?: string;
  visual_content?: string;
  visual_type?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function compactText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function limitText(value: unknown, maxLength: number): string {
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

function limitItems(items: string[], maxItems = 4) {
  return items
    .map((item) => limitText(item, 240))
    .filter(Boolean)
    .slice(0, maxItems);
}

function titleFromContent(content: Record<string, unknown>, fallback: string) {
  const directTitle = compactText(content.title);
  const scriptTitle = compactText(asRecord(content.script).title);
  return limitSlideCopy(
    directTitle || scriptTitle || fallback,
    copyBudgetForSlideType("cover").maxTitleCharacters,
  );
}

function firstEducationalText(values: unknown[]) {
  for (const value of values) {
    const text = compactEducationalText(value);
    if (text) {
      return text;
    }
  }

  return "";
}

function firstScriptSection(content: Record<string, unknown>): ScriptSectionLike | null {
  const script = asRecord(content.script);
  const sections = Array.isArray(script.sections)
    ? script.sections as ScriptSectionLike[]
    : [];
  return sections[0] || null;
}

function coverLeadFromContent(
  content: Record<string, unknown>,
  sourcePack?: SlideSourcePack,
) {
  const script = asRecord(content.script);
  const firstSection = firstScriptSection(content);
  const sourceLead = firstSourceLead(sourcePack);
  const lead = firstEducationalText([
    sourceLead,
    content.learning_objective,
    content.oa_text,
    content.objective,
    content.summary,
    content.description,
    script.learning_objective,
    script.oa_text,
    script.summary,
    firstSection?.success_criteria,
  ]);

  return limitSlideCopy(
    lead || "Contenido pendiente de sintetizar desde fuentes aprobadas para esta leccion.",
    copyBudgetForSlideType("cover").maxBodyItemCharacters,
  );
}

function buildChartSlides(
  content: Record<string, unknown>,
  startOrder: number,
  sourcePack?: SlideSourcePack,
): CourseSlideSpec[] {
  const evidenceSourceRefs = sourcePack?.sourceRefs || [];
  return buildInstructionalChartsFromContent(content).map((chart, index): CourseSlideSpec => {
    const chartSourceRefs = Array.from(new Set([
      ...chart.sourceRefs,
      ...evidenceSourceRefs.slice(0, 4),
    ]));

    return {
      bodyBlocks: [{
        kind: "paragraph",
        text: "Grafica generada solo con datos estructurados de la leccion.",
      }],
      chart: {
        ...chart,
        sourceRefs: chartSourceRefs,
      },
      citations: [],
      id: `instructional-chart-${index + 1}`,
      order: startOrder + index,
      renderHints: {
        layout: "data",
        purpose: "Explicar estadisticas educativas detectadas en la leccion.",
      },
      title: limitSlideCopy(chart.title, copyBudgetForSlideType("data_explainer").maxTitleCharacters),
      type: "data_explainer",
      validationHints: {
        mustKeepClaims: ["La grafica debe provenir de datos educativos estructurados, no del ritmo del video."],
        sourceRefs: chartSourceRefs,
      },
    };
  });
}

function normalizedSlideSignature(slide: CourseSlideSpec) {
  return [slide.title, slide.subtitle || "", ...slide.bodyBlocks.flatMap((block) =>
    block.kind === "bullets" ? block.items || [] : block.text ? [block.text] : [],
  )]
    .join(" ")
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAdditionalEvidenceSlides(params: {
  existingSlides: CourseSlideSpec[];
  sourcePack?: SlideSourcePack;
  startOrder: number;
  targetSlideCount: number;
}): CourseSlideSpec[] {
  const needed = Math.max(0, params.targetSlideCount - (params.existingSlides.length + 1));
  if (needed === 0) return [];

  const insights = params.sourcePack?.insights?.length
    ? params.sourcePack.insights
    : buildSourceInsights(params.sourcePack?.items || []);
  const seen = new Set(params.existingSlides.map(normalizedSlideSignature));
  const slides: CourseSlideSpec[] = [];

  for (const insight of insights) {
    if (slides.length >= needed) break;
    const type = insight.type === "practice"
      ? "worked_example"
      : insight.type === "question"
        ? "knowledge_check"
        : insight.type === "summary" ? "summary" : "concept";
    const copy = buildVisibleSlideCopy({
      fallbackBody: "Contenido pendiente de sintetizar desde fuentes aprobadas.",
      fallbackTitle: "Evidencia de la leccion",
      slideType: type,
      visibleLines: [insight.title, ...insight.bodyItems],
    });
    const slide: CourseSlideSpec = {
      bodyBlocks: [{ items: limitItems(copy.bodyItems), kind: "bullets" }],
      citations: [],
      id: `evidence-${slides.length + 1}`,
      order: params.startOrder + slides.length,
      title: copy.title,
      type,
      validationHints: { mustKeepClaims: [], sourceRefs: [insight.sourceRef] },
    };
    const signature = normalizedSlideSignature(slide);
    if (!signature || seen.has(signature)) continue;
    seen.add(signature);
    slides.push(slide);
  }

  return slides;
}

function resolvePlanning(params: BuildCourseDeckSpecParams) {
  if (params.planning) {
    return params.planning;
  }

  const brief = buildDeckBrief({
    component: params.component,
    input: params.input,
  });
  const evidence = buildEvidencePack({
    component: params.component,
  });
  const slidePlan = buildSlidePlan({
    brief,
    component: params.component,
    evidence,
    input: params.input,
  });

  return {
    evidence,
    slidePlan,
    visualAssignments: buildVisualAssignmentMap(slidePlan),
  };
}

function resolveVisualAssignments(slidePlan: SlidePlan, visualAssignments?: VisualAssignmentMap) {
  return visualAssignments || buildVisualAssignmentMap(slidePlan);
}

function plannedSlideById(slidePlan: SlidePlan, id: string) {
  return slidePlan.slides.find((slide) => slide.id === id);
}

function sourceRefsForSlide(slidePlan: SlidePlan, id: string, fallback: string[] = []) {
  const plannedSlide = plannedSlideById(slidePlan, id);
  const sourceRefs = plannedSlide?.sourceRefs.length
    ? plannedSlide.sourceRefs
    : fallback;
  return Array.from(new Set(sourceRefs)).slice(0, 8);
}

function renderHintsForSlide(
  visualAssignments: VisualAssignmentMap,
  slideId: string,
): CourseSlideSpec["renderHints"] {
  const assignment = visualAssignmentForSlide(visualAssignments, slideId);
  return assignment
    ? {
        layout: assignment.layout,
        purpose: assignment.purpose,
      }
    : undefined;
}

function buildCustomSlides(
  input: SlideDeckGenerateInput,
  slidePlan: SlidePlan,
  visualAssignments: VisualAssignmentMap,
): CourseSlideSpec[] | null {
  if (!input.customSlides?.length) {
    return null;
  }

  return input.customSlides.map((slide, index) => {
    const id = `custom-slide-${index + 1}`;
    const plannedSlide = plannedSlideById(slidePlan, id);
    const sourceRefs = sourceRefsForSlide(slidePlan, id, slide.chart?.sourceRefs || []);

    return {
      bodyBlocks: [{
        items: slide.bullets?.length ? slide.bullets : [slide.subtitle || "Contenido personalizado pendiente de ampliar."],
        kind: "bullets",
      }],
      chart: slide.chart,
      citations: [],
      id,
      order: index + 1,
      renderHints: renderHintsForSlide(visualAssignments, id),
      speakerNotes: slide.speakerNotes,
      subtitle: slide.subtitle,
      title: slide.title,
      type: slide.chart ? "data_explainer" : slide.type || plannedSlide?.type || (index === 0 ? "cover" : "concept"),
      validationHints: {
        mustKeepClaims: [],
        sourceRefs,
      },
    };
  });
}

function buildSlidesFromScript(
  content: Record<string, unknown>,
  title: string,
  slidePlan: SlidePlan,
  visualAssignments: VisualAssignmentMap,
  sourcePack?: SlideSourcePack,
): CourseSlideSpec[] {
  const script = asRecord(content.script);
  const sections = Array.isArray(script.sections)
    ? script.sections as ScriptSectionLike[]
    : [];

  if (sections.length === 0) {
    return [];
  }

  const contentSlides = sections.slice(0, 8).map((section, index): CourseSlideSpec => {
    const narration = compactText(section.narration_text);
    const id = `script-section-${section.section_number || index + 1}`;
    const plannedSlide = plannedSlideById(slidePlan, id);
    const baseVisibleLines = buildVisibleLinesFromScriptSection(section);
    const resolvedSlideType = plannedSlide?.type || (index === 0 ? "concept" : "worked_example");
    const sourceVisibleLines = sourceLinesForSlide(sourcePack, index, {
      slideType: resolvedSlideType,
    });
    const visibleLines = sourceVisibleLines.length > 0
      ? sourceVisibleLines
      : baseVisibleLines;
    const sourceRefs = sourceRefsForSlide(slidePlan, id, ["component.content.script"]);
    const copy = buildVisibleSlideCopy({
      fallbackBody: "Contenido pendiente de sintetizar desde fuentes aprobadas.",
      fallbackTitle: `Idea ${index + 1}`,
      slideType: resolvedSlideType,
      subtitle: sourceVisibleLines.length > 0
        ? undefined
        : compactEducationalText(section.visual_notes),
      visibleLines,
    });

    return {
      bodyBlocks: [{
        items: limitItems(copy.bodyItems),
        kind: "bullets",
      }],
      citations: [],
      id,
      order: index + 2,
      renderHints: renderHintsForSlide(visualAssignments, id),
      speakerNotes: limitText(narration, 1800) || undefined,
      subtitle: copy.subtitle,
      title: copy.title,
      type: resolvedSlideType,
      validationHints: {
        mustKeepClaims: [],
        sourceRefs,
      },
    };
  });
  const coverSourceRefs = sourceRefsForSlide(slidePlan, "cover", ["component.content.script"]);
  const chartSlides = buildChartSlides(content, contentSlides.length + 2, sourcePack);
  const additionalEvidenceSlides = buildAdditionalEvidenceSlides({
    existingSlides: [...contentSlides, ...chartSlides],
    sourcePack,
    startOrder: contentSlides.length + chartSlides.length + 2,
    targetSlideCount: slidePlan.targetSlideCount,
  });

  return [
    {
      bodyBlocks: [{
        kind: "paragraph",
        text: coverLeadFromContent(content, sourcePack),
      }],
      citations: [],
      id: "cover",
      order: 1,
      renderHints: renderHintsForSlide(visualAssignments, "cover"),
      subtitle: limitSlideCopy(script.title, copyBudgetForSlideType("cover").maxSubtitleCharacters) || undefined,
      title: limitSlideCopy(title, copyBudgetForSlideType("cover").maxTitleCharacters),
      type: "cover",
      validationHints: {
        mustKeepClaims: [],
        sourceRefs: coverSourceRefs,
      },
    },
    ...contentSlides,
    ...chartSlides,
    ...additionalEvidenceSlides,
  ];
}

function buildSlidesFromStoryboard(
  content: Record<string, unknown>,
  title: string,
  slidePlan: SlidePlan,
  visualAssignments: VisualAssignmentMap,
  sourcePack?: SlideSourcePack,
): CourseSlideSpec[] {
  const storyboard = Array.isArray(content.storyboard)
    ? content.storyboard as StoryboardItemLike[]
    : [];

  if (storyboard.length === 0) {
    return [];
  }

  const coverSourceRefs = sourceRefsForSlide(slidePlan, "cover", ["component.content.storyboard"]);

  return [
    {
      bodyBlocks: [{
        kind: "paragraph",
        text: coverLeadFromContent(content, sourcePack),
      }],
      citations: [],
      id: "cover",
      order: 1,
      renderHints: renderHintsForSlide(visualAssignments, "cover"),
      title: limitSlideCopy(title, copyBudgetForSlideType("cover").maxTitleCharacters),
      type: "cover",
      validationHints: {
        mustKeepClaims: [],
        sourceRefs: coverSourceRefs,
      },
    },
    ...storyboard.slice(0, 10).map((item, index): CourseSlideSpec => {
      const visibleLines = buildVisibleLinesFromStoryboardItem(item);
      const id = `storyboard-${item.take_number || index + 1}`;
      const plannedSlide = plannedSlideById(slidePlan, id);
      const resolvedSlideType = plannedSlide?.type || "concept";
      const sourceVisibleLines = sourceLinesForSlide(sourcePack, index, {
        slideType: resolvedSlideType,
      });
      const resolvedVisibleLines = sourceVisibleLines.length > 0
        ? sourceVisibleLines
        : visibleLines;
      const sourceRefs = sourceRefsForSlide(slidePlan, id, ["component.content.storyboard"]);
    const copy = buildVisibleSlideCopy({
      fallbackBody: "Contenido pendiente de sintetizar desde fuentes aprobadas.",
      fallbackTitle: `Escena ${item.take_number || index + 1}`,
      slideType: resolvedSlideType,
        subtitle: undefined,
        visibleLines: resolvedVisibleLines,
      });

      return {
        bodyBlocks: [{
          items: limitItems(copy.bodyItems),
          kind: "bullets",
        }],
        citations: [],
        id,
        order: index + 2,
        renderHints: renderHintsForSlide(visualAssignments, id),
        speakerNotes: limitText(item.narration_text, 1800) || undefined,
        subtitle: copy.subtitle,
        title: copy.title,
        type: resolvedSlideType,
        validationHints: {
          mustKeepClaims: [],
          sourceRefs,
        },
      };
    }),
  ];
}

function fallbackSlides(title: string, visualAssignments: VisualAssignmentMap): CourseSlideSpec[] {
  return [{
    bodyBlocks: [{
      items: [
        "Presentacion del objetivo de aprendizaje.",
        "Explicacion breve de los puntos clave.",
        "Cierre con una accion o reflexion para el estudiante.",
      ],
      kind: "bullets",
    }],
    citations: [],
    id: "fallback-cover",
    order: 1,
    renderHints: renderHintsForSlide(visualAssignments, "fallback-cover"),
    title: limitSlideCopy(title, copyBudgetForSlideType("cover").maxTitleCharacters),
    type: "cover",
    validationHints: {
      mustKeepClaims: [],
      sourceRefs: [],
    },
  }];
}

export function buildCourseDeckSpecFromComponent(params: BuildCourseDeckSpecParams): CourseDeckSpec {
  const content = asRecord(params.component.content);
  const { slidePlan, visualAssignments } = resolvePlanning(params);
  const resolvedVisualAssignments = resolveVisualAssignments(slidePlan, visualAssignments);
  const componentType = params.component.type || "UNKNOWN";
  const title = params.input.metadata?.title ||
    titleFromContent(content, `Diapositivas ${componentType}`);
  const customSlides = buildCustomSlides(params.input, slidePlan, resolvedVisualAssignments);
  const scriptSlides = customSlides
    ? []
    : buildSlidesFromScript(
        content,
        title,
        slidePlan,
        resolvedVisualAssignments,
        params.component.sourcePack,
      );
  const storyboardSlides = customSlides || scriptSlides.length > 0
    ? []
    : buildSlidesFromStoryboard(
        content,
        title,
        slidePlan,
        resolvedVisualAssignments,
        params.component.sourcePack,
      );
  const generatedSlides = customSlides ||
    (scriptSlides.length > 0 ? scriptSlides : storyboardSlides);
  const slides = generatedSlides.length > 0
    ? generatedSlides
    : fallbackSlides(title, resolvedVisualAssignments);
  const slidesWithCoverageTarget = slides.map((slide) => ({
    ...slide,
    validationHints: {
      ...slide.validationHints,
      targetSlideCount: slidePlan.targetSlideCount,
    },
  }));
  const source = customSlides
    ? "custom_request"
    : params.input.metadata
      ? "component_content_with_overrides"
      : "component_content";

  return courseDeckSpecSchema.parse({
    appearance: params.input.appearance,
    artifactId: params.artifactId,
    designSystem: {
      brandLabel: params.input.metadata?.brandLabel || "SofLIA - Engine",
    },
    format: "16:9",
    height: COURSE_DECK_HEIGHT,
    locale: params.input.locale,
    materialComponentId: params.component.id,
    schemaVersion: COURSE_DECK_SCHEMA_VERSION,
    slides: slidesWithCoverageTarget,
    sourceSnapshot: {
      componentType,
      source,
      title: limitSlideCopy(title, copyBudgetForSlideType("cover").maxTitleCharacters),
    },
    template: params.input.template,
    width: COURSE_DECK_WIDTH,
  });
}
