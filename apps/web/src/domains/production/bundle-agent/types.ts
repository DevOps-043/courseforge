import { z } from "zod";

export const bundleAgentMessageRoleSchema = z.enum(["USER", "ASSISTANT", "SYSTEM", "TOOL"]);
export const bundleAgentArtifactKindSchema = z.enum(["video_bundle", "slide_template"]);

/**
 * Families are intentionally finite. The model can choose a direction, but the
 * renderer only compiles it through one of these reviewed, safe visual systems.
 */
export const bundleTemplateFamilySchema = z.enum([
  "asymmetric-studio",
  "cinematic-field",
  "editorial-rail",
  "floating-collage",
  "minimal-focus",
  "reference-frame",
  "split-contrast",
  "stacked-evidence",
]);

export type BundleTemplateFamily = z.infer<typeof bundleTemplateFamilySchema>;

export const bundleAgentTransitionSchema = z.enum([
  "crossfade",
  "focus-shift",
  "hard-cut",
  "push-left",
  "push-right",
  "scene-swap",
  "soft-wipe",
]);

export type BundleAgentTransition = z.infer<typeof bundleAgentTransitionSchema>;

export const bundleAgentSceneLayoutSchema = z.enum([
  "fullscreen",
  "primary",
  "left-half",
  "right-half",
  "picture-in-picture",
]);

export const bundleAgentTimelinePlanSchema = z.object({
  version: z.literal(1),
  mode: z.enum(["continuous", "staged"]),
  opening: z.object({
    asset: z.literal("avatar"),
    durationFrames: z.number().int().min(1).max(900),
    layout: bundleAgentSceneLayoutSchema,
  }).nullable(),
  main: z.object({
    asset: z.enum(["avatar", "slides", "broll"]),
    layout: bundleAgentSceneLayoutSchema,
  }),
  ending: z.object({
    asset: z.literal("avatar"),
    durationFrames: z.number().int().min(1).max(900),
    layout: bundleAgentSceneLayoutSchema,
  }).nullable(),
  transition: bundleAgentTransitionSchema,
  overlays: z.array(z.object({
    asset: z.literal("broll"),
    layout: bundleAgentSceneLayoutSchema,
    during: z.literal("main"),
    slideSelection: z.enum(["all", "alternating", "explicit"]),
    slideIndexes: z.array(z.number().int().min(0).max(999)).max(100).default([]),
  })).max(4).default([]),
});

export type BundleAgentTimelinePlan = z.infer<typeof bundleAgentTimelinePlanSchema>;

export const BUNDLE_TEMPLATE_FAMILY_OPTIONS: ReadonlyArray<{
  id: BundleTemplateFamily;
  label: string;
  description: string;
}> = [
  { id: "asymmetric-studio", label: "Estudio asimetrico", description: "Avatar estable con soporte visual dominante." },
  { id: "cinematic-field", label: "Campo cinematografico", description: "Media a gran escala con overlays contenidos." },
  { id: "editorial-rail", label: "Riel editorial", description: "Jerarquia de lectura y soporte ordenado." },
  { id: "floating-collage", label: "Collage flotante", description: "Evidencias visuales en composicion modular." },
  { id: "minimal-focus", label: "Foco minimal", description: "Una idea visual por escena con poco ruido." },
  { id: "reference-frame", label: "Marco de referencia", description: "Respeta una estructura visual proporcionada." },
  { id: "split-contrast", label: "Contraste dividido", description: "Dos planos con contraste y cambio de foco." },
  { id: "stacked-evidence", label: "Evidencia apilada", description: "Slides y B-roll en lectura vertical." },
];

export const bundleAgentDesignPlanSchema = z.object({
  version: z.literal(1),
  templateFamily: bundleTemplateFamilySchema,
  layoutStrategy: z.enum(["asymmetric", "cinematic", "editorial", "collage", "minimal", "reference", "split", "stacked"]),
  backgroundTreatment: z.enum(["canvas", "frame", "grid", "halo", "paper", "spotlight", "split", "vignette"]),
  surfaceTreatment: z.enum(["flat", "framed", "glass", "paper", "shadowed"]),
  transition: bundleAgentTransitionSchema,
  pace: z.enum(["calm", "measured", "energetic"]),
  mediaPriority: z.enum(["avatar", "broll", "slides", "balanced"]),
  sceneStrategy: z.enum(["asset-led", "chapter-led", "dual-support", "single-focus"]),
  source: z.enum(["creative-brief", "explicit-family", "reference-constraint", "safe-fallback"]),
  rationale: z.array(z.string().trim().min(1).max(180)).min(2).max(6),
});

export type BundleAgentDesignPlan = z.infer<typeof bundleAgentDesignPlanSchema>;

export const BUNDLE_AGENT_VISUAL_REFERENCE_LIMIT = 6;

export const bundleAgentVisualReferenceSchema = z.object({
  id: z.string().trim().min(1).max(120),
  type: z.enum(["image", "video"]),
  fileName: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().min(1).max(120),
  sizeBytes: z.number().int().min(1).max(75 * 1024 * 1024),
  storagePath: z.string().trim().min(1).max(1000),
  publicUrl: z.string().trim().url().max(2000).optional(),
  note: z.string().trim().max(500).optional(),
  visualSummary: z.string().trim().max(1200).optional(),
});

export const bundleAgentMessageMetadataSchema = z.object({
  visualReferences: z
    .array(bundleAgentVisualReferenceSchema)
    .max(BUNDLE_AGENT_VISUAL_REFERENCE_LIMIT)
    .optional(),
});

const creativeVariantSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  composition: z.string().trim().min(1).max(240),
  palette: z.string().trim().min(1).max(240),
  motion: z.string().trim().min(1).max(240),
  emphasis: z.string().trim().min(1).max(240),
});

const defaultCreativeVariants = [
  {
    id: "variant-editorial-split",
    name: "Editorial split",
    composition: "Asymmetric canvas with a primary media zone and a compact narrative rail.",
    palette: "Dark neutral base, one saturated accent and restrained translucent surfaces.",
    motion: "Measured opacity cuts with brief progress accents.",
    emphasis: "Clear hierarchy for lesson title, support media and captions.",
  },
  {
    id: "variant-kinetic-overlay",
    name: "Kinetic overlay",
    composition: "Media-led frame with layered support visuals and compact text overlays.",
    palette: "High-contrast cinematic base with a bright accent pulse.",
    motion: "Fast support-visual swaps, short holds and overlay reveals.",
    emphasis: "Momentum, media presence and visual transitions.",
  },
  {
    id: "variant-stacked-studio",
    name: "Stacked studio",
    composition: "Avatar or host zone paired with vertically stacked learning assets.",
    palette: "Studio-dark base, soft panels and a single instructional accent.",
    motion: "Alternating focus between upper and lower support regions.",
    emphasis: "Instructor presence with parallel slide and B-roll context.",
  },
];

export const DEFAULT_BUNDLE_AGENT_CREATIVE_BRIEF = {
  directionName: "Structured Learning Studio",
  visualReferences: [
    "Digital product walkthrough with restrained motion.",
    "Editorial learning video with clear visual hierarchy.",
  ],
  layoutSystem: "Asymmetric educational layout with explicit zones for media, narration and support visuals.",
  motionLanguage: "Purposeful fades, cuts and timed emphasis without generic card fade-ins.",
  colorTokens: {
    paletteName: "SofLIA dark accent",
    background: "#05070B",
    surface: "#111827",
    accent: "#00D4B3",
    secondary: "#8B5CF6",
    text: "#F8FAFC",
    muted: "#CBD5E1",
  },
  typographyTokens: {
    display: "Condensed confident display",
    body: "Readable humanist sans",
    label: "Compact uppercase metadata",
  },
  similarityCheck: {
    avoidedPatterns: [
      "Centered title with subtitle below",
      "Single purple gradient background",
      "Generic fade-in cards",
    ],
    differentiators: [
      "Composition",
      "Motion rhythm",
      "Information hierarchy",
      "Use of media",
    ],
  },
  componentArchitecture: [
    "Root composition with typed props and design tokens",
    "Reusable media layer components for avatar, slides and B-roll",
    "Variant-aware layout resolver before rendering",
  ],
  visualVariants: defaultCreativeVariants,
};

export const bundleAgentCreativeBriefSchema = z.object({
  directionName: z.string().trim().min(1).max(120).default(DEFAULT_BUNDLE_AGENT_CREATIVE_BRIEF.directionName),
  visualReferences: z.array(z.string().trim().min(1).max(180)).min(2).max(8).default(DEFAULT_BUNDLE_AGENT_CREATIVE_BRIEF.visualReferences),
  layoutSystem: z.string().trim().min(1).max(500).default(DEFAULT_BUNDLE_AGENT_CREATIVE_BRIEF.layoutSystem),
  motionLanguage: z.string().trim().min(1).max(500).default(DEFAULT_BUNDLE_AGENT_CREATIVE_BRIEF.motionLanguage),
  colorTokens: z.object({
    paletteName: z.string().trim().min(1).max(80).default("SofLIA dark accent"),
    background: z.string().trim().regex(/^#[0-9A-F]{6}$/i).default("#05070B"),
    surface: z.string().trim().regex(/^#[0-9A-F]{6}$/i).default("#111827"),
    accent: z.string().trim().regex(/^#[0-9A-F]{6}$/i).default("#00D4B3"),
    secondary: z.string().trim().regex(/^#[0-9A-F]{6}$/i).default("#8B5CF6"),
    text: z.string().trim().regex(/^#[0-9A-F]{6}$/i).default("#F8FAFC"),
    muted: z.string().trim().regex(/^#[0-9A-F]{6}$/i).default("#CBD5E1"),
  }).default(DEFAULT_BUNDLE_AGENT_CREATIVE_BRIEF.colorTokens),
  typographyTokens: z.object({
    display: z.string().trim().min(1).max(120).default("Condensed confident display"),
    body: z.string().trim().min(1).max(120).default("Readable humanist sans"),
    label: z.string().trim().min(1).max(120).default("Compact uppercase metadata"),
  }).default(DEFAULT_BUNDLE_AGENT_CREATIVE_BRIEF.typographyTokens),
  similarityCheck: z.object({
    avoidedPatterns: z.array(z.string().trim().min(1).max(160)).min(3).max(8).default([
      "Centered title with subtitle below",
      "Single purple gradient background",
      "Generic fade-in cards",
    ]),
    differentiators: z.array(z.string().trim().min(1).max(160)).min(4).max(10).default([
      "Composition",
      "Motion rhythm",
      "Information hierarchy",
      "Use of media",
    ]),
  }).default(DEFAULT_BUNDLE_AGENT_CREATIVE_BRIEF.similarityCheck),
  componentArchitecture: z.array(z.string().trim().min(1).max(180)).min(3).max(10).default(DEFAULT_BUNDLE_AGENT_CREATIVE_BRIEF.componentArchitecture),
  visualVariants: z.array(creativeVariantSchema).min(3).max(6).default(defaultCreativeVariants),
});

export const bundleAgentSpecSchema = z.object({
  contractVersion: z.literal(2).optional(),
  artifactKind: bundleAgentArtifactKindSchema.default("video_bundle"),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(""),
  visualStyle: z.string().trim().min(1).max(240),
  /** Optional explicit family selected by the user or the AI creative direction. */
  templateFamily: bundleTemplateFamilySchema.optional(),
  creativeBrief: bundleAgentCreativeBriefSchema.default(DEFAULT_BUNDLE_AGENT_CREATIVE_BRIEF),
  /** Latest redacted author instruction. It is authoring metadata and is never rendered as visible copy. */
  authoringIntent: z.object({
    latestUserInstruction: z.string().trim().max(4000).default(""),
    conversationInstructions: z.string().trim().max(8000).default(""),
  }).optional(),
  /** Resolved deterministic plan used by the safe bundle compiler. */
  designPlan: bundleAgentDesignPlanSchema.optional(),
  /** Temporal asset choreography compiled independently from the static visual family. */
  timelinePlan: bundleAgentTimelinePlanSchema.optional(),
  compositionId: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  durationFrames: z.number().int().min(30).max(900).default(150),
  fps: z.number().int().min(12).max(60).default(30),
  width: z.number().int().min(320).max(3840).default(1920),
  height: z.number().int().min(240).max(2160).default(1080),
  requiredAssets: z.array(z.enum(["slides", "audio", "avatar", "broll", "captions"])).max(8).default(["slides"]),
  propsSchema: z
    .object({
      type: z.literal("object"),
      required: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
      properties: z.record(
        z.string(),
        z.object({
          type: z.enum(["string", "number", "integer", "boolean", "array", "object", "null"]),
          description: z.string().trim().max(240).optional(),
        }),
      ),
    })
    .default({
      type: "object",
      properties: {
        title: { type: "string", description: "Course or lesson title" },
      },
    }),
  defaultProps: z.record(z.string(), z.unknown()).default({ title: "SofLIA - Engine" }),
  changeSummary: z.string().trim().max(1000).default("Initial SofLIA generated bundle draft."),
});

export type BundleAgentMessageRole = z.infer<typeof bundleAgentMessageRoleSchema>;
export type BundleAgentArtifactKind = z.infer<typeof bundleAgentArtifactKindSchema>;
export type BundleAgentVisualReference = z.infer<typeof bundleAgentVisualReferenceSchema>;
export type BundleAgentMessageMetadata = z.infer<typeof bundleAgentMessageMetadataSchema>;
export type BundleAgentSpec = z.infer<typeof bundleAgentSpecSchema>;

export interface BundleAgentAuthContext {
  admin: any;
  organizationId: string;
  userId: string;
  platformRole?: string | null;
}

export interface BundleAgentConversation {
  id: string;
  organization_id: string;
  created_by: string | null;
  template_id: string | null;
  status: string;
  title: string;
  created_at: string;
  updated_at: string;
}
