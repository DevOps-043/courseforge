import {
  COURSE_DECK_HEIGHT,
  COURSE_DECK_SCHEMA_VERSION,
  COURSE_DECK_WIDTH,
  courseDeckSpecSchema,
  type CourseDeckSpec,
  type CourseSlideSpec,
  type SlideDeckGenerateInput,
} from "../specs/course-deck.schema";

interface BuildCourseDeckSpecParams {
  artifactId: string;
  component: {
    content?: unknown;
    id: string;
    type?: string | null;
  };
  input: SlideDeckGenerateInput;
}

interface ScriptSectionLike {
  duration_seconds?: number;
  narration_text?: string;
  on_screen_text?: string;
  section_number?: number;
  visual_notes?: string;
}

interface StoryboardItemLike {
  narration_text?: string;
  on_screen_text?: string;
  take_number?: number;
  timecode_end?: string;
  timecode_start?: string;
  visual_content?: string;
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

function splitVisibleText(value: string) {
  return value
    .split(/\n|•|- /)
    .map((line) => line.trim())
    .filter(Boolean);
}

function titleFromContent(content: Record<string, unknown>, fallback: string) {
  const directTitle = compactText(content.title);
  const scriptTitle = compactText(asRecord(content.script).title);
  return limitText(directTitle || scriptTitle || fallback, 180);
}

function buildCustomSlides(input: SlideDeckGenerateInput): CourseSlideSpec[] | null {
  if (!input.customSlides?.length) {
    return null;
  }

  return input.customSlides.map((slide, index) => ({
    bodyBlocks: [{
      items: slide.bullets?.length ? slide.bullets : [slide.subtitle || "Contenido personalizado pendiente de ampliar."],
      kind: "bullets",
    }],
    chart: slide.chart,
    citations: [],
    id: `custom-slide-${index + 1}`,
    order: index + 1,
    speakerNotes: slide.speakerNotes,
    subtitle: slide.subtitle,
    title: slide.title,
    type: slide.type || (index === 0 ? "cover" : "concept"),
    validationHints: {
      mustKeepClaims: [],
      sourceRefs: [],
    },
  }));
}

function buildSlidesFromScript(content: Record<string, unknown>, title: string): CourseSlideSpec[] {
  const script = asRecord(content.script);
  const sections = Array.isArray(script.sections)
    ? script.sections as ScriptSectionLike[]
    : [];

  if (sections.length === 0) {
    return [];
  }

  const contentSlides = sections.slice(0, 8).map((section, index): CourseSlideSpec => {
    const visibleLines = splitVisibleText(compactText(section.on_screen_text));
    const sectionTitle = limitText(visibleLines[0] || `Idea ${index + 1}`, 180);
    const bullets = limitItems(visibleLines.slice(1, 5));
    const narration = compactText(section.narration_text);
    const fallbackItem = limitText(
      narration || compactText(section.visual_notes) || "Idea principal de la seccion.",
      240,
    );

    return {
      bodyBlocks: [{
        items: bullets.length ? bullets : [fallbackItem],
        kind: "bullets",
      }],
      citations: [],
      id: `script-section-${section.section_number || index + 1}`,
      order: index + 2,
      speakerNotes: limitText(narration, 1800) || undefined,
      subtitle: limitText(section.visual_notes, 240) || undefined,
      title: sectionTitle,
      type: index === 0 ? "concept" : "worked_example",
      validationHints: {
        mustKeepClaims: [],
        sourceRefs: [],
      },
    };
  });

  const durationPoints = sections
    .filter((section) => typeof section.duration_seconds === "number" && section.duration_seconds > 0)
    .slice(0, 8)
    .map((section, index) => ({
      label: `S${section.section_number || index + 1}`,
      value: Math.round(section.duration_seconds || 0),
    }));

  const chartSlide: CourseSlideSpec[] = durationPoints.length >= 2
    ? [{
        bodyBlocks: [{
          kind: "paragraph",
          text: "Esta distribucion ayuda a validar el ritmo narrativo antes de usar las diapositivas en video.",
        }],
        chart: {
          id: "duration-distribution",
          points: durationPoints,
          sourceRefs: ["script.sections.duration_seconds"],
          subtitle: "Duracion estimada por seccion del guion generado",
          title: "Ritmo del video",
          type: "bar",
          unit: "s",
        },
        citations: [],
        id: "duration-distribution",
        order: contentSlides.length + 2,
        speakerNotes: "Usa esta slide para revisar si alguna seccion concentra demasiado tiempo frente al resto del guion.",
        title: "Distribucion de tiempo por seccion",
        type: "data_explainer",
        validationHints: {
          mustKeepClaims: ["Los valores provienen de duration_seconds del guion generado."],
          sourceRefs: ["script.sections"],
        },
      }]
    : [];

  return [
    {
      bodyBlocks: [{
        kind: "paragraph",
        text: "Diapositivas generadas desde el guion aprobado del componente. Puedes reemplazar esta informacion con contenido personalizado en la solicitud.",
      }],
      citations: [],
      id: "cover",
      order: 1,
      subtitle: limitText(script.title, 240) || undefined,
      title: limitText(title, 180),
      type: "cover",
      validationHints: {
        mustKeepClaims: [],
        sourceRefs: ["component.content.script"],
      },
    },
    ...contentSlides,
    ...chartSlide,
  ];
}

function buildSlidesFromStoryboard(content: Record<string, unknown>, title: string): CourseSlideSpec[] {
  const storyboard = Array.isArray(content.storyboard)
    ? content.storyboard as StoryboardItemLike[]
    : [];

  if (storyboard.length === 0) {
    return [];
  }

  return [
    {
      bodyBlocks: [{
        kind: "paragraph",
        text: "Secuencia visual generada desde el storyboard aprobado del componente.",
      }],
      citations: [],
      id: "cover",
      order: 1,
      title: limitText(title, 180),
      type: "cover",
      validationHints: {
        mustKeepClaims: [],
        sourceRefs: ["component.content.storyboard"],
      },
    },
    ...storyboard.slice(0, 10).map((item, index): CourseSlideSpec => {
      const visibleLines = splitVisibleText(compactText(item.on_screen_text));
      const bodyItems = limitItems(visibleLines.slice(1, 5));
      const fallbackItem = limitText(
        compactText(item.visual_content) || compactText(item.narration_text) || "Accion visual de la escena.",
        240,
      );
      return {
        bodyBlocks: [{
          items: bodyItems.length ? bodyItems : [fallbackItem],
          kind: "bullets",
        }],
        citations: [],
        id: `storyboard-${item.take_number || index + 1}`,
        order: index + 2,
        speakerNotes: limitText(item.narration_text, 1800) || undefined,
        subtitle: limitText(item.visual_content, 240) || undefined,
        title: limitText(visibleLines[0] || `Escena ${item.take_number || index + 1}`, 180),
        type: "concept",
        validationHints: {
          mustKeepClaims: [],
          sourceRefs: ["component.content.storyboard"],
        },
      };
    }),
  ];
}

function fallbackSlides(title: string): CourseSlideSpec[] {
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
    title: limitText(title, 180),
    type: "cover",
    validationHints: {
      mustKeepClaims: [],
      sourceRefs: [],
    },
  }];
}

export function buildCourseDeckSpecFromComponent(params: BuildCourseDeckSpecParams): CourseDeckSpec {
  const content = asRecord(params.component.content);
  const componentType = params.component.type || "UNKNOWN";
  const title = params.input.metadata?.title ||
    titleFromContent(content, `Diapositivas ${componentType}`);
  const customSlides = buildCustomSlides(params.input);
  const scriptSlides = customSlides ? [] : buildSlidesFromScript(content, title);
  const storyboardSlides = customSlides || scriptSlides.length > 0
    ? []
    : buildSlidesFromStoryboard(content, title);
  const generatedSlides = customSlides ||
    (scriptSlides.length > 0 ? scriptSlides : storyboardSlides);
  const slides = generatedSlides.length > 0 ? generatedSlides : fallbackSlides(title);
  const source = customSlides
    ? "custom_request"
    : params.input.metadata
      ? "component_content_with_overrides"
      : "component_content";

  return courseDeckSpecSchema.parse({
    artifactId: params.artifactId,
    designSystem: {
      brandLabel: params.input.metadata?.brandLabel || "SofLIA - Engine",
    },
    format: "16:9",
    height: COURSE_DECK_HEIGHT,
    locale: params.input.locale,
    materialComponentId: params.component.id,
    schemaVersion: COURSE_DECK_SCHEMA_VERSION,
    slides,
    sourceSnapshot: {
      componentType,
      source,
      title: limitText(title, 180),
    },
    template: params.input.template,
    width: COURSE_DECK_WIDTH,
  });
}
