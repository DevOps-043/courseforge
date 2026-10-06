import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { compositionConformanceIncompleteReasonSchema, compositionConformanceIncompleteReasonsSchema } from "../composition-conformance-incompleteness";
import type { CompositionConformanceReport } from "../composition-preview-render-conformance";
import { eventBatchExecutionSummarySchema } from "./composition-conformance-event-batch-execution";

const blockReasonSchema = z.union([compositionConformanceIncompleteReasonSchema, z.enum([
  "ROOT_EVIDENCE_MISSING", "ROOT_MEASUREMENT_INCONSISTENT", "LEGACY_INCOMPLETENESS_UNEXPLAINED",
  "AGGREGATE_COVERAGE_INCOMPLETE", "AGGREGATE_GATE_FAILED", "ROOT_GATE_FAILED",
  "AGGREGATE_METRICS_MISSING", "AGGREGATE_METRIC_POLICY_MISMATCH",
])]);
export const eventVisualCoverageGateSchema = z.object({
  policy: z.literal("EVENT_VISUAL_COVERAGE_DIAGNOSTIC_V1"),
  scope: z.literal("VISUAL_SAMPLE_GATES_NOT_AUDIO_ENVIRONMENT_OR_RENDER_ATTESTATION"),
  status: z.enum(["PASS", "FAIL", "INCOMPLETE"]), blockedReasons: z.array(blockReasonSchema).max(blockReasonSchema.options.reduce((count, option) => count + option.options.length, 0)),
}).strict().superRefine((gate, context) => {
  if (new Set(gate.blockedReasons).size !== gate.blockedReasons.length || (gate.status === "PASS") !== (gate.blockedReasons.length === 0)) {
    context.addIssue({code: "custom", message: "CONFORMANCE_EVENT_VISUAL_GATE_INVALID"});
  }
});

/** Resolves partition-only incompleteness; it does not certify the global exported render. */
export function evaluateEventVisualCoverageGate(input: {
  root?: Pick<CompositionConformanceReport, "status" | "incompletenessReasons" | "checkpointBatchCoverage" | "fontUsage" | "colorTags" | "thresholds" | "ssim" | "deckText">;
  execution: z.infer<typeof eventBatchExecutionSummarySchema>;
}) {
  const execution = eventBatchExecutionSummarySchema.parse(input.execution), root = input.root;
  const blocked = new Set<z.infer<typeof blockReasonSchema>>();
  const metrics = execution.visualMetrics;
  if (!metrics) blocked.add("AGGREGATE_METRICS_MISSING");
  else if (!root?.thresholds || !root.ssim
    || JSON.stringify(metrics.thresholds) !== JSON.stringify(root.thresholds)
    || metrics.ssim.minimumRequired !== root.ssim.minimumRequired) blocked.add("AGGREGATE_METRIC_POLICY_MISMATCH");
  const batch = root?.checkpointBatchCoverage?.batch;
  if (!root || !batch) blocked.add("ROOT_EVIDENCE_MISSING");
  else {
    if (batch.batchIndex !== 0 || batch.planSha256 !== execution.planSha256 || batch.batchCount !== execution.requiredBatchCount
      || batch.totalCheckpointCount !== execution.requiredCheckpointCount || batch.batchCount > 1 && root.status === "PASS") {
      blocked.add("ROOT_MEASUREMENT_INCONSISTENT");
    }
    if (!isDeepStrictEqual(root.deckText, execution.batches[0]?.visualMetrics?.deckText))
      blocked.add("ROOT_MEASUREMENT_INCONSISTENT");
    if (root.status === "FAIL" || root.checkpointBatchCoverage?.localStatus === "FAIL") blocked.add("ROOT_GATE_FAILED");
    const reasons = root.incompletenessReasons === undefined ? undefined : compositionConformanceIncompleteReasonsSchema.parse(root.incompletenessReasons);
    if (root.status === "INCOMPLETE" && !reasons?.length) blocked.add("LEGACY_INCOMPLETENESS_UNEXPLAINED");
    for (const reason of reasons ?? []) if (reason !== "EVENT_PARTITION_COVERAGE") blocked.add(reason);
    if (root.fontUsage) blocked.add("RENDERER_FONT_USAGE_UNAVAILABLE");
    if (root.colorTags?.status === "INCOMPLETE") blocked.add("COLOR_TAGS_INCOMPLETE");
    if (root.colorTags?.status === "FAIL") blocked.add("ROOT_GATE_FAILED");
    if (root.checkpointBatchCoverage?.localStatus === "INCOMPLETE" && !blocked.size) blocked.add("ROOT_MEASUREMENT_INCONSISTENT");
  }
  if (execution.status === "FAIL") blocked.add("AGGREGATE_GATE_FAILED");
  if (execution.status === "INCOMPLETE") blocked.add("AGGREGATE_COVERAGE_INCOMPLETE");
  const status = blocked.has("ROOT_GATE_FAILED") || blocked.has("AGGREGATE_GATE_FAILED") ? "FAIL"
    : blocked.size ? "INCOMPLETE" : "PASS";
  return eventVisualCoverageGateSchema.parse({policy: "EVENT_VISUAL_COVERAGE_DIAGNOSTIC_V1",
    scope: "VISUAL_SAMPLE_GATES_NOT_AUDIO_ENVIRONMENT_OR_RENDER_ATTESTATION", status, blockedReasons: [...blocked]});
}
