import {z} from "zod";
import {COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS} from "./composition-conformance-checkpoint-policy";

export const CONTROLLED_SEEK_POLICY = "EXACT_RGBA_FORWARD_REVERSE_V1";
export const CONTROLLED_SEEK_LIMITS = {checkpointCount: COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS,
  pngBytes: 20 * 1024 * 1024, sweepBytes: 128 * 1024 * 1024, pixels: 1920 * 1080} as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const controlledSeekRepeatabilityReportSchema = z.object({policy: z.literal(CONTROLLED_SEEK_POLICY),
  scope: z.literal("SDK_SESSION_CHECKPOINTS_NOT_PREVIEW_PARITY_OR_JOB_ATTESTATION"), status: z.literal("PASS"),
  documentHash: hash, contractSha256: hash,
  checkpointCount: z.number().int().positive().max(CONTROLLED_SEEK_LIMITS.checkpointCount),
  byteCounts: z.object({forward: z.number().int().positive().max(CONTROLLED_SEEK_LIMITS.sweepBytes),
    reverse: z.number().int().positive().max(CONTROLLED_SEEK_LIMITS.sweepBytes)}).strict(),
  samples: z.array(z.object({frameIndex: z.number().int().nonnegative(), timeSeconds: z.number().finite().nonnegative(),
    rgbaSha256: hash}).strict()).min(1).max(CONTROLLED_SEEK_LIMITS.checkpointCount),
}).strict().superRefine((report, context) => {
  if (report.samples.length !== report.checkpointCount
    || report.samples.some((sample, index) => index > 0 && sample.frameIndex <= report.samples[index - 1].frameIndex))
    context.addIssue({code: "custom", message: "CONTROLLED_RENDER_SEEK_REPORT_INVALID"});
});
export type ControlledSeekRepeatabilityReport = z.infer<typeof controlledSeekRepeatabilityReportSchema>;
