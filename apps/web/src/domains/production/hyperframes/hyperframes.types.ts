import { z } from "zod";
import { HYPERFRAMES_RENDER_PROFILE_IDS } from "./hyperframes-render-profiles";
import { ANIMATED_DECK_APPEARANCES } from "../animated-deck/animated-deck-appearance.service";

export const HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES = 200 * 1024 * 1024;
export const HYPERFRAMES_REMOTE_VIDEO_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
export const HYPERFRAMES_COMPOSITION_FORMAT = "hyperframes-html-v1";

export const HYPERFRAMES_ASSET_DELIVERY_MODES = {
  EMBEDDED: "EMBEDDED",
  REMOTE_VARIABLES: "REMOTE_VARIABLES",
} as const;
export const hyperframesAssetDeliveryModeSchema = z.enum([
  HYPERFRAMES_ASSET_DELIVERY_MODES.EMBEDDED,
  HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES,
]);

const safeStoragePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .refine(
    (path) => !path.includes("\\") && !path.includes("..") && !path.startsWith("/"),
    "La ruta de storage del asset no es segura.",
  );

export const hyperframesCompositionModeSchema = z.enum([
  "AGENT_ASSISTED",
  "AUTOMATIC",
]);

export const hyperframesCompositionStatusSchema = z.enum([
  "DRAFT",
  "READY_FOR_PREVIEW",
  "READY_FOR_RENDER",
  "ARCHIVED",
]);

export const hyperframesAssetManifestItemSchema = z
  .object({
    checksum: z.string().regex(/^[a-f0-9]{64}$/i, "Checksum SHA-256 invalido."),
    fileSizeBytes: z.number().int().positive().max(HYPERFRAMES_REMOTE_VIDEO_LIMIT_BYTES),
    mimeType: z
      .string()
      .trim()
      .regex(/^(audio|font|image|video)\/[a-z0-9.+-]+$/i, "MIME no compatible con HyperFrames."),
    productionAssetId: z.string().uuid(),
    storageBucket: z.string().trim().min(1).max(100).optional(),
    storagePath: safeStoragePathSchema,
  })
  .strict();

export const hyperframesAssetManifestSchema = z
  .array(hyperframesAssetManifestItemSchema)
  .max(250, "La composición excede el máximo de assets permitidos.");

export const hyperframesAnimatedDeckSourceSchema = z.object({
  /** Optional only for decks persisted before appearance-aware composition. */
  appearance: z.enum(ANIMATED_DECK_APPEARANCES).optional(),
  css: z.string().max(200_000),
  fonts: z.array(z.object({ family: z.string().min(1).max(160), href: z.string().url() })).max(32),
  height: z.number().int().min(1).max(8_192),
  slides: z.array(z.object({
    animationCount: z.number().int().min(0).max(500),
    classes: z.string().min(1).max(2_000),
    html: z.string().min(1).max(100_000),
    index: z.number().int().min(0).max(1_000),
    label: z.string().max(500),
  })).min(1).max(250),
  width: z.number().int().min(1).max(8_192),
}).strict();

export const hyperframesRenderProfileSchema = z.object({
  format: z.literal("mp4").default("mp4"),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]),
  id: z.enum(HYPERFRAMES_RENDER_PROFILE_IDS).optional(),
  quality: z.enum(["draft", "standard", "high"]),
  resolution: z.literal("1080p").default("1080p"),
}).strict();

/** Persisted alongside a revision so render preflight can be reproduced. */
export const hyperframesRevisionManifestSchema = z
  .object({
    asset_delivery_mode: hyperframesAssetDeliveryModeSchema.optional(),
    asset_manifest: hyperframesAssetManifestSchema,
    canvas_duration_seconds: z.number().positive().max(24 * 60 * 60).optional(),
    render_profile: hyperframesRenderProfileSchema.optional(),
  })
  .passthrough();

export const hyperframesCompositionRevisionInputSchema = z
  .object({
    assetManifest: hyperframesAssetManifestSchema,
    compositionId: z.string().uuid(),
    entryPoint: safeStoragePathSchema.refine(
      (path) => path.endsWith(".html"),
      "El entry point de HyperFrames debe ser HTML.",
    ),
    generationMode: hyperframesCompositionModeSchema,
    projectHash: z.string().regex(/^[a-f0-9]{64}$/i),
    projectArchiveSizeBytes: z
      .number()
      .int()
      .positive()
      .max(HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES),
    projectStoragePath: safeStoragePathSchema,
    variables: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export type HyperframesAssetManifestItem = z.infer<
  typeof hyperframesAssetManifestItemSchema
>;
export type HyperframesAssetDeliveryMode = z.infer<typeof hyperframesAssetDeliveryModeSchema>;
export type HyperframesAnimatedDeckSource = z.infer<typeof hyperframesAnimatedDeckSourceSchema>;
export type HyperframesCompositionMode = z.infer<typeof hyperframesCompositionModeSchema>;
export type HyperframesRevisionManifest = z.infer<typeof hyperframesRevisionManifestSchema>;
export type HyperframesCompositionRevisionInput = z.infer<
  typeof hyperframesCompositionRevisionInputSchema
>;
