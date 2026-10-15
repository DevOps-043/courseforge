import type { SupabaseClient } from "@supabase/supabase-js";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { AUDIO_TIMING_POLICY, AUDIO_RMS_WINDOW_POLICY } from "./composition-audio-conformance-policy";
import { playbackWitnessSchema } from "./composition-playback-audio-contract";
import { PLAYBACK_AV_POLICY } from "./composition-playback-audio-gate";
import { evaluateMediaBoundaries, MEDIA_BOUNDARY_POLICY } from "./composition-playback-boundaries";
import { PLAYBACK_CAPTURE_POLICY } from "./composition-playback-capture-runtime";
import { COMPOSITION_SSIM_POLICY } from "../composition-visual-metrics-policy";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../composition-text-parity-policy";
import { DECK_TEXT_PLAN_POLICY } from "../composition-deck-text-plan";
import { COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS } from "../composition-conformance-checkpoint-policy";
import { rendererFontUsagePendingSchema } from "../composition-font-usage-contract";
import { exportedColorTagReportSchema } from "./composition-exported-color-tags";
import { eventCheckpointBatchCoverageSchema } from "../composition-conformance-batch-contract";
import { eventBatchExecutionSummarySchema } from "./composition-conformance-event-batch-execution";
import { compositionConformanceIncompleteReasonsSchema } from "../composition-conformance-incompleteness";
import { eventVisualCoverageGateSchema, evaluateEventVisualCoverageGate } from "./composition-conformance-event-visual-gate";
import { evaluateExportedVideoConformanceStatus, exportedAudioPresenceStatusSchema } from "./composition-exported-conformance-gate";
import { compositionConformanceThresholdsSchema } from "../composition-preview-render-conformance";
import {controlledRenderExecutionReportSchema} from "../composition-render-execution-contract";
import {controlledSeekRepeatabilityReportSchema} from "../composition-render-seek-policy";
import { evaluateConformanceJobStatus } from "./composition-conformance-job-status";
import { eventMeasurementGateSchema, evaluateEventMeasurementGate } from "./composition-event-measurement-gate";
import { ConformanceStageFailure, requiresConformanceExecutionRecovery } from "./composition-conformance-stage-failure";
import {createConformanceJobLease, CONFORMANCE_JOB_LEASE_POLICY, validateConformanceJobLeaseTimers} from "./composition-conformance-job-lease";
import {assertConformanceAttemptBinding, conformanceAttemptBindingSchema} from "./composition-conformance-attempt-binding";
import {renderSupervisorBindingSchema} from "../composition-render-supervisor-receipt";
import {controlledReferenceSelectionSchema} from "./composition-controlled-reference-selection";
import {assertSilentConformanceAudioReport} from "./composition-silent-conformance-gate";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const conformanceJobClaimSchema = z.object({
  id: z.string().uuid(), organization_id: z.string().uuid(), request_id: z.string().uuid(),
  revision_id: z.string().uuid(), lease_token: z.string().uuid(), attempts: z.number().int().min(1).max(5),
}).strict();
export type ConformanceJobClaim = z.infer<typeof conformanceJobClaimSchema>;
export const durableConformanceReportSchema = z.object({
  reportVersion: z.union([z.literal(1), z.literal(2)]), scope: z.literal("REMOTE_INTEGRITY_AND_PERSISTED_CONFORMANCE"),
  status: z.enum(["PASS", "FAIL", "INCOMPLETE"]), organizationId: z.string().uuid(), requestId: z.string().uuid(),
  revisionId: z.string().uuid(), integrity: z.object({ assetId: z.string().uuid(), checksum: hash,
    documentHash: hash, sizeBytes: z.number().int().positive().max(2 * 1024 ** 3) }).strict(),
  references: z.object({ visualChecksum: hash, audioChecksum: hash.optional() }).strict(),
  audioExpectation: z.object({policy: z.literal("FROZEN_NO_AUDIO_TRACK_V1"), contractSha256: hash}).strict().optional(),
  reservationEvidence: z.object({policy: z.literal("EXACT_JOB_RENDER_RESERVATION_V1"), sha256: hash,
    executionId: z.string().uuid(), supervisorReceiptSha256: hash}).strict().optional(),
  // Optional only for historical reads. Current worker writes always require a claim binding.
  attemptBinding: conformanceAttemptBindingSchema.optional(),
  renderEvidence: z.object({scope: z.literal("CONSUMED_SUPERVISOR_ISSUER_OUTPUT_NOT_ISOLATION_OR_CONFORMANCE"),
    binding: renderSupervisorBindingSchema, supervisorReceiptSha256: hash}).strict().optional(),
  referenceSelection: controlledReferenceSelectionSchema.optional(),
  eventCheckpointExecution: eventBatchExecutionSummarySchema.optional(),
  eventVisualCoverageGate: eventVisualCoverageGateSchema.optional(),
  eventMeasurementGate: eventMeasurementGateSchema.optional(),
  comparison: z.object({ reportVersion: z.literal(2), documentHash: hash, status: z.enum(["PASS", "FAIL", "INCOMPLETE"]),
    preEventComparisonStatus: z.enum(["PASS", "FAIL", "INCOMPLETE"]).optional(),
    audioStatus: exportedAudioPresenceStatusSchema.optional(),
    audioLoudness: z.object({status: z.enum(["NOT_APPLICABLE", "MEASURED_POLICY_NOT_SET", "PASS", "FAIL", "MEASUREMENT_FAILED"])}).passthrough().optional(),
    colorTags: exportedColorTagReportSchema.optional(),
    visual: z.object({status: z.enum(["PASS", "FAIL", "INCOMPLETE"]), requiredCheckpointCount: z.number().int().positive().max(48),
      thresholds: compositionConformanceThresholdsSchema.optional(),
      incompletenessReasons: compositionConformanceIncompleteReasonsSchema.optional(),
      checkpointBatchCoverage: eventCheckpointBatchCoverageSchema.optional(),
      colorTags: exportedColorTagReportSchema.optional(),
      renderExecution: controlledRenderExecutionReportSchema.optional(),
      seekRepeatability: controlledSeekRepeatabilityReportSchema.optional(),
      fontUsage: rendererFontUsagePendingSchema.optional(),
      textParity: z.object({policy: z.literal(COMPOSITION_TEXT_PARITY_POLICY.id), scope: z.literal("NATIVE_TEXT_AND_CAPTIONS"),
        status: z.enum(["PASS", "FAIL", "INCOMPLETE"]), checkedCheckpointCount: z.number().int().nonnegative().max(48),
        requiredCheckpointCount: z.number().int().positive().max(48), expectedRegionCount: z.number().int().nonnegative().max(2048),
        checkedRegionCount: z.number().int().nonnegative().max(2048),
      }).strict().optional(),
      deckText: z.object({policy: z.literal(DECK_TEXT_PLAN_POLICY), scope: z.literal("DECK_SOURCE_TEXT_REGIONS_NOT_RENDER_FONT_ATTESTATION"),
        status: z.enum(["PASS", "FAIL", "INCOMPLETE"]), checkedCheckpointCount: z.number().int().nonnegative().max(COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS),
        requiredCheckpointCount: z.number().int().positive().max(COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS),
        expectedRegionCount: z.number().int().nonnegative().max(COMPOSITION_TEXT_PARITY_POLICY.maximumRegions * COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS),
        checkedRegionCount: z.number().int().nonnegative().max(COMPOSITION_TEXT_PARITY_POLICY.maximumRegions * COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS),
      }).strict().superRefine((summary, context) => {
        if (summary.checkedCheckpointCount > summary.requiredCheckpointCount
          || summary.checkedRegionCount > summary.expectedRegionCount
          || summary.status === "PASS" && (summary.checkedCheckpointCount !== summary.requiredCheckpointCount
            || summary.checkedRegionCount !== summary.expectedRegionCount))
          context.addIssue({code: "custom", message: "CONFORMANCE_DECK_TEXT_SUMMARY_INVALID"});
      }).optional(),
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
    video: z.object({ sha256: hash, sizeBytes: z.number().int().positive(), hasAudio: z.boolean().optional() }).passthrough(),
    audioTiming: z.object({ status: z.enum(["NOT_REQUESTED", "PASS", "FAIL", "INCOMPLETE", "MEASUREMENT_FAILED"]),
      method: z.literal("STEREO_ENERGY_ENVELOPE_STREAM_V3"), policy: z.object({ id: z.literal(AUDIO_TIMING_POLICY.id) }).passthrough(),
      rms: z.object({ status: z.enum(["NOT_REQUESTED", "PASS", "FAIL", "INCOMPLETE"]),
        policy: z.object({ id: z.literal(AUDIO_RMS_WINDOW_POLICY.id) }).passthrough() }).passthrough(),
    }).passthrough(),
  }).passthrough(),
  limitations: z.array(z.string().max(128)).max(8),
}).strict().superRefine((report, context) => {
  const admitted = report.renderEvidence?.binding;
  const selection = report.referenceSelection;
  const silent = report.reportVersion === 2;
  if (report.reservationEvidence && (!admitted || !selection
    || report.reservationEvidence.executionId !== admitted.executionId
    || report.reservationEvidence.supervisorReceiptSha256 !== report.renderEvidence?.supervisorReceiptSha256))
    context.addIssue({code: "custom", message: "CONFORMANCE_JOB_DURABLE_RESERVATION_BINDING_INVALID"});
  if (silent) {
    if (!admitted || !selection || !report.audioExpectation
      || report.audioExpectation.contractSha256 !== admitted.contractSha256
      || report.references.audioChecksum !== undefined
      || selection.references.some(reference => reference.audioChecksum !== undefined))
      context.addIssue({code: "custom", message: "CONFORMANCE_JOB_SILENT_BINDING_INVALID"});
    try {assertSilentConformanceAudioReport(report.comparison);}
    catch {context.addIssue({code: "custom", message: "CONFORMANCE_JOB_SILENT_MEASUREMENT_INVALID"});}
  } else if (!report.references.audioChecksum || report.audioExpectation !== undefined
    || report.comparison.audioTiming.status === "NOT_REQUESTED") {
    context.addIssue({code: "custom", message: "CONFORMANCE_JOB_AUDIO_REFERENCE_REQUIRED_INVALID"});
  }
  if (selection && (!admitted || selection.organizationId !== admitted.organizationId
    || selection.revisionId !== admitted.revisionId || selection.executionId !== admitted.executionId
    || selection.documentHash !== admitted.documentHash || selection.projectHash !== admitted.projectHash
    || selection.contractSha256 !== admitted.contractSha256
    || selection.references[0]?.visualChecksum !== report.references.visualChecksum
    || selection.references[0]?.audioChecksum !== report.references.audioChecksum
    || (admitted.artifactKind === "SINGLE_CONTRACT" ? selection.references.length !== 1
      : selection.references.length !== report.eventCheckpointExecution?.requiredBatchCount
        || report.eventCheckpointExecution?.batches.some((batch, index) => batch.visualReferenceSha256 !== selection.references[index]?.visualChecksum))
    || selection.references.some((reference, index) => reference.batchIndex !== index)))
    context.addIssue({code: "custom", message: "CONFORMANCE_JOB_REFERENCE_SELECTION_BINDING_INVALID"});
  if (admitted && (admitted.organizationId !== report.organizationId || admitted.requestId !== report.requestId
    || admitted.revisionId !== report.revisionId || admitted.documentHash !== report.integrity.documentHash
    || admitted.videoSha256 !== report.integrity.checksum || admitted.sizeBytes !== report.integrity.sizeBytes
    || report.status === "PASS" || !report.comparison.visual?.renderExecution))
    context.addIssue({code: "custom", message: "CONFORMANCE_JOB_RENDER_EVIDENCE_BINDING_INVALID"});
  const playback = report.comparison.audioPlayback;
  const lag = report.comparison.audioTiming.lagMilliseconds;
  const visual = report.comparison.visual;
  const fontWitness = visual?.fontUsage?.observedWitness;
  if (fontWitness && (fontWitness.documentHash !== report.integrity.documentHash
    || fontWitness.videoSha256 !== report.integrity.checksum || !visual?.renderExecution
    || fontWitness.manifestSha256 !== visual.fontUsage!.manifestSha256
    || fontWitness.bindingCount !== visual.fontUsage!.requiredBindingCount
    || fontWitness.checkpointCount !== visual.requiredCheckpointCount
    || !visual.incompletenessReasons?.includes("RENDERER_FONT_USAGE_UNAVAILABLE")
    || report.status === "PASS" || visual.status === "PASS"))
    context.addIssue({code: "custom", message: "CONFORMANCE_JOB_RENDER_FONT_WITNESS_INVALID"});
  if (visual?.seekRepeatability && (visual.seekRepeatability.documentHash !== report.integrity.documentHash
    || !visual.renderExecution || report.status === "PASS" || visual.status === "PASS")
    || report.status === "PASS" && visual?.incompletenessReasons?.includes("RENDER_SEEK_REPEATABILITY_UNAVAILABLE"))
    context.addIssue({code: "custom", message: "CONFORMANCE_JOB_RENDER_SEEK_ATTESTATION_INVALID"});
  if (visual?.renderExecution && (visual.renderExecution.documentHash !== report.integrity.documentHash
    || visual.renderExecution.videoSha256 !== report.integrity.checksum
    || visual.renderExecution.status === "MISMATCH" && report.status !== "FAIL"
    || !visual.incompletenessReasons?.includes("RENDER_EXECUTION_ATTESTATION_PENDING")
    || report.status === "PASS") || report.status === "PASS"
      && visual?.incompletenessReasons?.includes("RENDER_EXECUTION_ATTESTATION_PENDING"))
    context.addIssue({code: "custom", message: "CONFORMANCE_JOB_RENDER_EXECUTION_ATTESTATION_INVALID"});
  const events = report.eventCheckpointExecution;
  if (report.eventMeasurementGate && (!report.eventVisualCoverageGate || !events
    || JSON.stringify(report.eventMeasurementGate) !== JSON.stringify(evaluateEventMeasurementGate({
      comparison: {...report.comparison, status: report.comparison.preEventComparisonStatus ?? report.comparison.status},
      visualCoverageGate: report.eventVisualCoverageGate})))) {
    context.addIssue({code: "custom", message: "CONFORMANCE_JOB_EVENT_MEASUREMENT_GATE_MISMATCH"});
  }
  if (events?.visualMetrics && (!visual?.thresholds || !visual.ssim
    || JSON.stringify(events.visualMetrics.thresholds) !== JSON.stringify(visual.thresholds)
    || events.visualMetrics.ssim.minimumRequired !== visual.ssim.minimumRequired
    || !isDeepStrictEqual(events.batches[0]?.visualMetrics?.deckText, visual.deckText))) {
    context.addIssue({code: "custom", message: "CONFORMANCE_JOB_EVENT_METRIC_POLICY_MISMATCH"});
  }
  if (report.status === "PASS" && (report.comparison.audioStatus !== undefined || report.comparison.audioLoudness !== undefined)
    && (report.comparison.audioStatus === undefined || report.comparison.audioLoudness === undefined
      || evaluateExportedVideoConformanceStatus({audioStatus: report.comparison.audioStatus,
        audioLoudnessStatus: report.comparison.audioLoudness.status, visualStatus: visual?.status ?? "PASS",
        audioTimingStatus: report.comparison.audioTiming.status, audioRmsStatus: report.comparison.audioTiming.rms.status,
        colorTagStatus: report.comparison.colorTags?.status}) !== "PASS")) {
    context.addIssue({code: "custom", message: "CONFORMANCE_JOB_EXPORTED_AUDIO_OBLIGATIONS_INVALID"});
  }
  if (report.eventVisualCoverageGate && (!events
    || JSON.stringify(report.eventVisualCoverageGate) !== JSON.stringify(evaluateEventVisualCoverageGate({root: visual, execution: events})))) {
    context.addIssue({code: "custom", message: "CONFORMANCE_JOB_EVENT_VISUAL_DIAGNOSTIC_MISMATCH"});
  }
  if (events && (events.organizationId !== report.organizationId || events.revisionId !== report.revisionId
    || !visual?.checkpointBatchCoverage
    || events.documentHash !== report.integrity.documentHash || events.videoSha256 !== report.integrity.checksum
    || visual?.checkpointBatchCoverage && (events.planSha256 !== visual.checkpointBatchCoverage.batch.planSha256
      || visual.checkpointBatchCoverage.batch.batchIndex !== 0
      || events.requiredBatchCount !== visual.checkpointBatchCoverage.batch.batchCount
      || events.requiredCheckpointCount !== visual.checkpointBatchCoverage.batch.totalCheckpointCount)
    || report.status === "PASS" && events.status !== "PASS"
    || events.status === "FAIL" && report.status !== "FAIL")) {
    context.addIssue({code: "custom", message: "CONFORMANCE_JOB_EVENT_EXECUTION_MISMATCH"});
  }
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
  if (report.status === "PASS" && visual?.incompletenessReasons?.includes("DECK_TEXT_EVIDENCE_INCOMPLETE")) {
    context.addIssue({code: "custom", message: "CONFORMANCE_JOB_DECK_TEXT_EVIDENCE_MISSING"});
  }
  if (report.status === "PASS" && visual?.incompletenessReasons?.includes("SDR_PIXEL_CONVERSION_UNATTESTED")) {
    context.addIssue({code: "custom", message: "CONFORMANCE_JOB_SDR_CONVERSION_UNATTESTED"});
  }
  if (report.status === "PASS" && visual?.deckText && (visual.deckText.status !== "PASS"
    || visual.deckText.requiredCheckpointCount !== visual.requiredCheckpointCount
    || visual.deckText.checkedCheckpointCount !== visual.requiredCheckpointCount
    || visual.deckText.checkedRegionCount !== visual.deckText.expectedRegionCount)) {
    context.addIssue({code: "custom", message: "CONFORMANCE_JOB_DECK_TEXT_METRICS_INVALID"});
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
  const priorStatus = report.comparison.preEventComparisonStatus ?? report.comparison.status;
  const expectedStatus = evaluateConformanceJobStatus({comparisonStatus: priorStatus,
    eventStatus: events?.status, eventVisualCoverageStatus: report.eventVisualCoverageGate?.status,
    eventMeasurementStatus: report.eventMeasurementGate?.status});
  if (Boolean(events) !== (report.comparison.preEventComparisonStatus !== undefined)
    || report.status !== expectedStatus || report.comparison.status !== expectedStatus || report.integrity.documentHash !== report.comparison.documentHash
    || report.integrity.checksum !== report.comparison.video.sha256
    || report.integrity.sizeBytes !== report.comparison.video.sizeBytes
    || (report.status === "PASS" && !silent && (report.comparison.audioTiming.status !== "PASS"
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
  if (error instanceof ConformanceStageFailure) return {code: error.errorCode, retryable: error.retryable};
  if (requiresConformanceExecutionRecovery(error)) return {code: "CONFORMANCE_JOB_EXECUTION_RECOVERY_REQUIRED", retryable: false};
  // Do not persist provider messages, URLs, paths or stack traces.
  const message = error instanceof Error ? error.message : "";
  const permanent = /(?:MISMATCH|INVALID|OVERWRITTEN|UNSUPPORTED|LEGACY|CLIPPING|LIMIT|EXCEEDED)/.test(message);
  return { code: permanent ? "CONFORMANCE_JOB_INPUT_REJECTED" : "CONFORMANCE_JOB_EXECUTION_FAILED", retryable: !permanent };
}

/** Execution success is not measurement PASS or approval of QA/publication. */
export async function processConformanceJob(supabase: SupabaseClient<any, any, any>,
  execute: (claim: ConformanceJobClaim, signal: AbortSignal) => Promise<DurableConformanceReport>,
  heartbeatMs: number = CONFORMANCE_JOB_LEASE_POLICY.heartbeatMs,
  options: {signal?: AbortSignal; renewalTimeoutMs?: number} = {}) {
  validateConformanceJobLeaseTimers(heartbeatMs, options.renewalTimeoutMs ?? CONFORMANCE_JOB_LEASE_POLICY.renewalTimeoutMs);
  if (options.signal?.aborted) return {status: "STOPPED" as const};
  const claimed = await supabase.rpc("claim_hyperframes_conformance_job");
  if (claimed.error) throw new Error("CONFORMANCE_JOB_CLAIM_FAILED");
  const claims = z.array(conformanceJobClaimSchema).max(1).parse(claimed.data);
  const claim = claims[0];
  if (!claim) return { status: "IDLE" as const };
  const lease = createConformanceJobLease({heartbeatMs, renewalTimeoutMs: options.renewalTimeoutMs, signal: options.signal,
    renew: async signal => {
      const request = supabase.rpc("renew_hyperframes_conformance_job", {p_job_id: claim.id, p_lease_token: claim.lease_token});
      const renewed = await (typeof request.abortSignal === "function" ? request.abortSignal(signal) : request);
      return !renewed.error && renewed.data === true;
    }});
  let report: DurableConformanceReport | null = null;
  let failure: ReturnType<typeof classifyConformanceJobFailure> | null = null;
  let stageFailure: ConformanceStageFailure | null = null;
  try {
    if (lease.signal.aborted) throw new Error("CONFORMANCE_JOB_EXECUTION_CANCELLED");
    report = durableConformanceReportSchema.parse(await execute(claim, lease.signal));
    if (lease.signal.aborted) throw new Error("CONFORMANCE_JOB_EXECUTION_CANCELLED");
    assertConformanceAttemptBinding(report.attemptBinding, claim);
    if (report.organizationId !== claim.organization_id || report.requestId !== claim.request_id || report.revisionId !== claim.revision_id
      || Buffer.byteLength(JSON.stringify(report), "utf8") > 1024 ** 2) throw new Error("CONFORMANCE_JOB_REPORT_BINDING_INVALID");
  } catch (error) { report = null; failure = classifyConformanceJobFailure(error);
    stageFailure = error instanceof ConformanceStageFailure ? error : null; }
  finally {await lease.close();}
  if (lease.lost) return { status: "LEASE_LOST" as const, jobId: claim.id,
    ...(failure?.code.endsWith("RECOVERY_REQUIRED") ? {recoveryRequired: true as const, errorCode: failure.code} : {}) };
  if (lease.signal.aborted && report !== null) {report = null; failure = classifyConformanceJobFailure(new Error("CONFORMANCE_JOB_EXECUTION_CANCELLED"));}
  // A lost finish acknowledgement must not be converted into a second failure write.
  const finished = await supabase.rpc("finish_hyperframes_conformance_job", {
    p_job_id: claim.id, p_lease_token: claim.lease_token, p_report: report,
    p_error_code: failure?.code ?? null, p_retryable: failure?.retryable ?? false,
  });
  if (finished.error) throw new Error(failure?.code.endsWith("RECOVERY_REQUIRED")
    ? "CONFORMANCE_JOB_EXECUTION_RECOVERY_REQUIRED" : "CONFORMANCE_JOB_FINISH_FAILED");
  return { status: finished.data !== true ? "LEASE_LOST" as const : failure ? "FAILED_ATTEMPT" as const : "SUCCEEDED" as const,
    jobId: claim.id, requestId: claim.request_id, attempt: claim.attempts,
    conformanceStatus: report?.status ?? null, errorCode: failure?.code ?? null,
    ...(failure?.code.endsWith("RECOVERY_REQUIRED") ? {recoveryRequired: true as const} : {}),
    ...(stageFailure ? {failureStage: stageFailure.stage, cleanupFailed: stageFailure.cleanupFailed} : {}) };
}
