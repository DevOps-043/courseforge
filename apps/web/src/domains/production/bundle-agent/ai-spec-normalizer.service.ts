import {
  bundleAgentCreativeBriefSchema,
  bundleAgentSpecSchema,
  bundleAgentTimelinePlanSchema,
  bundleTemplateFamilySchema,
  type BundleAgentSpec,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== "string") return fallback;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return fallback;
  if (compact.length <= maxLength) return compact;

  const candidate = compact.slice(0, maxLength + 1);
  const lastBoundary = Math.max(candidate.lastIndexOf(". "), candidate.lastIndexOf("; "), candidate.lastIndexOf(" "));
  return candidate.slice(0, lastBoundary >= Math.floor(maxLength * 0.7) ? lastBoundary : maxLength).trim();
}

function boundedStringArray(value: unknown, fallback: string[], min: number, max: number, itemMax: number) {
  const normalized = Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => boundedText(item, "", itemMax))
        .filter(Boolean)
        .slice(0, max)
    : [];

  return normalized.length >= min ? normalized : fallback.slice(0, max);
}

function safeHexColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9A-F]{6}$/i.test(value.trim())
    ? value.trim().toUpperCase()
    : fallback;
}

function normalizeCreativeBrief(candidate: unknown, fallback: BundleAgentSpec["creativeBrief"]) {
  if (!isRecord(candidate)) return fallback;
  const colorTokens = isRecord(candidate.colorTokens) ? candidate.colorTokens : {};
  const typographyTokens = isRecord(candidate.typographyTokens) ? candidate.typographyTokens : {};
  const similarityCheck = isRecord(candidate.similarityCheck) ? candidate.similarityCheck : {};
  const rawVariants = Array.isArray(candidate.visualVariants) ? candidate.visualVariants : [];
  const visualVariants = rawVariants
    .filter(isRecord)
    .map((variant, index) => ({
      id: boundedText(variant.id, `variant-${index + 1}`, 80),
      name: boundedText(variant.name, `Variant ${index + 1}`, 120),
      composition: boundedText(variant.composition, fallback.visualVariants[index]?.composition || "Bounded media composition.", 240),
      palette: boundedText(variant.palette, fallback.visualVariants[index]?.palette || "Semantic design tokens.", 240),
      motion: boundedText(variant.motion, fallback.visualVariants[index]?.motion || "Measured transition rhythm.", 240),
      emphasis: boundedText(variant.emphasis, fallback.visualVariants[index]?.emphasis || "Clear learning hierarchy.", 240),
    }))
    .slice(0, 6);

  const normalized = {
    directionName: boundedText(candidate.directionName, fallback.directionName, 120),
    visualReferences: boundedStringArray(candidate.visualReferences, fallback.visualReferences, 2, 8, 180),
    layoutSystem: boundedText(candidate.layoutSystem, fallback.layoutSystem, 500),
    motionLanguage: boundedText(candidate.motionLanguage, fallback.motionLanguage, 500),
    colorTokens: {
      paletteName: boundedText(colorTokens.paletteName, fallback.colorTokens.paletteName, 80),
      background: safeHexColor(colorTokens.background, fallback.colorTokens.background),
      surface: safeHexColor(colorTokens.surface, fallback.colorTokens.surface),
      accent: safeHexColor(colorTokens.accent, fallback.colorTokens.accent),
      secondary: safeHexColor(colorTokens.secondary, fallback.colorTokens.secondary),
      text: safeHexColor(colorTokens.text, fallback.colorTokens.text),
      muted: safeHexColor(colorTokens.muted, fallback.colorTokens.muted),
    },
    typographyTokens: {
      ...fallback.typographyTokens,
      ...typographyTokens,
    },
    similarityCheck: {
      avoidedPatterns: boundedStringArray(similarityCheck.avoidedPatterns, fallback.similarityCheck.avoidedPatterns, 3, 8, 160),
      differentiators: boundedStringArray(similarityCheck.differentiators, fallback.similarityCheck.differentiators, 4, 10, 160),
    },
    componentArchitecture: boundedStringArray(candidate.componentArchitecture, fallback.componentArchitecture, 3, 10, 180),
    visualVariants: visualVariants.length >= 3 ? visualVariants : fallback.visualVariants,
  };

  const parsed = bundleAgentCreativeBriefSchema.safeParse(normalized);
  return parsed.success ? parsed.data : fallback;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

/**
 * Repairs bounded structural defects from model output without inventing new
 * creative intent. Invalid or missing fields fall back to the deterministic spec.
 */
export function normalizeGeneratedBundleSpec(candidate: unknown, fallback: BundleAgentSpec): BundleAgentSpec {
  if (!isRecord(candidate)) return fallback;
  const family = bundleTemplateFamilySchema.safeParse(candidate.templateFamily);
  const timelinePlan = bundleAgentTimelinePlanSchema.safeParse(candidate.timelinePlan);
  const propsSchema = bundleAgentSpecSchema.shape.propsSchema.safeParse(candidate.propsSchema);
  const defaultProps = isRecord(candidate.defaultProps)
    ? { ...fallback.defaultProps, ...candidate.defaultProps }
    : fallback.defaultProps;
  const requiredAssets = Array.isArray(candidate.requiredAssets)
    ? Array.from(new Set(candidate.requiredAssets.filter((asset): asset is BundleAgentSpec["requiredAssets"][number] =>
        typeof asset === "string" && ["slides", "audio", "avatar", "broll", "captions"].includes(asset),
      ))).slice(0, 8)
    : fallback.requiredAssets;

  return bundleAgentSpecSchema.parse({
    ...fallback,
    title: boundedText(candidate.title, fallback.title, 120),
    description: boundedText(candidate.description, fallback.description, 1000),
    visualStyle: boundedText(candidate.visualStyle, fallback.visualStyle, 240),
    ...(family.success ? { templateFamily: family.data } : {}),
    creativeBrief: normalizeCreativeBrief(candidate.creativeBrief, fallback.creativeBrief),
    authoringIntent: fallback.authoringIntent,
    timelinePlan: timelinePlan.success ? timelinePlan.data : fallback.timelinePlan,
    compositionId: typeof candidate.compositionId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(candidate.compositionId)
      ? candidate.compositionId
      : fallback.compositionId,
    durationFrames: boundedInteger(candidate.durationFrames, fallback.durationFrames, 30, 900),
    fps: boundedInteger(candidate.fps, fallback.fps, 12, 60),
    width: boundedInteger(candidate.width, fallback.width, 320, 3840),
    height: boundedInteger(candidate.height, fallback.height, 240, 2160),
    requiredAssets: requiredAssets.length > 0 ? requiredAssets : fallback.requiredAssets,
    propsSchema: propsSchema.success ? propsSchema.data : fallback.propsSchema,
    defaultProps,
    changeSummary: boundedText(candidate.changeSummary, fallback.changeSummary, 1000),
  });
}
