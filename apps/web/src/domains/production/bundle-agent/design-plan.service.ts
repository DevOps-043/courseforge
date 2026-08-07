import {
  bundleAgentDesignPlanSchema,
  bundleAgentSpecSchema,
  bundleTemplateFamilySchema,
  type BundleAgentDesignPlan,
  type BundleAgentSpec,
  type BundleTemplateFamily,
} from "./types";
import { z } from "zod";

export const bundleVisualFingerprintSchema = z.object({
  version: z.literal(1),
  templateFamily: bundleTemplateFamilySchema,
  layoutStrategy: z.enum(["asymmetric", "cinematic", "editorial", "collage", "minimal", "reference", "split", "stacked"]),
  backgroundTreatment: z.enum(["canvas", "frame", "grid", "halo", "paper", "spotlight", "split", "vignette"]),
  surfaceTreatment: z.enum(["flat", "framed", "glass", "paper", "shadowed"]),
  transition: z.enum(["crossfade", "focus-shift", "hard-cut", "scene-swap", "soft-wipe"]),
  pace: z.enum(["calm", "measured", "energetic"]),
  mediaPriority: z.enum(["avatar", "broll", "slides", "balanced"]),
  sceneStrategy: z.enum(["asset-led", "chapter-led", "dual-support", "single-focus"]),
  accentColor: z.string().regex(/^#[0-9A-F]{6}$/i),
  requiredAssets: z.array(z.enum(["slides", "audio", "avatar", "broll", "captions"])).max(8),
});

export type BundleVisualFingerprint = z.infer<typeof bundleVisualFingerprintSchema>;

interface FamilyDefinition {
  layoutStrategy: BundleAgentDesignPlan["layoutStrategy"];
  backgroundTreatment: BundleAgentDesignPlan["backgroundTreatment"];
  surfaceTreatment: BundleAgentDesignPlan["surfaceTreatment"];
  defaultTransition: BundleAgentDesignPlan["transition"];
  defaultPace: BundleAgentDesignPlan["pace"];
  mediaPriority: BundleAgentDesignPlan["mediaPriority"];
  sceneStrategy: BundleAgentDesignPlan["sceneStrategy"];
}

const FAMILY_DEFINITIONS: Record<BundleTemplateFamily, FamilyDefinition> = {
  "asymmetric-studio": {
    layoutStrategy: "asymmetric",
    backgroundTreatment: "canvas",
    surfaceTreatment: "shadowed",
    defaultTransition: "focus-shift",
    defaultPace: "measured",
    mediaPriority: "balanced",
    sceneStrategy: "dual-support",
  },
  "cinematic-field": {
    layoutStrategy: "cinematic",
    backgroundTreatment: "vignette",
    surfaceTreatment: "glass",
    defaultTransition: "hard-cut",
    defaultPace: "energetic",
    mediaPriority: "broll",
    sceneStrategy: "asset-led",
  },
  "editorial-rail": {
    layoutStrategy: "editorial",
    backgroundTreatment: "paper",
    surfaceTreatment: "paper",
    defaultTransition: "soft-wipe",
    defaultPace: "calm",
    mediaPriority: "slides",
    sceneStrategy: "chapter-led",
  },
  "floating-collage": {
    layoutStrategy: "collage",
    backgroundTreatment: "grid",
    surfaceTreatment: "glass",
    defaultTransition: "focus-shift",
    defaultPace: "energetic",
    mediaPriority: "balanced",
    sceneStrategy: "dual-support",
  },
  "minimal-focus": {
    layoutStrategy: "minimal",
    backgroundTreatment: "spotlight",
    surfaceTreatment: "flat",
    defaultTransition: "crossfade",
    defaultPace: "calm",
    mediaPriority: "slides",
    sceneStrategy: "single-focus",
  },
  "reference-frame": {
    layoutStrategy: "reference",
    backgroundTreatment: "frame",
    surfaceTreatment: "framed",
    defaultTransition: "scene-swap",
    defaultPace: "measured",
    mediaPriority: "balanced",
    sceneStrategy: "dual-support",
  },
  "split-contrast": {
    layoutStrategy: "split",
    backgroundTreatment: "split",
    surfaceTreatment: "flat",
    defaultTransition: "focus-shift",
    defaultPace: "measured",
    mediaPriority: "avatar",
    sceneStrategy: "chapter-led",
  },
  "stacked-evidence": {
    layoutStrategy: "stacked",
    backgroundTreatment: "halo",
    surfaceTreatment: "shadowed",
    defaultTransition: "soft-wipe",
    defaultPace: "measured",
    mediaPriority: "balanced",
    sceneStrategy: "dual-support",
  },
};

function getIntentText(spec: BundleAgentSpec) {
  return [
    spec.title,
    spec.description,
    spec.visualStyle,
    spec.changeSummary,
    spec.creativeBrief.directionName,
    spec.creativeBrief.layoutSystem,
    spec.creativeBrief.motionLanguage,
    ...spec.creativeBrief.visualVariants.flatMap((variant) => [
      variant.name,
      variant.composition,
      variant.palette,
      variant.motion,
      variant.emphasis,
    ]),
  ].join(" ").toLowerCase();
}

function includesAny(text: string, terms: readonly string[]) {
  return terms.some((term) => text.includes(term));
}

function isReferenceLayout(intent: string) {
  return includesAny(intent, [
    "reference wireframe",
    "wireframe de referencia",
    "reference frame",
    "estructura de referencia",
    "marco de referencia",
    "left half reserved for avatar",
  ]);
}

function resolveExplicitFamily(spec: BundleAgentSpec): BundleTemplateFamily | null {
  const requested = spec.templateFamily
    || (typeof spec.defaultProps.templateFamily === "string" ? spec.defaultProps.templateFamily : null)
    || spec.designPlan?.templateFamily;
  const parsed = bundleTemplateFamilySchema.safeParse(requested);
  return parsed.success ? parsed.data : null;
}

function inferTemplateFamily(spec: BundleAgentSpec, intent: string): BundleTemplateFamily {
  if (isReferenceLayout(intent)) return "reference-frame";
  if (includesAny(intent, ["cinematic", "cinematograf", "inmersivo", "full screen", "fullscreen", "pantalla completa"])) {
    return "cinematic-field";
  }
  if (includesAny(intent, ["collage", "mosaico", "mosaic", "floating", "flotante", "modular"])) {
    return "floating-collage";
  }
  if (includesAny(intent, ["vertical", "apilado", "stacked", "arriba y abajo", "upper and lower"])) {
    return "stacked-evidence";
  }
  if (includesAny(intent, ["editorial", "lectura", "reading rail", "periodico", "magazine"])) {
    return "editorial-rail";
  }
  if (includesAny(intent, ["contraste", "split", "dividido", "avatar a la derecha", "avatar del lado derecho"])) {
    return "split-contrast";
  }
  if (includesAny(intent, ["minimal", "minimalista", "sobrio", "limpio", "clean"]) || (!spec.requiredAssets.includes("avatar") && !spec.requiredAssets.includes("broll"))) {
    return "minimal-focus";
  }
  return "asymmetric-studio";
}

function inferPace(intent: string, fallback: BundleAgentDesignPlan["pace"]) {
  if (includesAny(intent, ["rapido", "rápido", "dinamico", "dinámico", "kinetic", "energetic"])) return "energetic" as const;
  if (includesAny(intent, ["calm", "calmo", "pausado", "sobrio", "suave", "soft"])) return "calm" as const;
  return fallback;
}

function inferTransition(spec: BundleAgentSpec, intent: string, fallback: BundleAgentDesignPlan["transition"]) {
  if (spec.defaultProps.sceneSwapOnSlideChange === true || includesAny(intent, ["scene swap", "intercambian lados", "left and right regions trade"])) {
    return "scene-swap" as const;
  }
  if (includesAny(intent, ["wipe", "barrido", "cortina"])) return "soft-wipe" as const;
  if (includesAny(intent, ["cut", "corte", "quick cuts"])) return "hard-cut" as const;
  if (includesAny(intent, ["focus", "enfoque", "focus shift"])) return "focus-shift" as const;
  if (includesAny(intent, ["fade", "fundido", "crossfade"])) return "crossfade" as const;
  return fallback;
}

function normalizeAccentColor(value: unknown) {
  return typeof value === "string" && /^#[0-9A-F]{6}$/i.test(value)
    ? value.toUpperCase()
    : "#5B21B6";
}

function buildRationale(spec: BundleAgentSpec, family: BundleTemplateFamily, source: BundleAgentDesignPlan["source"]) {
  const definition = FAMILY_DEFINITIONS[family];
  const assets = spec.requiredAssets.length > 0 ? spec.requiredAssets.join(", ") : "sin media requerida";
  const sourceReason = source === "explicit-family"
    ? "La familia visual fue seleccionada explícitamente por la persona autora."
    : source === "reference-constraint"
      ? "La referencia visual se trató como una restricción de composición."
      : "La familia se infirió de la dirección creativa y los requisitos funcionales.";

  return [
    sourceReason,
    `La estrategia ${definition.layoutStrategy} prioriza ${definition.mediaPriority} con assets: ${assets}.`,
    `El ritmo ${definition.defaultPace} y la transición ${definition.defaultTransition} se compilan mediante componentes seguros de Remotion.`,
  ];
}

/**
 * Resolves the visual design into a bounded plan. This is the hand-off between
 * creative direction and the deterministic, security-reviewed Remotion compiler.
 */
export function buildBundleDesignPlan(spec: BundleAgentSpec): BundleAgentDesignPlan {
  const explicitFamily = resolveExplicitFamily(spec);
  const intent = getIntentText(spec);
  const referenceConstraint = isReferenceLayout(intent);

  if (!explicitFamily && spec.designPlan) {
    return bundleAgentDesignPlanSchema.parse(spec.designPlan);
  }

  const templateFamily = explicitFamily || inferTemplateFamily(spec, intent);
  const definition = FAMILY_DEFINITIONS[templateFamily];
  const source: BundleAgentDesignPlan["source"] = explicitFamily
    ? "explicit-family"
    : referenceConstraint
      ? "reference-constraint"
      : intent.trim().length > 0
        ? "creative-brief"
        : "safe-fallback";

  return bundleAgentDesignPlanSchema.parse({
    version: 1,
    templateFamily,
    layoutStrategy: definition.layoutStrategy,
    backgroundTreatment: definition.backgroundTreatment,
    surfaceTreatment: definition.surfaceTreatment,
    transition: inferTransition(spec, intent, definition.defaultTransition),
    pace: inferPace(intent, definition.defaultPace),
    mediaPriority: definition.mediaPriority,
    sceneStrategy: definition.sceneStrategy,
    source,
    rationale: buildRationale(spec, templateFamily, source),
  });
}

export function createBundleVisualFingerprint(
  spec: BundleAgentSpec,
  designPlan = buildBundleDesignPlan(spec),
): BundleVisualFingerprint {
  return bundleVisualFingerprintSchema.parse({
    version: 1,
    templateFamily: designPlan.templateFamily,
    layoutStrategy: designPlan.layoutStrategy,
    backgroundTreatment: designPlan.backgroundTreatment,
    surfaceTreatment: designPlan.surfaceTreatment,
    transition: designPlan.transition,
    pace: designPlan.pace,
    mediaPriority: designPlan.mediaPriority,
    sceneStrategy: designPlan.sceneStrategy,
    accentColor: normalizeAccentColor(spec.defaultProps.accentColor || spec.creativeBrief.colorTokens.accent),
    requiredAssets: [...spec.requiredAssets].sort(),
  });
}

/** Ensures every persisted and compiled video spec has an auditable resolved plan. */
export function attachBundleDesignPlan(spec: BundleAgentSpec): BundleAgentSpec {
  const designPlan = buildBundleDesignPlan(spec);
  const selectedVariant = spec.creativeBrief.visualVariants.find((variant) => variant.id === spec.defaultProps.visualVariantId)
    || spec.creativeBrief.visualVariants[0];

  return bundleAgentSpecSchema.parse({
    ...spec,
    templateFamily: designPlan.templateFamily,
    designPlan,
    propsSchema: {
      ...spec.propsSchema,
      type: "object" as const,
      properties: {
        ...(spec.propsSchema.properties || {}),
        templateFamily: {
          type: "string",
          description: "Familia visual segura resuelta por el Bundle Agent.",
        },
      },
    },
    defaultProps: {
      ...spec.defaultProps,
      templateFamily: designPlan.templateFamily,
      animationVariant: designPlan.transition,
      visualVariantId: typeof spec.defaultProps.visualVariantId === "string"
        ? spec.defaultProps.visualVariantId
        : selectedVariant?.id,
    },
  });
}
