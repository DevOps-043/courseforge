import { z } from "zod";
import type { CompositionConformanceReport } from "../composition-preview-render-conformance";
import { compositionConformanceIncompleteReasonsSchema } from "../composition-conformance-incompleteness";
import { COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS } from "../composition-conformance-checkpoint-policy";
import { COMPOSITION_EVENT_PLAN_MAX_BATCHES, COMPOSITION_EVENT_PLAN_MAX_CHECKPOINTS } from "../composition-conformance-batch-contract";
import { eventDiagnosticLocationSchema } from "./composition-event-diagnostic-location";

export const EVENT_DIAGNOSTIC_MAX_BATCHES = 16;
const metricSchema = z.enum(["preview_document_hash", "render_document_hash", "invalid_sample", "duplicate_sample",
  "frame_dimensions", "ssim", "text_parity", "mismatched_pixel_ratio", "mean_absolute_error", "psnr_db",
  "temporal_drift_frames", "encoded_color_tags"]);
export const eventBatchDiagnosticSchema = z.object({
  batchIndex: z.number().int().nonnegative().max(COMPOSITION_EVENT_PLAN_MAX_BATCHES - 1),
  packetSha256: z.string().regex(/^[a-f0-9]{64}$/),
  failureCount: z.number().int().nonnegative().max(COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS * metricSchema.options.length + 2),
  firstFailure: z.object({metric: metricSchema, frameIndex: z.number().int().nonnegative().max(COMPOSITION_EVENT_PLAN_MAX_CHECKPOINTS - 1).optional()}).strict().optional(),
  location: eventDiagnosticLocationSchema.optional(),
  incompleteReasons: compositionConformanceIncompleteReasonsSchema,
}).strict().superRefine((diagnostic, context) => {
  if ((diagnostic.failureCount > 0) !== Boolean(diagnostic.firstFailure)
    || diagnostic.incompleteReasons.includes("EVENT_PARTITION_COVERAGE")
    || diagnostic.failureCount === 0 && diagnostic.incompleteReasons.length === 0
    || diagnostic.location && diagnostic.location.frameIndex !== diagnostic.firstFailure?.frameIndex) {
    context.addIssue({code: "custom", message: "CONFORMANCE_EVENT_DIAGNOSTIC_INVALID"});
  }
});
export const eventExecutionDiagnosticsSchema = z.object({
  scope: z.literal("FIRST_AFFECTED_PARTITIONS_NOT_COMPLETE_FAILURE_LIST"),
  affectedBatchCount: z.number().int().nonnegative().max(COMPOSITION_EVENT_PLAN_MAX_BATCHES),
  omittedBatchCount: z.number().int().nonnegative().max(COMPOSITION_EVENT_PLAN_MAX_BATCHES),
  batches: z.array(eventBatchDiagnosticSchema).max(EVENT_DIAGNOSTIC_MAX_BATCHES),
}).strict().superRefine((diagnostics, context) => {
  if (diagnostics.affectedBatchCount !== diagnostics.omittedBatchCount + diagnostics.batches.length
    || diagnostics.batches.length !== Math.min(EVENT_DIAGNOSTIC_MAX_BATCHES, diagnostics.affectedBatchCount)
    || diagnostics.batches.some((batch, index) => index > 0 && batch.batchIndex <= diagnostics.batches[index - 1]!.batchIndex)) {
    context.addIssue({code: "custom", message: "CONFORMANCE_EVENT_DIAGNOSTIC_COVERAGE_INVALID"});
  }
});
export type EventBatchDiagnostic = z.infer<typeof eventBatchDiagnosticSchema>;

/** Redacts messages entirely; only fixed metric/reason codes and frame identity survive. */
export function buildEventBatchDiagnostic(report: CompositionConformanceReport, batchIndex: number, packetSha256: string,
  locate?: (frameIndex: number) => z.infer<typeof eventDiagnosticLocationSchema>): EventBatchDiagnostic {
  const first = report.failures[0];
  return eventBatchDiagnosticSchema.parse({batchIndex, packetSha256, failureCount: report.failures.length,
    ...(first ? {firstFailure: {metric: first.metric, ...(first.frameIndex === undefined ? {} : {frameIndex: first.frameIndex})}} : {}),
    ...(first?.frameIndex !== undefined && locate ? {location: locate(first.frameIndex)} : {}),
    incompleteReasons: (report.incompletenessReasons ?? []).filter((reason) => reason !== "EVENT_PARTITION_COVERAGE")});
}
