import { z } from "zod";
import { COMPOSITION_EVENT_PLAN_MAX_CHECKPOINTS, COMPOSITION_EVENT_PLAN_MAX_BATCHES } from "../composition-conformance-batch-contract";
import { COMPOSITION_SSIM_POLICY } from "../composition-visual-metrics-policy";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../composition-text-parity-policy";
import { DECK_TEXT_PLAN_POLICY } from "../composition-deck-text-plan";
import { compositionConformanceThresholdsSchema, type CompositionConformanceContract, type CompositionConformanceReport } from "../composition-preview-render-conformance";

const checkpoints = z.number().int().nonnegative().max(COMPOSITION_EVENT_PLAN_MAX_CHECKPOINTS);
const expectedRegions = z.number().int().nonnegative().max(COMPOSITION_TEXT_PARITY_POLICY.maximumRegionsPerCapture * COMPOSITION_EVENT_PLAN_MAX_BATCHES);
const checkedRegions = z.number().int().nonnegative().max(COMPOSITION_TEXT_PARITY_POLICY.maximumRegions * COMPOSITION_EVENT_PLAN_MAX_CHECKPOINTS);
const deckRegions = z.number().int().nonnegative().max(COMPOSITION_TEXT_PARITY_POLICY.maximumRegions * COMPOSITION_EVENT_PLAN_MAX_CHECKPOINTS);
export const eventVisualMetricsSchema = z.object({
  scope: z.literal("NATIVE_EVENT_VISUAL_METRICS_NOT_FULL_RENDER_ATTESTATION"),
  thresholds: compositionConformanceThresholdsSchema,
  requiredCheckpointCount: checkpoints, checkedCheckpointCount: checkpoints,
  observed: z.object({maxMeanAbsoluteError: z.number().finite().nonnegative().nullable(),
    maxMismatchedPixelRatio: z.number().finite().min(0).max(1).nullable(),
    maxTemporalDriftFrames: z.number().finite().nonnegative().nullable(), minPsnrDb: z.number().finite().nullable()}).strict(),
  ssim: z.object({policy: z.literal(COMPOSITION_SSIM_POLICY.id), minimumRequired: z.number().finite().min(0).max(1),
    minimumObserved: z.number().finite().min(-1).max(1).nullable(), checkedCheckpointCount: checkpoints}).strict(),
  textParity: z.object({policy: z.literal(COMPOSITION_TEXT_PARITY_POLICY.id), scope: z.literal("NATIVE_TEXT_AND_CAPTIONS"),
    status: z.enum(["PASS", "FAIL", "INCOMPLETE"]), requiredCheckpointCount: checkpoints, checkedCheckpointCount: checkpoints,
    expectedRegionCount: expectedRegions, checkedRegionCount: checkedRegions}).strict(),
  deckText: z.object({policy: z.literal(DECK_TEXT_PLAN_POLICY), scope: z.literal("DECK_SOURCE_TEXT_REGIONS_NOT_RENDER_FONT_ATTESTATION"),
    status: z.enum(["PASS", "FAIL", "INCOMPLETE"]), requiredCheckpointCount: checkpoints, checkedCheckpointCount: checkpoints,
    expectedRegionCount: deckRegions, checkedRegionCount: deckRegions}).strict().optional(),
}).strict().superRefine((metrics, context) => {
  const text = metrics.textParity, deck = metrics.deckText;
  if (metrics.checkedCheckpointCount > metrics.requiredCheckpointCount || metrics.ssim.checkedCheckpointCount > metrics.checkedCheckpointCount
    || text.requiredCheckpointCount !== metrics.requiredCheckpointCount || text.checkedCheckpointCount > metrics.checkedCheckpointCount
    || text.status === "PASS" && (text.checkedCheckpointCount !== text.requiredCheckpointCount || text.checkedRegionCount !== text.expectedRegionCount)
    || deck && (deck.requiredCheckpointCount !== metrics.requiredCheckpointCount || deck.checkedCheckpointCount > metrics.checkedCheckpointCount
      || deck.checkedRegionCount > deck.expectedRegionCount
      || deck.status === "PASS" && (deck.checkedCheckpointCount !== deck.requiredCheckpointCount
        || deck.checkedRegionCount !== deck.expectedRegionCount))
    || (metrics.ssim.checkedCheckpointCount === 0) !== (metrics.ssim.minimumObserved === null)
    || Object.values(metrics.observed).some((value) => (metrics.checkedCheckpointCount === 0) !== (value === null))) {
    context.addIssue({code: "custom", message: "CONFORMANCE_EVENT_VISUAL_METRICS_INVALID"});
  }
});
export type EventVisualMetrics = z.infer<typeof eventVisualMetricsSchema>;

/** Uses independently evaluated contract/sample results, not asserted packet verdicts. */
export function eventVisualMetricsFromReport(report: CompositionConformanceReport, contract: CompositionConformanceContract): EventVisualMetrics {
  if (!report.ssim || !report.textParity) throw new Error("CONFORMANCE_EVENT_VISUAL_METRICS_MISSING");
  return eventVisualMetricsSchema.parse({scope: "NATIVE_EVENT_VISUAL_METRICS_NOT_FULL_RENDER_ATTESTATION",
    thresholds: contract.thresholds,
    requiredCheckpointCount: report.requiredCheckpointCount, checkedCheckpointCount: report.checkedCheckpointCount,
    observed: report.observed, ssim: report.ssim, textParity: report.textParity,
    ...(report.deckText ? {deckText: report.deckText} : {})});
}

/** Sum coverage, retain worst metrics; never average away an isolated failing frame. */
export function aggregateEventVisualMetrics(partitions: readonly EventVisualMetrics[]): EventVisualMetrics {
  if (!partitions.length || partitions.length > COMPOSITION_EVENT_PLAN_MAX_BATCHES) throw new Error("CONFORMANCE_EVENT_VISUAL_METRICS_PARTITIONS_INVALID");
  const metrics = partitions.map((partition) => eventVisualMetricsSchema.parse(partition));
  const first = metrics[0]!;
  if (metrics.some((partition) => partition.ssim.minimumRequired !== first.ssim.minimumRequired
    || JSON.stringify(partition.thresholds) !== JSON.stringify(first.thresholds)
    || Boolean(partition.deckText) !== Boolean(first.deckText)))
    throw new Error("CONFORMANCE_EVENT_VISUAL_METRICS_POLICY_MISMATCH");
  const sum = (select: (partition: EventVisualMetrics) => number) => metrics.reduce((count, partition) => count + select(partition), 0);
  const extreme = (select: (partition: EventVisualMetrics) => number | null, mode: "MIN" | "MAX") => {
    const values = metrics.map(select).filter((value): value is number => value !== null);
    return values.length ? (mode === "MIN" ? Math.min(...values) : Math.max(...values)) : null;
  };
  return eventVisualMetricsSchema.parse({scope: first.scope,
    thresholds: first.thresholds,
    requiredCheckpointCount: sum((partition) => partition.requiredCheckpointCount), checkedCheckpointCount: sum((partition) => partition.checkedCheckpointCount),
    observed: {maxMeanAbsoluteError: extreme((partition) => partition.observed.maxMeanAbsoluteError, "MAX"),
      maxMismatchedPixelRatio: extreme((partition) => partition.observed.maxMismatchedPixelRatio, "MAX"),
      maxTemporalDriftFrames: extreme((partition) => partition.observed.maxTemporalDriftFrames, "MAX"),
      minPsnrDb: extreme((partition) => partition.observed.minPsnrDb, "MIN")},
    ssim: {...first.ssim, checkedCheckpointCount: sum((partition) => partition.ssim.checkedCheckpointCount),
      minimumObserved: extreme((partition) => partition.ssim.minimumObserved, "MIN")},
    textParity: {...first.textParity, status: metrics.some((partition) => partition.textParity.status === "FAIL") ? "FAIL"
      : metrics.some((partition) => partition.textParity.status !== "PASS") ? "INCOMPLETE" : "PASS",
      requiredCheckpointCount: sum((partition) => partition.textParity.requiredCheckpointCount),
      checkedCheckpointCount: sum((partition) => partition.textParity.checkedCheckpointCount),
      expectedRegionCount: sum((partition) => partition.textParity.expectedRegionCount), checkedRegionCount: sum((partition) => partition.textParity.checkedRegionCount)},
    ...(first.deckText ? {deckText: {...first.deckText,
      status: metrics.some((partition) => partition.deckText!.status === "FAIL") ? "FAIL"
        : metrics.some((partition) => partition.deckText!.status !== "PASS") ? "INCOMPLETE" : "PASS",
      requiredCheckpointCount: sum((partition) => partition.deckText!.requiredCheckpointCount),
      checkedCheckpointCount: sum((partition) => partition.deckText!.checkedCheckpointCount),
      expectedRegionCount: sum((partition) => partition.deckText!.expectedRegionCount),
      checkedRegionCount: sum((partition) => partition.deckText!.checkedRegionCount)}} : {}),
  });
}
