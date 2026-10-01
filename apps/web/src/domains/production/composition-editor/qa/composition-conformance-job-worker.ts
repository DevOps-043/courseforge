import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AUDIO_TIMING_POLICY, AUDIO_RMS_WINDOW_POLICY } from "./composition-audio-conformance-policy";
import { playbackWitnessSchema } from "./composition-playback-audio-contract";
import { PLAYBACK_AV_POLICY } from "./composition-playback-audio-gate";
import { evaluateMediaBoundaries, MEDIA_BOUNDARY_POLICY } from "./composition-playback-boundaries";
import { PLAYBACK_CAPTURE_POLICY } from "./composition-playback-capture-runtime";
import { COMPOSITION_SSIM_POLICY } from "../composition-visual-metrics-policy";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../composition-text-parity-policy";
import { rendererFontUsagePendingSchema } from "../composition-font-usage-contract";
import { exportedColorTagReportSchema } from "./composition-exported-color-tags";
import { eventCheckpointBatchCoverageSchema } from "../composition-conformance-batch-contract";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const conformanceJobClaimSchema = z.object({
  id: z.string().uuid(), organization_id: z.string().uuid(), request_id: z.string().uuid(),
  revision_id: z.string().uuid(), lease_token: z.string().uuid(), attempts: z.number().int().min(1).max(5),
}).strict();
export type ConformanceJobClaim = z.infer<typeof conformanceJobClaimSchema>;
export const durableConformanceReportSchema = z.object({
  reportVersion: z.literal(1), scope: z.literal("REMOTE_INTEGRITY_AND_PERSISTED_CONFORMANCE"),
  status: z.enum(["PASS", "FAIL", "INCOMPLETE"]), organizationId: z.string().uuid(), requestId: z.string().uuid(),
  revisionId: z.string().uuid(), integrity: z.object({ assetId: z.string().uuid(), checksum: hash,
    documentHash: hash, sizeBytes: z.number().int().positive().max(2 * 1024 ** 3) }).strict(),
  references: z.object({ visualChecksum: hash, audioChecksum: hash }).strict(),
  comparison: z.object({ reportVersion: z.literal(2), documentHash: hash, status: z.enum(["PASS", "FAIL", "INCOMPLETE"]),
    colorTags: exportedColorTagReportSchema.optional(),
    visual: z.object({status: z.enum(["PASS", "FAIL", "INCOMPLETE"]), requiredCheckpointCount: z.number().int().positive().max(48),
      checkpointBatchCoverage: eventCheckpointBatchCoverageSchema.optional(),
      colorTags: exportedColorTagReportSchema.optional(),
      fontUsage: rendererFontUsagePendingSchema.optional(),
      textParity: z.object({policy: z.literal(COMPOSITION_TEXT_PARITY_POLICY.id), scope: z.literal("NATIVE_TEXT_AND_CAPTIONS"),
        status: z.enum(["PASS", "FAIL", "INCOMPLETE"]), checkedCheckpointCount: z.number().int().nonnegative().max(48),
        requiredCheckpointCount: z.number().int().positive().max(48), expectedRegionCount: z.number().int().nonnegative().max(2048),
        checkedRegionCount: z.number().int().nonnegative().max(2048),
      }).strict().optional(),
      ssim: z.object({policy: z.literal(COMPOSITION_SSIM_POLICY.id), minimumRequired: z.literal(COMPOSITION_SSIM_POLICY.minimum),
        minimumObserved: z.number().finite().min(-1).max(1).nullable(), checkedCheckpointCount: z.number().int().nonnegative().max(48),
      }).strict().optional(),
    }).passthrough().optional(),
    audioPlayback: z.object({status: z.enum(["PASS", "FAIL", "INCOMPLETE"]), witness: playbackWitnessSchema,
      policy: z.object({id: z.literal(PLAYBACK_AV_POLICY.id)}).passthrough(),
      maximumAvDriftUpperBoundMilliseconds: z.number().finite().nonnegative().nullable(),
      maximumMediaDriftUpperBoundMilliseconds: z.number().finite().nonnegative().nullable(),
      effectiveEventToleranceMilliseconds: z.number().finite().positive(),
      boundaries: z.object({policy: z.literal(MEDIA_BOUNDARY_POLICY), status: z.enum(["PASS", "FAIL", "INCOMPLETE"]), checkedClipCount: z.number().int().nonnegative().max(64),
        expectedClipCount: z.number().int().nonnegative().max(64), maximumBoundaryErrorUpperBoundMilliseconds: z.number().finite().nonnegative(),
      }).passthrough(),
    }).passthrough().optional(),
    video: z.object({ sha256: hash, sizeBytes: z.number().int().positive() }).passthrough(),
    audioTiming: z.object({ status: z.enum(["PASS", "FAIL", "INCOMPLETE", "MEASUREMENT_FAILED"]),
      method: z.literal("STEREO_ENERGY_ENVELOPE_STREAM_V3"), policy: z.object({ id: z.literal(AUDIO_TIMING_POLICY.id) }).passthrough(),
      rms: z.object({ status: z.enum(["NOT_REQUESTED", "PASS", "FAIL", "INCOMPLETE"]),
        policy: z.object({ id: z.literal(AUDIO_RMS_WINDOW_POLICY.id) }).passthrough() }).passthrough(),
    }).passthrough(),
  }).passthrough(),
  limitations: z.array(z.string().max(128)).max(8),
}).strict().superRefine((report, context) => {
  const playback = report.comparison.audioPlayback;
  const lag = report.comparison.audioTiming.lagMilliseconds;
  const visual = report.comparison.visual;
  if (report.status === "PASS" && visual?.checkpointBatchCoverage && (visual.checkpointBatchCoverage.batch.batchCount > 1
    || visual.checkpointBatchCoverage.localStatus !== "PASS")) {
    context.addIssue({code: "custom", message: "CONFORMANCE_JOB_EVENT_BATCH_IS_NOT_GLOBAL_COVERAGE"});
  }
  if (report.status === "PASS" && (visual?.colorTags?.status === "FAIL" || visual?.colorTags?.status === "INCOMPLETE")) {
    context.addIssue({code: "custom", message: "CONFORMANCE_JOB_VISUAL_COLOR_TAGS_INVALID"});
  }
  if (report.status === "PASS" && (report.comparison.colorTags?.status === "FAIL" || report.comparison.colorTags?.status === "INCOMPLETE")) {
    context.addIssue({code: "custom", message: "CONFORMANCE_JOB_COLOR_TAGS_INVALID"});
  }
  if (report.status === "PASS" && visual?.fontUsage) {
    context.addIssue({code: "custom", message: "CONFORMANCE_JOB_RENDERER_FONT_EVIDENCE_MISSING"});
  }
  if (report.status === "PASS" && visual?.textParity && (visual.textParity.status !== "PASS"
    || visual.textParity.requiredCheckpointCount !== visual.requiredCheckpointCount
    || visual.textParity.checkedCheckpointCount !== visual.requiredCheckpointCount
    || visual.textParity.checkedRegionCount !== visual.textParity.expectedRegionCount)) {
    context.addIssue({code: "custom", message: "CONFORMANCE_JOB_TEXT_PARITY_INVALID"});
  }
  if (report.status === "PASS" && visual && (visual.status !== "PASS" || (visual.ssim
    && (visual.ssim.minimumObserved === null || visual.ssim.minimumObserved < visual.ssim.minimumRequired
      || visual.ssim.checkedCheckpointCount !== visual.requiredCheckpointCount)))) {
    context.addIssue({code: "custom", message: "CONFORMANCE_JOB_VISUAL_METRICS_INVALID"});
  }
  if (playback && report.status === "PASS") {
    const calculated = evaluateMediaBoundaries(playback.witness.boundaries, playback.witness.originFrame, PLAYBACK_CAPTURE_POLICY.sampleRate,
      playback.witness.quantumMilliseconds, playback.effectiveEventToleranceMilliseconds, playback.boundaries.expectedClipCount);
    if (calculated.status !== "PASS" || calculated.checkedClipCount !== playback.boundaries.checkedClipCount
      || calculated.maximumBoundaryErrorUpperBoundMilliseconds > playback.boundaries.maximumBoundaryErrorUpperBoundMilliseconds) {
      context.addIssue({code: "custom", message: "CONFORMANCE_JOB_PLAYBACK_BOUNDARIES_INVALID"});
    }
  }
  if (playback && report.status === "PASS" && (typeof lag !== "number" || !Number.isFinite(lag)
    || playback.witness.maxClockDriftMilliseconds + Math.abs(lag) + playback.witness.quantumMilliseconds
      + AUDIO_TIMING_POLICY.lagUncertaintyMilliseconds > PLAYBACK_AV_POLICY.maximumAvDriftMilliseconds
    || playback.maximumAvDriftUpperBoundMilliseconds === null
    || playback.maximumAvDriftUpperBoundMilliseconds < playback.witness.maxClockDriftMilliseconds + Math.abs(lag)
      + playback.witness.quantumMilliseconds + AUDIO_TIMING_POLICY.lagUncertaintyMilliseconds
    || playback.maximumMediaDriftUpperBoundMilliseconds === null
    || playback.maximumMediaDriftUpperBoundMilliseconds < playback.witness.maxMediaDriftMilliseconds + playback.witness.quantumMilliseconds
    || playback.boundaries.status !== "PASS" || playback.boundaries.checkedClipCount !== playback.boundaries.expectedClipCount
    || playback.boundaries.maximumBoundaryErrorUpperBoundMilliseconds > playback.effectiveEventToleranceMilliseconds
    || playback.witness.maxMediaDriftMilliseconds + playback.witness.quantumMilliseconds > playback.effectiveEventToleranceMilliseconds)) {
    context.addIssue({code: "custom", message: "CONFORMANCE_JOB_PLAYBACK_TIMING_INVALID"});
  }
  if (report.status !== report.comparison.status || report.integrity.documentHash !== report.comparison.documentHash
    || report.integrity.checksum !== report.comparison.video.sha256
    || report.integrity.sizeBytes !== report.comparison.video.sizeBytes
    || (report.status === "PASS" && (report.comparison.audioTiming.status !== "PASS"
      || report.comparison.audioTiming.rms.status !== "PASS"
      || (report.comparison.audioPlayback !== undefined && (report.comparison.audioPlayback.status !== "PASS"
        || report.comparison.audioPlayback.maximumAvDriftUpperBoundMilliseconds === null
        || report.comparison.audioPlayback.maximumAvDriftUpperBoundMilliseconds > PLAYBACK_AV_POLICY.maximumAvDriftMilliseconds
        || report.comparison.audioPlayback.maximumMediaDriftUpperBoundMilliseconds === null
        || report.comparison.audioPlayback.maximumMediaDriftUpperBoundMilliseconds > report.comparison.audioPlayback.effectiveEventToleranceMilliseconds))))) {
    context.addIssue({ code: "custom", message: "CONFORMANCE_JOB_REPORT_BINDING_INVALID" });
  }
});
export type DurableConformanceReport = z.infer<typeof durableConformanceReportSchema>;
export function classifyConformanceJobFailure(error: unknown) {
  // Do not persist provider messages, URLs, paths or stack traces.
  const message = error instanceof Error ? error.message : "";
  const permanent = /(?:MISMATCH|INVALID|OVERWRITTEN|UNSUPPORTED|LEGACY|CLIPPING|LIMIT|EXCEEDED)/.test(message);
  return { code: permanent ? "CONFORMANCE_JOB_INPUT_REJECTED" : "CONFORMANCE_JOB_EXECUTION_FAILED", retryable: !permanent };
}

/** Execution success is not measurement PASS or approval of QA/publication. */
export async function processConformanceJob(supabase: SupabaseClient<any, any, any>,
  execute: (claim: ConformanceJobClaim) => Promise<DurableConformanceReport>, heartbeatMs = 60_000) {
  if (!Number.isFinite(heartbeatMs) || heartbeatMs < 10) throw new Error("CONFORMANCE_JOB_HEARTBEAT_INVALID");
  const claimed = await supabase.rpc("claim_hyperframes_conformance_job");
  if (claimed.error) throw new Error("CONFORMANCE_JOB_CLAIM_FAILED");
  const claims = z.array(conformanceJobClaimSchema).max(1).parse(claimed.data);
  const claim = claims[0];
  if (!claim) return { status: "IDLE" as const };
  let leaseLost = false;
  let renewing = Promise.resolve();
  const timer = setInterval(() => {
    // Serialize renewals, contain rejections and drain before finishing the reservation.
    renewing = renewing.then(async () => {
      if (leaseLost) return;
      try {
        const renewed = await supabase.rpc("renew_hyperframes_conformance_job", { p_job_id: claim.id, p_lease_token: claim.lease_token });
        if (renewed.error || renewed.data !== true) leaseLost = true;
      } catch { leaseLost = true; }
    });
  }, heartbeatMs);
  let report: DurableConformanceReport | null = null;
  let failure: ReturnType<typeof classifyConformanceJobFailure> | null = null;
  try {
    report = durableConformanceReportSchema.parse(await execute(claim));
    if (report.organizationId !== claim.organization_id || report.requestId !== claim.request_id || report.revisionId !== claim.revision_id
      || Buffer.byteLength(JSON.stringify(report), "utf8") > 1024 ** 2) throw new Error("CONFORMANCE_JOB_REPORT_BINDING_INVALID");
  } catch (error) { report = null; failure = classifyConformanceJobFailure(error); }
  finally { clearInterval(timer); await renewing; }
  if (leaseLost) return { status: "LEASE_LOST" as const, jobId: claim.id };
  // A lost finish acknowledgement must not be converted into a second failure write.
  const finished = await supabase.rpc("finish_hyperframes_conformance_job", {
    p_job_id: claim.id, p_lease_token: claim.lease_token, p_report: report,
    p_error_code: failure?.code ?? null, p_retryable: failure?.retryable ?? false,
  });
  if (finished.error) throw new Error("CONFORMANCE_JOB_FINISH_FAILED");
  return { status: finished.data !== true ? "LEASE_LOST" as const : failure ? "FAILED_ATTEMPT" as const : "SUCCEEDED" as const,
    jobId: claim.id, requestId: claim.request_id, attempt: claim.attempts,
    conformanceStatus: report?.status ?? null, errorCode: failure?.code ?? null };
}
