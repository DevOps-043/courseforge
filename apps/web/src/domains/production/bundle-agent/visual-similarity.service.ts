import { type BundleVisualFingerprint } from "./design-plan.service";
import { z } from "zod";

export type BundleSimilarityDecision = "allow" | "review" | "block";

export interface BundleSimilarityComparison {
  score: number;
  matchingTraits: string[];
}

export const bundleSimilarityGuardResultSchema = z.object({
  version: z.literal(1),
  decision: z.enum(["allow", "review", "block"]),
  threshold: z.object({ review: z.number().min(0).max(1), block: z.number().min(0).max(1) }),
  highestScore: z.number().min(0).max(1),
  matchingTraits: z.array(z.string().min(1).max(120)).max(16),
  comparedFingerprintCount: z.number().int().min(0).max(500),
});

export type BundleSimilarityGuardResult = z.infer<typeof bundleSimilarityGuardResultSchema>;

export interface BundleSimilarityThresholds {
  review: number;
  block: number;
}

const DEFAULT_THRESHOLDS: BundleSimilarityThresholds = {
  review: 0.78,
  block: 0.995,
};

const TRAIT_WEIGHTS = {
  templateFamily: 0.20,
  layoutStrategy: 0.15,
  backgroundTreatment: 0.09,
  surfaceTreatment: 0.07,
  transition: 0.10,
  pace: 0.05,
  mediaPriority: 0.07,
  sceneStrategy: 0.06,
  timelineMode: 0.06,
  mainAsset: 0.03,
  mainLayout: 0.05,
  overlaySignature: 0.02,
  accentColor: 0.03,
  requiredAssets: 0.02,
} as const;

function roundScore(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 10_000) / 10_000;
}

function sameArray(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameTrait<T>(
  trait: string,
  weight: number,
  left: T,
  right: T,
  matches: string[],
) {
  if (left !== right) return 0;
  matches.push(trait);
  return weight;
}

/**
 * Compares visual semantics, not source text. It is deliberately deterministic
 * so an audit can explain why a draft was accepted, reviewed, or blocked.
 */
export function compareBundleVisualFingerprints(
  candidate: BundleVisualFingerprint,
  existing: BundleVisualFingerprint,
): BundleSimilarityComparison {
  const matchingTraits: string[] = [];
  let score = 0;

  score += sameTrait("familia visual", TRAIT_WEIGHTS.templateFamily, candidate.templateFamily, existing.templateFamily, matchingTraits);
  score += sameTrait("estrategia de layout", TRAIT_WEIGHTS.layoutStrategy, candidate.layoutStrategy, existing.layoutStrategy, matchingTraits);
  score += sameTrait("tratamiento de fondo", TRAIT_WEIGHTS.backgroundTreatment, candidate.backgroundTreatment, existing.backgroundTreatment, matchingTraits);
  score += sameTrait("tratamiento de superficie", TRAIT_WEIGHTS.surfaceTreatment, candidate.surfaceTreatment, existing.surfaceTreatment, matchingTraits);
  score += sameTrait("transición", TRAIT_WEIGHTS.transition, candidate.transition, existing.transition, matchingTraits);
  score += sameTrait("ritmo", TRAIT_WEIGHTS.pace, candidate.pace, existing.pace, matchingTraits);
  score += sameTrait("prioridad de media", TRAIT_WEIGHTS.mediaPriority, candidate.mediaPriority, existing.mediaPriority, matchingTraits);
  score += sameTrait("estrategia de escenas", TRAIT_WEIGHTS.sceneStrategy, candidate.sceneStrategy, existing.sceneStrategy, matchingTraits);
  score += sameTrait("modo temporal", TRAIT_WEIGHTS.timelineMode, candidate.timelineMode, existing.timelineMode, matchingTraits);
  score += sameTrait("asset principal", TRAIT_WEIGHTS.mainAsset, candidate.mainAsset, existing.mainAsset, matchingTraits);
  score += sameTrait("layout principal", TRAIT_WEIGHTS.mainLayout, candidate.mainLayout, existing.mainLayout, matchingTraits);
  score += sameTrait("overlay temporal", TRAIT_WEIGHTS.overlaySignature, candidate.overlaySignature, existing.overlaySignature, matchingTraits);
  score += sameTrait("color de acento", TRAIT_WEIGHTS.accentColor, candidate.accentColor, existing.accentColor, matchingTraits);

  if (sameArray(candidate.requiredAssets, existing.requiredAssets)) {
    score += TRAIT_WEIGHTS.requiredAssets;
    matchingTraits.push("assets requeridos");
  }

  return { score: roundScore(score), matchingTraits };
}

function normalizeThresholds(input?: Partial<BundleSimilarityThresholds>): BundleSimilarityThresholds {
  const review = input?.review ?? DEFAULT_THRESHOLDS.review;
  const block = input?.block ?? DEFAULT_THRESHOLDS.block;

  if (!Number.isFinite(review) || !Number.isFinite(block) || review < 0 || block > 1 || review >= block) {
    throw new Error("Los umbrales de similitud deben cumplir 0 <= review < block <= 1.");
  }

  return { review, block };
}

export function evaluateBundleVisualSimilarity(
  candidate: BundleVisualFingerprint,
  existingFingerprints: readonly BundleVisualFingerprint[],
  thresholds?: Partial<BundleSimilarityThresholds>,
): BundleSimilarityGuardResult {
  const threshold = normalizeThresholds(thresholds);
  let highest: BundleSimilarityComparison = { score: 0, matchingTraits: [] };

  for (const existing of existingFingerprints) {
    const comparison = compareBundleVisualFingerprints(candidate, existing);
    if (comparison.score > highest.score) highest = comparison;
  }

  const decision: BundleSimilarityDecision = highest.score >= threshold.block
    ? "block"
    : highest.score >= threshold.review
      ? "review"
      : "allow";

  return bundleSimilarityGuardResultSchema.parse({
    version: 1,
    decision,
    threshold,
    highestScore: highest.score,
    matchingTraits: highest.matchingTraits,
    comparedFingerprintCount: existingFingerprints.length,
  });
}
