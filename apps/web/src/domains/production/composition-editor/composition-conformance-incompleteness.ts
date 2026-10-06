import { z } from "zod";

export const compositionConformanceIncompleteReasonSchema = z.enum([
  "CHECKPOINT_SAMPLES_MISSING", "SSIM_CHECKPOINTS_MISSING", "NATIVE_TEXT_EVIDENCE_INCOMPLETE",
  "RENDERER_FONT_USAGE_UNAVAILABLE", "COLOR_TAGS_INCOMPLETE", "SDR_PIXEL_CONVERSION_UNATTESTED", "EVENT_PARTITION_COVERAGE",
  "DECK_TEXT_EVIDENCE_INCOMPLETE",
  "RENDER_EXECUTION_ATTESTATION_PENDING",
  "RENDER_SEEK_REPEATABILITY_UNAVAILABLE",
]);
export const compositionConformanceIncompleteReasonsSchema = z.array(compositionConformanceIncompleteReasonSchema).max(compositionConformanceIncompleteReasonSchema.options.length)
  .refine((reasons) => new Set(reasons).size === reasons.length, "CONFORMANCE_INCOMPLETENESS_DUPLICATE_REASON");
export type CompositionConformanceIncompleteReason = z.infer<typeof compositionConformanceIncompleteReasonSchema>;
