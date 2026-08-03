import { z } from "zod";

export const COURSE_DECK_SCHEMA_VERSION = "course-deck-v1";
export const COURSE_DECK_WIDTH = 1920;
export const COURSE_DECK_HEIGHT = 1080;

export const courseDeckTemplateSchema = z.enum([
  "concept-lesson",
  "course-module",
  "data-explainer",
  "demo-guide",
]);

export const courseSlideTypeSchema = z.enum([
  "cover",
  "objectives",
  "concept",
  "worked_example",
  "exercise",
  "knowledge_check",
  "summary",
  "data_explainer",
  "diagram",
  "quote",
  "transition",
]);

export const chartPointSchema = z.object({
  label: z.string().min(1).max(80),
  value: z.number().finite(),
});

export const chartSeriesSchema = z.object({
  label: z.string().min(1).max(80),
  points: z.array(chartPointSchema).min(1).max(24),
});

const baseChartSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(140),
  subtitle: z.string().max(180).optional(),
  sourceRefs: z.array(z.string().min(1).max(120)).default([]),
  unit: z.string().max(32).optional(),
});

export const barChartSpecSchema = baseChartSchema.extend({
  type: z.literal("bar"),
  points: z.array(chartPointSchema).min(1).max(12),
});

export const lineChartSpecSchema = baseChartSchema.extend({
  type: z.literal("line"),
  series: z.array(chartSeriesSchema).min(1).max(4),
});

export const areaChartSpecSchema = baseChartSchema.extend({
  type: z.literal("area"),
  series: z.array(chartSeriesSchema).min(1).max(2),
});

export const proportionChartSpecSchema = baseChartSchema.extend({
  type: z.literal("proportion"),
  value: z.number().finite(),
  total: z.number().positive(),
  label: z.string().min(1).max(100),
});

export const courseChartSpecSchema = z.discriminatedUnion("type", [
  barChartSpecSchema,
  lineChartSpecSchema,
  areaChartSpecSchema,
  proportionChartSpecSchema,
]);

export const slideBodyBlockSchema = z.object({
  kind: z.enum(["paragraph", "bullets", "callout", "code"]),
  text: z.string().max(900).optional(),
  items: z.array(z.string().min(1).max(240)).max(8).optional(),
});

export const slideCitationSchema = z.object({
  label: z.string().min(1).max(120),
  sourceRef: z.string().min(1).max(180),
});

export const courseSlideSpecSchema = z.object({
  bodyBlocks: z.array(slideBodyBlockSchema).min(1).max(5),
  chart: courseChartSpecSchema.optional(),
  citations: z.array(slideCitationSchema).default([]),
  id: z.string().min(1).max(80),
  order: z.number().int().positive(),
  speakerNotes: z.string().max(1800).optional(),
  subtitle: z.string().max(240).optional(),
  title: z.string().min(1).max(180),
  type: courseSlideTypeSchema,
  validationHints: z.object({
    learningObjectiveId: z.string().max(120).optional(),
    mustKeepClaims: z.array(z.string().min(1).max(240)).default([]),
    sourceRefs: z.array(z.string().min(1).max(120)).default([]),
  }).default({
    mustKeepClaims: [],
    sourceRefs: [],
  }),
});

export const courseDeckDesignSystemSchema = z.object({
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#2d7d6e"),
  accent2: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#d88a3a"),
  brandLabel: z.string().min(1).max(80).default("SofLIA - Engine"),
  tone: z.enum(["academic", "corporate", "editorial"]).default("academic"),
});

export const courseDeckSourceSnapshotSchema = z.object({
  componentType: z.string().min(1),
  source: z.enum(["component_content", "custom_request", "component_content_with_overrides"]),
  title: z.string().max(180).optional(),
});

export const courseDeckSpecSchema = z.object({
  artifactId: z.string().min(1),
  designSystem: courseDeckDesignSystemSchema,
  format: z.literal("16:9"),
  height: z.literal(COURSE_DECK_HEIGHT),
  locale: z.enum(["es", "en"]),
  materialComponentId: z.string().min(1),
  schemaVersion: z.literal(COURSE_DECK_SCHEMA_VERSION),
  slides: z.array(courseSlideSpecSchema).min(1).max(24),
  sourceSnapshot: courseDeckSourceSnapshotSchema,
  template: courseDeckTemplateSchema,
  width: z.literal(COURSE_DECK_WIDTH),
});

export const customSlideInputSchema = z.object({
  bullets: z.array(z.string().min(1).max(240)).max(8).optional(),
  chart: courseChartSpecSchema.optional(),
  speakerNotes: z.string().max(1800).optional(),
  subtitle: z.string().max(240).optional(),
  title: z.string().min(1).max(180),
  type: courseSlideTypeSchema.optional(),
});

export const slideDeckGenerateInputSchema = z.object({
  customSlides: z.array(customSlideInputSchema).max(24).optional(),
  locale: z.enum(["es", "en"]).default("es"),
  metadata: z.object({
    brandLabel: z.string().min(1).max(80).optional(),
    subtitle: z.string().max(240).optional(),
    title: z.string().max(180).optional(),
  }).optional(),
  template: courseDeckTemplateSchema.default("course-module"),
});

export type CourseChartSpec = z.infer<typeof courseChartSpecSchema>;
export type CourseDeckSpec = z.infer<typeof courseDeckSpecSchema>;
export type CourseSlideSpec = z.infer<typeof courseSlideSpecSchema>;
export type SlideDeckGenerateInput = z.infer<typeof slideDeckGenerateInputSchema>;
