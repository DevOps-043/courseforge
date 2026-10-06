import { z } from "zod";
import { evaluateExportedVideoConformanceStatus, exportedAudioPresenceStatusSchema } from "./composition-exported-conformance-gate";
import { eventVisualCoverageGateSchema } from "./composition-conformance-event-visual-gate";
import { exportedColorTagReportSchema } from "../composition-color-tag-policy";

const statusSchema = z.enum(["PASS", "FAIL", "INCOMPLETE"]);
const obligationsSchema = z.object({
  audioStatus: exportedAudioPresenceStatusSchema,
  audioLoudness: z.object({status: z.enum(["NOT_APPLICABLE", "MEASURED_POLICY_NOT_SET", "PASS", "FAIL", "MEASUREMENT_FAILED"])}).passthrough(),
  audioTiming: z.object({status: z.enum(["NOT_REQUESTED", "PASS", "FAIL", "INCOMPLETE", "MEASUREMENT_FAILED"]),
    rms: z.object({status: z.enum(["NOT_REQUESTED", "PASS", "FAIL", "INCOMPLETE"])}).passthrough()}).passthrough(),
  audioPlayback: z.object({status: statusSchema}).passthrough().optional(),
  colorTags: exportedColorTagReportSchema.optional(),
}).passthrough();
const blockReasonSchema = z.enum(["NON_VISUAL_OBLIGATIONS_MISSING", "ROOT_COMPARISON_STATUS_MISMATCH", "COLOR_EVIDENCE_MISSING", "COLOR_POLICY_NOT_SET"]);
export const eventMeasurementGateSchema = z.object({
  policy: z.literal("EVENT_MEASUREMENT_RECOMPOSITION_V1"),
  scope: z.literal("MEASURED_OBLIGATIONS_NOT_EFFECTIVE_RENDER_ENVIRONMENT_OR_QA"),
  status: statusSchema,
  visualCoverageStatus: statusSchema,
  nonVisualStatus: statusSchema.nullable(),
  blockedReasons: z.array(blockReasonSchema).max(blockReasonSchema.options.length),
}).strict().superRefine((gate, context) => {
  const expected = gate.visualCoverageStatus === "FAIL" || gate.nonVisualStatus === "FAIL" ? "FAIL"
    : gate.visualCoverageStatus !== "PASS" || gate.nonVisualStatus !== "PASS" || gate.blockedReasons.length ? "INCOMPLETE" : "PASS";
  if (gate.status !== expected || new Set(gate.blockedReasons).size !== gate.blockedReasons.length)
    context.addIssue({code: "custom", message: "CONFORMANCE_EVENT_MEASUREMENT_GATE_INVALID"});
});

/** Re-evaluates every non-visual measurement before replacing partition-only visual incompleteness. */
export function evaluateEventMeasurementGate(input: {
  comparison: {status: z.infer<typeof statusSchema>; visual?: {status: z.infer<typeof statusSchema>}};
  visualCoverageGate: z.infer<typeof eventVisualCoverageGateSchema>;
}) {
  const coverage = eventVisualCoverageGateSchema.parse(input.visualCoverageGate);
  const obligations = obligationsSchema.safeParse(input.comparison);
  const blockedReasons: z.infer<typeof blockReasonSchema>[] = [];
  let nonVisualStatus: z.infer<typeof statusSchema> | null = null;
  if (!obligations.success || !input.comparison.visual) blockedReasons.push("NON_VISUAL_OBLIGATIONS_MISSING");
  else {
    const measured = obligations.data;
    const evaluate = (visualStatus: z.infer<typeof statusSchema>) => {
      const exported = evaluateExportedVideoConformanceStatus({visualStatus,
        audioStatus: measured.audioStatus, audioLoudnessStatus: measured.audioLoudness.status,
        audioTimingStatus: measured.audioTiming.status, audioRmsStatus: measured.audioTiming.rms.status,
        colorTagStatus: measured.colorTags?.status});
      return exported === "FAIL" || measured.audioPlayback?.status === "FAIL" ? "FAIL" as const
        : exported === "INCOMPLETE" || measured.audioPlayback?.status === "INCOMPLETE" ? "INCOMPLETE" as const : "PASS" as const;
    };
    nonVisualStatus = evaluate("PASS");
    if (!measured.colorTags) blockedReasons.push("COLOR_EVIDENCE_MISSING");
    else if (measured.colorTags.status === "MEASURED_POLICY_NOT_SET") blockedReasons.push("COLOR_POLICY_NOT_SET");
    if (blockedReasons.length && nonVisualStatus !== "FAIL") nonVisualStatus = "INCOMPLETE";
    if (evaluate(input.comparison.visual.status) !== input.comparison.status) blockedReasons.push("ROOT_COMPARISON_STATUS_MISMATCH");
  }
  const status = coverage.status === "FAIL" || nonVisualStatus === "FAIL" ? "FAIL"
    : coverage.status !== "PASS" || nonVisualStatus !== "PASS" || blockedReasons.length ? "INCOMPLETE" : "PASS";
  return eventMeasurementGateSchema.parse({policy: "EVENT_MEASUREMENT_RECOMPOSITION_V1",
    scope: "MEASURED_OBLIGATIONS_NOT_EFFECTIVE_RENDER_ENVIRONMENT_OR_QA", status,
    visualCoverageStatus: coverage.status, nonVisualStatus, blockedReasons});
}
