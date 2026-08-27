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

export const courseSlideTypeSchema = z.string()
  .trim()
  .regex(/^[a-z][a-z0-9_]*$/)
  .min(2)
  .max(48);

export const courseSlideLayoutSchema = z.enum([
  "center",
  "closing",
  "data",
  "framework",
  "split",
  "split_reverse",
]);

export const courseDeckAppearanceSchema = z.enum(["light", "dark"]);

export const courseVisualAssetPurposeSchema = z.enum(["background", "supporting"]);

export const courseVisualAssetStatusSchema = z.enum([
  "NOT_NEEDED",
  "PLANNED",
  "GENERATING",
  "READY",
  "FAILED",
  "REJECTED",
]);

export const courseVisualAssetSlotSchema = z.object({
  id: z.string().trim().regex(/^[a-z][a-z0-9_]*$/).min(2).max(80),
  opacity: z.number().min(0).max(1).optional(),
  placement: z.enum(["background", "image_pane"]),
  purpose: courseVisualAssetPurposeSchema,
});

export const courseVisualAssetSchema = z.object({
  altText: z.string().max(240),
  checksum: z.string().max(128).optional(),
  failureReason: z.string().max(500).optional(),
  id: z.string().min(1).max(120),
  prompt: z.string().max(4000),
  promptHash: z.string().min(16).max(128),
  purpose: courseVisualAssetPurposeSchema,
  reason: z.string().max(360),
  slot: courseVisualAssetSlotSchema,
  sourceRefs: z.array(z.string().min(1).max(180)).max(8).default([]),
  status: courseVisualAssetStatusSchema,
  storagePath: z.string().max(500).optional(),
  url: z.string().url().max(2000).optional(),
});

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
  renderHints: z.object({
    layout: courseSlideLayoutSchema,
    purpose: z.string().max(240).optional(),
  }).optional(),
  speakerNotes: z.string().max(1800).optional(),
  subtitle: z.string().max(240).optional(),
  title: z.string().min(1).max(180),
  type: courseSlideTypeSchema,
  visualAssets: z.object({
    background: courseVisualAssetSchema.nullable().default(null),
    supporting: courseVisualAssetSchema.nullable().default(null),
  }).optional(),
  validationHints: z.object({
    learningObjectiveId: z.string().max(120).optional(),
    mustKeepClaims: z.array(z.string().min(1).max(240)).default([]),
    sourceRefs: z.array(z.string().min(1).max(120)).default([]),
    targetSlideCount: z.number().int().min(1).max(24).optional(),
  }).default({
    mustKeepClaims: [],
    sourceRefs: [],
  }),
});

export const courseDeckDesignSystemSchema = z.object({
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#2d7d6e"),
  accent2: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#d88a3a"),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  brandLabel: z.string().min(1).max(80).default("SofLIA - Engine"),
  fontPairing: z.enum(["system_sans", "editorial_serif", "technical_mono"]).optional(),
  muted: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  surface: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  text: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  tone: z.enum(["academic", "corporate", "editorial"]).default("academic"),
  visualSlots: z.record(
    courseSlideLayoutSchema,
    z.array(courseVisualAssetSlotSchema).max(4),
  ).optional(),
  visualStyleGuide: z.string().trim().max(600).optional(),
});

export const courseDeckSourceSnapshotSchema = z.object({
  componentType: z.string().min(1),
  source: z.enum(["component_content", "custom_request", "component_content_with_overrides"]),
  title: z.string().max(180).optional(),
});

export const courseDeckSpecSchema = z.object({
  appearance: courseDeckAppearanceSchema.default("light"),
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
  appearance: courseDeckAppearanceSchema.default("light"),
  customSlides: z.array(customSlideInputSchema).max(24).optional(),
  generateVisuals: z.boolean().optional(),
  locale: z.enum(["es", "en"]).default("es"),
  metadata: z.object({
    brandLabel: z.string().min(1).max(80).optional(),
    subtitle: z.string().max(240).optional(),
    title: z.string().max(180).optional(),
  }).optional(),
  template: courseDeckTemplateSchema.default("course-module"),
});

export type CourseChartSpec = z.infer<typeof courseChartSpecSchema>;
export type CourseDeckAppearance = z.infer<typeof courseDeckAppearanceSchema>;
export type CourseDeckSpec = z.infer<typeof courseDeckSpecSchema>;
export type CourseSlideSpec = z.infer<typeof courseSlideSpecSchema>;
export type CourseVisualAsset = z.infer<typeof courseVisualAssetSchema>;
export type CourseVisualAssetPurpose = z.infer<typeof courseVisualAssetPurposeSchema>;
export type CourseVisualAssetSlot = z.infer<typeof courseVisualAssetSlotSchema>;
type ParsedSlideDeckGenerateInput = z.infer<typeof slideDeckGenerateInputSchema>;

/** Input accepted by planning services before Zod applies request defaults. */
export type SlideDeckGenerateInput = Omit<ParsedSlideDeckGenerateInput, "appearance"> & {
  appearance?: CourseDeckAppearance;
};
