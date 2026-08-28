import crypto from "crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { z } from "zod";
import {
  COURSE_DECK_HEIGHT,
  COURSE_DECK_SCHEMA_VERSION,
  COURSE_DECK_WIDTH,
  courseDeckSpecSchema,
  type CourseDeckSpec,
  type CourseSlideSpec,
} from "../slides/specs/course-deck.schema";
import { SOFLIA_SLIDE_TEMPLATE_BACKGROUND } from "../slides/templates/slide-template-theme";

function templateAssetPath(fileName: string) {
  return [
    path.join(process.cwd(), "src", "domains", "production", "slides", "templates", "soflia-deck", fileName),
    path.join(process.cwd(), "apps", "web", "src", "domains", "production", "slides", "templates", "soflia-deck", fileName),
  ];
}

function readTemplateJsonAsset<T>(fileName: string): T {
  const errors: string[] = [];
  for (const candidate of templateAssetPath(fileName)) {
    try {
      return JSON.parse(readFileSync(candidate, "utf8")) as T;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(`No se pudo leer ${fileName}: ${errors.join(" | ")}`);
}

const skillManifest = readTemplateJsonAsset<Record<string, unknown>>("soflia-deck.skill-manifest.json");
const templateManifest = readTemplateJsonAsset<Record<string, unknown>>("soflia-deck.template-manifest.json");
const exampleDeck = readTemplateJsonAsset<Record<string, unknown>>("examples/soflia-course-lesson.deck.json");

const hexColorSchema = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/);

const slideTemplateDesignTokensSchema = z.object({
  accent: hexColorSchema.default("#00D4B3"),
  accent2: hexColorSchema.default("#2D7D6E"),
  background: hexColorSchema.default(SOFLIA_SLIDE_TEMPLATE_BACKGROUND),
  muted: hexColorSchema.default("#65758B"),
  surface: hexColorSchema.default("#FFFFFF"),
  text: hexColorSchema.default("#0A2540"),
});

const slideTemplateModifiersSchema = z.object({
  cornerRadius: z.number().int().min(0).max(32).default(8),
  density: z.enum(["compact", "comfortable", "spacious"]).default("comfortable"),
  fontPairing: z.enum(["system_sans", "editorial_serif", "technical_mono"]).default("system_sans"),
  font: z.object({
    cssUrl: z.string().url().max(2000).optional(),
    family: z.string().trim().regex(/^[a-zA-Z0-9 ._-]+$/).min(1).max(120),
    source: z.enum(["google", "uploaded"]),
  }).optional(),
  showBrandMark: z.boolean().default(true),
});

const slideTemplateImageSlotSchema = z.object({
  id: z.string().trim().regex(/^[a-z][a-z0-9_]*$/).min(2).max(80),
  opacity: z.number().min(0).max(1).optional(),
  placement: z.enum(["background", "image_pane"]),
  purpose: z.enum(["background", "supporting"]),
});

const slideTemplateLayoutDefinitionSchema = z.object({
  id: z.enum(["center", "closing", "data", "framework", "split", "split_reverse"]),
  imageSlots: z.array(slideTemplateImageSlotSchema).max(4).default([]),
  label: z.string().trim().min(1).max(80),
  purpose: z.string().trim().min(1).max(240),
  regions: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
});

const slideTemplateTypeIdSchema = z.string()
  .trim()
  .regex(/^[a-z][a-z0-9_]*$/)
  .min(2)
  .max(48);

const slideTemplateTypeDefinitionSchema = z.object({
  defaultLayout: z.enum(["center", "closing", "data", "framework", "split", "split_reverse"]),
  id: slideTemplateTypeIdSchema,
  label: z.string().trim().min(1).max(80),
  purpose: z.string().trim().min(1).max(240),
  requiredContent: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
});

const slideTemplateAgentsSchema = z.object({
  layoutDesigner: z.string().trim().min(1).max(500),
  styleDirector: z.string().trim().min(1).max(500),
  templateCoder: z.string().trim().min(1).max(500),
  typeSelector: z.string().trim().min(1).max(500),
});

const slideTemplateBlueprintSchema = z.object({
  agents: slideTemplateAgentsSchema,
  designTokens: slideTemplateDesignTokensSchema,
  layouts: z.array(slideTemplateLayoutDefinitionSchema).min(1).max(8),
  modifiers: slideTemplateModifiersSchema,
  slideTypes: z.array(slideTemplateTypeDefinitionSchema).min(1).max(12),
  visualStyleGuide: z.string().trim().min(1).max(600).default("Editorial educational visual, refined and restrained, with clear subject hierarchy and no embedded text."),
});

const DEFAULT_LAYOUTS: z.infer<typeof slideTemplateLayoutDefinitionSchema>[] = [
  {
    id: "center",
    label: "Portada centrada",
    purpose: "Titulos, intros y transiciones con una sola idea dominante.",
    regions: ["kicker", "title", "subtitle", "support_points"],
    imageSlots: [{ id: "atmospheric_background", placement: "background", purpose: "background", opacity: 0.14 }],
  },
  {
    id: "split",
    label: "Texto + visual",
    purpose: "Explicaciones con jerarquia clara entre concepto y evidencia visual.",
    regions: ["copy", "visual", "citation"],
    imageSlots: [{ id: "supporting_visual", placement: "image_pane", purpose: "supporting" }],
  },
  {
    id: "framework",
    label: "Marco de ideas",
    purpose: "Modelos, pasos, listas cortas y estructuras de aprendizaje.",
    regions: ["header", "columns", "callout"],
    imageSlots: [],
  },
  {
    id: "data",
    label: "Datos con contexto",
    purpose: "Graficas solo cuando la leccion contiene datos comparables o cuantitativos.",
    regions: ["chart", "insight", "source"],
    imageSlots: [],
  },
  {
    id: "closing",
    label: "Cierre operativo",
    purpose: "Resumen, accion siguiente o recapitulacion de la leccion.",
    regions: ["title", "takeaways", "next_step"],
    imageSlots: [{ id: "atmospheric_background", placement: "background", purpose: "background", opacity: 0.16 }],
  },
];

const DEFAULT_SLIDE_TYPES: z.infer<typeof slideTemplateTypeDefinitionSchema>[] = [
  {
    id: "cover",
    label: "Titulo",
    defaultLayout: "center",
    purpose: "Abrir la leccion con tema, contexto y promesa visual.",
    requiredContent: ["title", "subtitle"],
  },
  {
    id: "objectives",
    label: "Objetivos",
    defaultLayout: "framework",
    purpose: "Presentar resultados de aprendizaje sin copiar narracion del avatar.",
    requiredContent: ["objective_list"],
  },
  {
    id: "concept",
    label: "Conceptos",
    defaultLayout: "split",
    purpose: "Definir conceptos centrales con apoyo visual sintetico.",
    requiredContent: ["concept", "definition", "example"],
  },
  {
    id: "explanation",
    label: "Explicaciones",
    defaultLayout: "split_reverse",
    purpose: "Desarrollar una idea o proceso con pasos y soporte visual.",
    requiredContent: ["claim", "support_points", "implication"],
  },
  {
    id: "diagram",
    label: "Diagrama",
    defaultLayout: "framework",
    purpose: "Organizar relaciones, procesos o decisiones de la leccion.",
    requiredContent: ["nodes", "relationships"],
  },
  {
    id: "data_explainer",
    label: "Grafica",
    defaultLayout: "data",
    purpose: "Mostrar datos educativos verificables cuando agregan valor.",
    requiredContent: ["chart_data", "insight", "source"],
  },
  {
    id: "summary",
    label: "Conclusiones",
    defaultLayout: "closing",
    purpose: "Cerrar con aprendizajes aplicables y siguiente paso.",
    requiredContent: ["takeaways", "next_step"],
  },
  {
    id: "bibliography",
    label: "Bibliografia / fuentes",
    defaultLayout: "framework",
    purpose: "Mostrar fuentes y referencias usadas en la leccion sin saturar la narracion.",
    requiredContent: ["source_title", "source_type", "source_relevance"],
  },
];

const slideTemplateSpecSchema = z.object({
  artifactKind: z.literal("slide_template"),
  changeSummary: z.string().trim().max(1000),
  description: z.string().trim().max(1000),
  examples: z.array(z.record(z.string(), z.unknown())).min(1).max(8),
  packageId: z.string().trim().min(1).max(120),
  skillManifest: z.record(z.string(), z.unknown()),
  templateBlueprint: slideTemplateBlueprintSchema,
  templateManifest: z.record(z.string(), z.unknown()),
  title: z.string().trim().min(1).max(120),
});

export type SlideTemplateAgentSpec = z.infer<typeof slideTemplateSpecSchema>;

function slugifyPackageId(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/_+/g, "-")
    .toLowerCase()
    .slice(0, 90);

  return /^[a-z0-9]/.test(normalized) ? normalized : "soflia-deck-template";
}

function latestUserText(messages: Array<{ role: string; content_redacted: string }>) {
  return [...messages]
    .reverse()
    .find((message) => message.role === "USER")
    ?.content_redacted
    .trim() || "";
}

function inferSlideTemplateTitle(input: {
  fallbackTitle?: string | null;
  messages: Array<{ role: string; content_redacted: string }>;
}) {
  const fallback = input.fallbackTitle?.trim();
  const latest = latestUserText(input.messages);
  if (fallback && !/^nuevo bundle de video$/i.test(fallback)) {
    return fallback.slice(0, 120);
  }

  const firstSentence = latest
    .split(/[.\n]/)
    .map((part) => part.trim())
    .find(Boolean);

  return (firstSentence || "Plantilla SofLIA Deck").slice(0, 120);
}

function inferDescription(messages: Array<{ role: string; content_redacted: string }>, title: string) {
  const userText = messages
    .filter((message) => message.role === "USER")
    .map((message) => message.content_redacted)
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();

  return (userText || `Plantilla de slides ${title} para SofLIA.`).slice(0, 1000);
}

function getConversationText(messages: Array<{ role: string; content_redacted: string }>) {
  return messages
    .filter((message) => message.role === "USER")
    .map((message) => message.content_redacted)
    .join("\n")
    .toLowerCase();
}

function normalizeForMatching(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function inferDesignTokens(messages: Array<{ role: string; content_redacted: string }>) {
  const text = normalizeForMatching(getConversationText(messages));
  const wantsWhitePrimaryText = /((texto|letra|tipografia|fuente)(\s+primaria)?\s+blanc[oa]|color\s+de\s+(texto|letra|tipografia|fuente)(\s+primaria)?[^.,"\n;]*blanc[oa])/i.test(text);
  const wantsWhiteSecondaryText = /((texto|letra|tipografia|fuente)\s+secundaria\s+blanc[oa]|secundari[ao][^.,"\n;]*blanc[oa]|primari[ao]\s+y\s+secundari[ao][^.,"\n;]*blanc[oa])/i.test(text);
  const wantsGrayBackground = /(gris claro|fondo gris|background gris|color\s+de\s+fondo\s+gris|gray|grey)/i.test(text);
  const backgroundColor = (fallback: string) => wantsGrayBackground ? "#F3F4F6" : fallback;
  const textColor = (fallback: string) => wantsWhitePrimaryText ? "#F8FAFC" : fallback;
  const mutedColor = (fallback: string) => wantsWhiteSecondaryText ? "#F8FAFC" : fallback;
  if (/(mostaza|dorado|amarillo|gold)/i.test(text) && /(morad[oa]|purpura|violeta|purple)/i.test(text)) {
    return {
      accent: "#D6A21E",
      accent2: "#3B1D5C",
      background: backgroundColor("#F7FAFC"),
      muted: mutedColor("#65758B"),
      surface: "#FFFFFF",
      text: textColor("#0A2540"),
    };
  }

  if (/(oscuro|dark|nocturno|cinematic|cinematografico)/i.test(text)) {
    return {
      accent: "#00D4B3",
      accent2: "#7C3AED",
      background: "#05070B",
      muted: "#94A3B8",
      surface: "#111827",
      text: "#F8FAFC",
    };
  }

  if (/(corporativo|empresa|ejecutivo|sobrio|serio)/i.test(text)) {
    return {
      accent: "#0F766E",
      accent2: "#2563EB",
      background: backgroundColor("#F8FAFC"),
      muted: mutedColor("#64748B"),
      surface: "#FFFFFF",
      text: textColor("#0F172A"),
    };
  }

  if (/(academico|universidad|investigacion|formal)/i.test(text)) {
    return {
      accent: "#2D7D6E",
      accent2: "#D88A3A",
      background: backgroundColor("#F6F8FB"),
      muted: mutedColor("#667085"),
      surface: "#FFFFFF",
      text: textColor("#172033"),
    };
  }

  if (/(creativo|vibrante|colorido|dinamico)/i.test(text)) {
    return {
      accent: "#E11D48",
      accent2: "#0EA5E9",
      background: backgroundColor("#FFF7ED"),
      muted: mutedColor("#6B7280"),
      surface: "#FFFFFF",
      text: textColor("#111827"),
    };
  }

  return {
    accent: "#00D4B3",
    accent2: "#2D7D6E",
    background: backgroundColor("#F7FAFC"),
    muted: mutedColor("#65758B"),
    surface: "#FFFFFF",
    text: textColor("#0A2540"),
  };
}

function inferModifiers(messages: Array<{ role: string; content_redacted: string }>) {
  const text = normalizeForMatching(getConversationText(messages));
  return {
    cornerRadius: /(recto|sharp|cuadrado|editorial)/i.test(text) ? 4 : 8,
    density: /(compacto|denso|operativo|dashboard)/i.test(text)
      ? "compact"
      : /(espaciado|aire|minimal|limpio)/i.test(text)
        ? "spacious"
        : "comfortable",
    fontPairing: /(codigo|tecnico|programacion|developer)/i.test(text)
      ? "technical_mono"
      : /(editorial|revista|serif|elegante)/i.test(text)
        ? "editorial_serif"
        : "system_sans",
    showBrandMark: !/(sin marca|sin brand|no logo)/i.test(text),
  } satisfies z.infer<typeof slideTemplateModifiersSchema>;
}

const KNOWN_SLIDE_TYPE_ALIASES: Array<{
  id: z.infer<typeof slideTemplateTypeIdSchema>;
  match: RegExp;
}> = [
  { id: "cover", match: /\b(titulo|titulos|title|portada|cover)\b/i },
  { id: "objectives", match: /\b(objetivo|objetivos|metas|resultados)\b/i },
  { id: "concept", match: /\b(concepto|conceptos|definicion|definiciones)\b/i },
  { id: "explanation", match: /\b(explicacion|explicaciones|explanation|desarrollo)\b/i },
  { id: "data_explainer", match: /\b(grafica|graficas|chart|datos|metricas)\b/i },
  { id: "summary", match: /\b(conclusion|conclusiones|cierre|resumen|recapitulacion)\b/i },
  { id: "bibliography", match: /\b(bibliografia|fuente|fuentes|referencia|referencias)\b/i },
  { id: "knowledge_check", match: /\b(quiz|pregunta|preguntas|evaluacion|check|conocimiento)\b/i },
  { id: "exercise", match: /\b(ejercicio|practica|actividad|reto)\b/i },
  { id: "worked_example", match: /\b(ejemplo|demo|caso|walkthrough)\b/i },
  { id: "quote", match: /\b(cita|quote|principio|frase)\b/i },
  { id: "transition", match: /\b(transicion|separador|intermedio)\b/i },
];

const STYLE_OR_ASSET_SEGMENT_PATTERNS = [
  /\b(paleta|color|colores|fondo|background|letra|texto|tipografia|fuente)\b/i,
  /\b(morad[oa]|purpura|violeta|mostaza|amarillo|beige|gris|blanco|negro|dorado|azul|verde|rojo)\b/i,
  /\b(elegante|moderno|moderna|sobrio|corporativo|visual|look|estilo|detalles?)\b/i,
  /\b(b-?rolls?|imagenes?|videos?|assets?|motion|animacion|animaciones)\b/i,
];

function findKnownSlideTypeId(value: string) {
  const normalized = normalizeForMatching(value);
  return KNOWN_SLIDE_TYPE_ALIASES.find((alias) => alias.match.test(normalized))?.id || null;
}

function titleCaseLabel(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    .slice(0, 80);
}

function createGeneratedSlideType(rawLabel: string): z.infer<typeof slideTemplateTypeDefinitionSchema> | null {
  const normalized = normalizeForMatching(rawLabel)
    .replace(/[^a-z0-9\s_-]/g, " ")
    .replace(/\b(diapositiva|diapositivas|slide|slides|de|del|la|el|los|las|para|con)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length < 4) return null;
  if (STYLE_OR_ASSET_SEGMENT_PATTERNS.some((pattern) => pattern.test(normalized))) return null;

  const id = normalized
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 48)
    .replace(/_$/g, "");
  if (!slideTemplateTypeIdSchema.safeParse(id).success) return null;

  return {
    defaultLayout: /(comparativo|comparison|decision|mapa|framework|matriz|lista|pasos)/i.test(normalized)
      ? "framework"
      : /(dato|datos|metrica|grafica|chart)/i.test(normalized)
        ? "data"
        : /(cierre|conclusion|resumen)/i.test(normalized)
          ? "closing"
          : "split",
    id,
    label: titleCaseLabel(normalized),
    purpose: `Cubrir ${normalized} con contenido sintetico, visual y verificable para la leccion.`,
    requiredContent: ["main_point", "supporting_evidence", "learner_takeaway"],
  };
}

function extractExplicitSlideTypeSegments(messages: Array<{ role: string; content_redacted: string }>) {
  const latest = latestUserText(messages);
  const match = [
    latest.match(/(?:diapositivas?\s+de|tipos?\s+de\s+diapositivas?)([\s\S]+)/i),
    latest.match(/(?:deck|plantilla)\s+que\s+(?:contenga|incluya|tenga)([\s\S]+)/i),
    latest.match(/(?:debe\s+(?:tener|incluir)|requerimos|necesitamos)\s+diapositivas?\s+(?:de|con)?([\s\S]+)/i),
  ].find((candidate) => candidate?.[1]);
  if (!match?.[1]) return [];

  return match[1]
    .split(/[,;\n]|\s+y\s+|\s+e\s+|\//i)
    .map((segment) => segment.trim())
    .filter((segment) => {
      if (segment.length === 0) return false;
      if (findKnownSlideTypeId(segment)) return true;
      return !STYLE_OR_ASSET_SEGMENT_PATTERNS.some((pattern) => pattern.test(normalizeForMatching(segment)));
    })
    .slice(0, 12);
}

function withoutLatestUserMessage(messages: Array<{ role: string; content_redacted: string }>) {
  const latestUserIndex = [...messages]
    .map((message, index) => ({ index, role: message.role }))
    .reverse()
    .find((message) => message.role === "USER")
    ?.index;

  if (latestUserIndex === undefined) {
    return messages;
  }

  return messages.filter((_, index) => index !== latestUserIndex);
}

function extractSlideTypeRemovalIds(latestUserMessage: string) {
  const normalized = normalizeForMatching(latestUserMessage);
  if (!/(elimin|quita|remov|borra|sin|exclu|no\s+(incluy|agreg|pong|uses?))/i.test(normalized)) {
    return new Set<z.infer<typeof slideTemplateTypeIdSchema>>();
  }

  const removed = new Set<z.infer<typeof slideTemplateTypeIdSchema>>();
  for (const alias of KNOWN_SLIDE_TYPE_ALIASES) {
    if (alias.match.test(normalized)) {
      removed.add(alias.id);
    }
  }

  return removed;
}

function inferPositiveSlideTypes(messages: Array<{ role: string; content_redacted: string }>) {
  const text = normalizeForMatching(getConversationText(messages));
  const byId = new Map(DEFAULT_SLIDE_TYPES.map((slideType) => [slideType.id, slideType]));
  const explicitRequestedTypes: z.infer<typeof slideTemplateTypeDefinitionSchema>[] = [];
  const addExplicitType = (id: z.infer<typeof slideTemplateTypeIdSchema>) => {
    const slideType = byId.get(id);
    if (slideType && !explicitRequestedTypes.some((item) => item.id === id)) {
      explicitRequestedTypes.push(slideType);
    }
  };
  const addRequestedType = (rawLabel: string) => {
    const knownId = findKnownSlideTypeId(rawLabel);
    if (knownId) {
      addExplicitType(knownId);
      return;
    }

    const generated = createGeneratedSlideType(rawLabel);
    if (generated && !explicitRequestedTypes.some((item) => item.id === generated.id)) {
      explicitRequestedTypes.push(generated);
    }
  };

  if (/(diapositivas?\s+de|requerimos|necesitamos|tipos?\s+de\s+diapositiva)/i.test(text)) {
    for (const segment of extractExplicitSlideTypeSegments(messages)) {
      addRequestedType(segment);
    }
    if (explicitRequestedTypes.length > 0) {
      return explicitRequestedTypes;
    }
  }

  if (false && /(diapositivas?\s+de|requerimos|necesitamos|tipos?\s+de\s+diapositiva)/i.test(text)) {
    if (/(titulo|títulos|title|portada)/i.test(text)) addExplicitType("cover");
    if (/(objetivo|objetivos)/i.test(text)) addExplicitType("objectives");
    if (/(concepto|conceptos)/i.test(text)) addExplicitType("concept");
    if (/(explicacion|explicaciones|explanation)/i.test(text)) addExplicitType("explanation");
    if (/(grafica|graficas|gráfica|gráficas|chart|datos)/i.test(text)) addExplicitType("data_explainer");
    if (/(conclusion|conclusiones|cierre|resumen)/i.test(text)) addExplicitType("summary");
    if (/(bibliografia|bibliografía|fuente|fuentes|referencia|referencias)/i.test(text)) addExplicitType("bibliography");
    if (explicitRequestedTypes.length > 0) {
      return explicitRequestedTypes;
    }
  }

  const selected = [...DEFAULT_SLIDE_TYPES];

  if (/(quiz|pregunta|evaluacion|check|conocimiento)/i.test(text)) {
    selected.splice(selected.length - 1, 0, {
      id: "knowledge_check",
      label: "Pregunta",
      defaultLayout: "framework",
      purpose: "Validar comprension con una pregunta o decision puntual.",
      requiredContent: ["question", "options", "feedback"],
    });
  }

  if (/(ejercicio|practica|actividad|reto)/i.test(text)) {
    selected.splice(selected.length - 1, 0, {
      id: "exercise",
      label: "Actividad",
      defaultLayout: "split_reverse",
      purpose: "Presentar instrucciones visibles y criterios de realizacion.",
      requiredContent: ["task", "steps", "success_criteria"],
    });
  }

  if (/(ejemplo|demo|caso|walkthrough)/i.test(text)) {
    selected.splice(selected.length - 1, 0, {
      id: "worked_example",
      label: "Ejemplo guiado",
      defaultLayout: "split",
      purpose: "Mostrar una aplicacion concreta con pasos resumidos.",
      requiredContent: ["scenario", "steps", "result"],
    });
  }

  if (/(cita|quote|principio|frase)/i.test(text)) {
    selected.splice(selected.length - 1, 0, {
      id: "quote",
      label: "Cita",
      defaultLayout: "center",
      purpose: "Resaltar un principio o idea memorable de la leccion.",
      requiredContent: ["quote", "source"],
    });
  }

  return selected.slice(0, 10);
}

function inferSlideTypes(messages: Array<{ role: string; content_redacted: string }>) {
  const removedTypeIds = extractSlideTypeRemovalIds(latestUserText(messages));
  if (removedTypeIds.size === 0) {
    return inferPositiveSlideTypes(messages);
  }

  const previousSlideTypes = inferPositiveSlideTypes(withoutLatestUserMessage(messages));
  const revisedSlideTypes = previousSlideTypes.filter((slideType) => !removedTypeIds.has(slideType.id));
  return revisedSlideTypes.length > 0 ? revisedSlideTypes : DEFAULT_SLIDE_TYPES.filter(
    (slideType) => !removedTypeIds.has(slideType.id),
  ).slice(0, 10);
}

function inferLayouts(slideTypes: z.infer<typeof slideTemplateTypeDefinitionSchema>[]) {
  const requiredLayouts = new Set(slideTypes.map((slideType) => slideType.defaultLayout));
  return DEFAULT_LAYOUTS.filter((layout) => requiredLayouts.has(layout.id));
}

function buildTemplateAgents(input: {
  layouts: z.infer<typeof slideTemplateLayoutDefinitionSchema>[];
  messages: Array<{ role: string; content_redacted: string }>;
  slideTypes: z.infer<typeof slideTemplateTypeDefinitionSchema>[];
}) {
  const latest = latestUserText(input.messages);
  return {
    layoutDesigner: `Selecciona ${input.layouts.length} layouts HTML 16:9 con regiones estables y sin ocultar contenido por animaciones.`,
    styleDirector: "Define tokens de color, tipografia y densidad editables antes de guardar el paquete.",
    templateCoder: "Entrega un paquete HTML autocontenido con manifest, schema, ejemplos y blueprint versionado.",
    typeSelector: `Detecta ${input.slideTypes.length} tipos de diapositiva desde la conversacion${latest ? `: ${latest.slice(0, 180)}` : "."}`,
  };
}

function buildSlideTemplateBlueprint(input: {
  messages: Array<{ role: string; content_redacted: string }>;
}) {
  const slideTypes = inferSlideTypes(input.messages);
  const layouts = inferLayouts(slideTypes);
  return slideTemplateBlueprintSchema.parse({
    agents: buildTemplateAgents({ layouts, messages: input.messages, slideTypes }),
    designTokens: inferDesignTokens(input.messages),
    layouts,
    modifiers: inferModifiers(input.messages),
    slideTypes,
  });
}

function asPlainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isLightTemplateColor(hex: string) {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 >= 150;
}

function normalizeLightSlideTemplateTokens(
  tokens: z.infer<typeof slideTemplateDesignTokensSchema>,
) {
  return slideTemplateDesignTokensSchema.parse({
    ...tokens,
    background: SOFLIA_SLIDE_TEMPLATE_BACKGROUND,
    muted: isLightTemplateColor(tokens.muted) ? "#65758B" : tokens.muted,
    surface: isLightTemplateColor(tokens.surface) ? tokens.surface : "#FFFFFF",
    text: isLightTemplateColor(tokens.text) ? "#0A2540" : tokens.text,
  });
}

function mergeSlideTemplateBlueprintOverride(
  baseBlueprint: z.infer<typeof slideTemplateBlueprintSchema>,
  overrides: unknown,
) {
  const blueprintOverrides = asPlainRecord(overrides);
  const designTokenOverrides = asPlainRecord(blueprintOverrides.designTokens);
  const modifierOverrides = asPlainRecord(blueprintOverrides.modifiers);
  const slideTypes = Array.isArray(blueprintOverrides.slideTypes)
    ? blueprintOverrides.slideTypes
    : baseBlueprint.slideTypes;
  const parsedSlideTypes = z.array(slideTemplateTypeDefinitionSchema).min(1).max(12).parse(slideTypes);

  return slideTemplateBlueprintSchema.parse({
    ...baseBlueprint,
    ...blueprintOverrides,
    agents: {
      ...baseBlueprint.agents,
      ...asPlainRecord(blueprintOverrides.agents),
    },
    designTokens: normalizeLightSlideTemplateTokens(slideTemplateDesignTokensSchema.parse({
      ...baseBlueprint.designTokens,
      ...designTokenOverrides,
    })),
    layouts: Array.isArray(blueprintOverrides.layouts)
      ? blueprintOverrides.layouts
      : inferLayouts(parsedSlideTypes),
    modifiers: {
      ...baseBlueprint.modifiers,
      ...modifierOverrides,
    },
    slideTypes: parsedSlideTypes,
  });
}

function createExampleSlide(
  slideType: z.infer<typeof slideTemplateTypeDefinitionSchema>,
  order: number,
): CourseSlideSpec {
  const base = {
    citations: [],
    id: `template-${slideType.id}`,
    order,
    renderHints: {
      layout: slideType.defaultLayout,
      purpose: slideType.purpose,
    },
    subtitle: slideType.purpose,
    title: slideType.label,
    type: slideType.id,
    validationHints: {
      mustKeepClaims: [],
      sourceRefs: ["template-blueprint"],
    },
  } satisfies Omit<CourseSlideSpec, "bodyBlocks" | "chart">;

  if (slideType.id === "data_explainer") {
    return {
      ...base,
      bodyBlocks: [
        {
          kind: "callout",
          text: "Usar grafica solo cuando existan datos comparables en la leccion.",
        },
      ],
      chart: {
        id: "template-data-readiness",
        points: [
          { label: "Fuente", value: 4 },
          { label: "Comparacion", value: 3 },
          { label: "Insight", value: 5 },
        ],
        sourceRefs: ["template-blueprint"],
        title: "Estructura de datos requerida",
        type: "bar",
        unit: "nivel",
      },
    };
  }

  return {
    ...base,
    bodyBlocks: [
      {
        kind: "bullets",
        items: slideType.requiredContent.map((item) => item.replace(/_/g, " ")),
      },
    ],
  };
}

function buildSlideTemplateExampleDeck(spec: {
  templateBlueprint: z.infer<typeof slideTemplateBlueprintSchema>;
  title: string;
}): CourseDeckSpec {
  const exampleSlides = spec.templateBlueprint.slideTypes
    .slice(0, 8)
    .map((slideType, index) => createExampleSlide(slideType, index + 1));

  return courseDeckSpecSchema.parse({
    appearance: "light",
    artifactId: "slide-template-example",
    designSystem: {
      accent: spec.templateBlueprint.designTokens.accent,
      accent2: spec.templateBlueprint.designTokens.accent2,
      brandLabel: "SofLIA",
      tone: "corporate",
    },
    format: "16:9",
    height: COURSE_DECK_HEIGHT,
    locale: "es",
    materialComponentId: "slide-template-example-component",
    schemaVersion: COURSE_DECK_SCHEMA_VERSION,
    slides: exampleSlides,
    sourceSnapshot: {
      componentType: "slide_template_blueprint",
      source: "custom_request",
      title: spec.title,
    },
    template: "course-module",
    width: COURSE_DECK_WIDTH,
  });
}

async function readTemplateAsset(fileName: string) {
  const errors: string[] = [];
  for (const candidate of templateAssetPath(fileName)) {
    try {
      return await readFile(candidate, "utf8");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(`No se pudo leer ${fileName}: ${errors.join(" | ")}`);
}

export function buildSlideTemplateSpecFromConversation(input: {
  title?: string | null;
  messages: Array<{ role: string; content_redacted: string }>;
  overrides?: unknown;
}): SlideTemplateAgentSpec {
  const title = inferSlideTemplateTitle({
    fallbackTitle: input.title,
    messages: input.messages,
  });
  const description = inferDescription(input.messages, title);
  const packageId = slugifyPackageId(title);
  const changeSummary = input.messages.filter((message) => message.role === "USER").length > 1
    ? `SofLIA adjusted the slide template package using the latest feedback: ${latestUserText(input.messages).slice(0, 220)}`
    : "SofLIA generated a SofLIA Deck slide-template package from the conversation.";
  const baseBlueprint = buildSlideTemplateBlueprint({ messages: input.messages });
  const safeOverrides = asPlainRecord(input.overrides);
  const { templateBlueprint: templateBlueprintOverride, ...topLevelOverrides } = safeOverrides;
  const templateBlueprint = mergeSlideTemplateBlueprintOverride(baseBlueprint, templateBlueprintOverride);

  const normalizedSpec = slideTemplateSpecSchema.parse({
    artifactKind: "slide_template",
    changeSummary,
    description,
    examples: [exampleDeck],
    packageId,
    skillManifest,
    templateBlueprint,
    templateManifest,
    title,
    ...topLevelOverrides,
  });

  return slideTemplateSpecSchema.parse({
    ...normalizedSpec,
    examples: [buildSlideTemplateExampleDeck(normalizedSpec)],
  });
}

function buildReadme(spec: SlideTemplateAgentSpec) {
  const layoutList = spec.templateBlueprint.layouts.map((layout) => `- ${layout.id}: ${layout.purpose}`).join("\n");
  const slideTypeList = spec.templateBlueprint.slideTypes.map((slideType) => `- ${slideType.id}: ${slideType.purpose}`).join("\n");

  return `# ${spec.title}

Generated by SofLIA as a slide-template package.

## Contract

- Artifact kind: slide_template
- Skill: ${String(spec.skillManifest.id || "soflia-deck")}
- Template: ${String(spec.templateManifest.id || "soflia-deck-template")}
- Runtime: self-contained HTML deck
- Canvas: 1920x1080
- Charts: declarative JSON rendered as responsive inline SVG

## Template blueprint

### Slide types

${slideTypeList}

### Layouts

${layoutList}

### Editable tokens

- background: ${spec.templateBlueprint.designTokens.background}
- surface: ${spec.templateBlueprint.designTokens.surface}
- accent: ${spec.templateBlueprint.designTokens.accent}
- accent2: ${spec.templateBlueprint.designTokens.accent2}
- text: ${spec.templateBlueprint.designTokens.text}
- muted: ${spec.templateBlueprint.designTokens.muted}
- density: ${spec.templateBlueprint.modifiers.density}
- cornerRadius: ${spec.templateBlueprint.modifiers.cornerRadius}px

## Files

- skill/soflia-deck.skill.md
- manifests/soflia-deck.skill-manifest.json
- manifests/soflia-deck.template-manifest.json
- runtime/example.html
- schemas/soflia-deck.input-schema.json
- blueprints/template-blueprint.json
- examples/template-preview.deck.json
- examples/soflia-course-lesson.deck.json

This package is not a Remotion bundle and must not be registered as a Remotion template version.
`;
}

export async function buildSlideTemplatePackageZip(spec: SlideTemplateAgentSpec): Promise<{
  buffer: ArrayBuffer;
  hash: string;
  originalFileName: string;
  validationReport: {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    info: Record<string, unknown>;
  };
}> {
  const normalizedSpec = slideTemplateSpecSchema.parse(spec);
  const zip = new JSZip();
  const skillMarkdown = await readTemplateAsset("soflia-deck.skill.md");
  const exampleHtml = await readTemplateAsset("example.html");

  zip.file("skill/soflia-deck.skill.md", skillMarkdown);
  zip.file("runtime/example.html", exampleHtml);
  zip.file("manifests/soflia-deck.skill-manifest.json", JSON.stringify(normalizedSpec.skillManifest, null, 2));
  zip.file("manifests/soflia-deck.template-manifest.json", JSON.stringify(normalizedSpec.templateManifest, null, 2));
  zip.file("schemas/soflia-deck.input-schema.json", JSON.stringify(normalizedSpec.templateManifest.inputSchema, null, 2));
  zip.file("examples/soflia-course-lesson.deck.json", JSON.stringify(normalizedSpec.examples[0], null, 2));
  zip.file("examples/template-preview.deck.json", JSON.stringify(normalizedSpec.examples[0], null, 2));
  zip.file("blueprints/template-blueprint.json", JSON.stringify(normalizedSpec.templateBlueprint, null, 2));
  zip.file("package-spec.json", JSON.stringify(normalizedSpec, null, 2));
  zip.file("README.md", buildReadme(normalizedSpec));

  const buffer = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
  const hash = crypto.createHash("sha256").update(Buffer.from(buffer)).digest("hex");

  return {
    buffer,
    hash,
    originalFileName: `${normalizedSpec.packageId}.slide-template.zip`,
    validationReport: {
      errors: [],
      info: {
        artifactKind: "slide_template",
        exampleCount: normalizedSpec.examples.length,
        hash,
        layoutCount: normalizedSpec.templateBlueprint.layouts.length,
        skillId: normalizedSpec.skillManifest.id,
        slideTypeCount: normalizedSpec.templateBlueprint.slideTypes.length,
        templateId: normalizedSpec.templateManifest.id,
      },
      isValid: true,
      warnings: [],
    },
  };
}

export function parseSlideTemplateAgentSpec(value: unknown) {
  return slideTemplateSpecSchema.parse(value);
}
