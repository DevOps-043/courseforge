import { z } from "zod";

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);

export const sceneVisualPlanSchema = z.object({
  deckRevision: fingerprint,
  scriptHash: fingerprint,
  slides: z.array(z.object({
    key: fingerprint,
    label: z.string().max(500),
    weight: z.number().finite().min(0.1).max(100).default(1),
  }).strict()).max(30),
}).strict();
export type SceneVisualPlan = z.infer<typeof sceneVisualPlanSchema>;

export const compositionNarrativeSceneSchema = z.object({
  id: z.string().min(1).max(160),
  order: z.number().int().positive(),
  label: z.string().max(200),
  scriptText: z.string().max(100_000),
  scriptHash: fingerprint,
  needsReview: z.boolean(),
  visualPlan: sceneVisualPlanSchema.optional(),
  wordTimestamps: z.array(z.object({
    word: z.string().max(500), start: z.number().finite().min(0), end: z.number().finite().min(0),
  }).strict()).max(20_000).optional(),
}).strict();
export type CompositionNarrativeScene = z.infer<typeof compositionNarrativeSceneSchema>;

export interface SceneSlideOption { key: string; label: string; index: number; text: string }
export interface SceneVisualCatalog { deckRevision: string; slides: SceneSlideOption[] }
