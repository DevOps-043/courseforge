import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { prepareAndPersistVisualConformanceReference } from "./composition-conformance-reference-pipeline";
import { prepareAndPersistAudioConformanceReference } from "./composition-audio-evidence-pipeline";
import { compareVideoWithPersistedConformanceReferences } from "./composition-persisted-audio-comparison";
import { conformanceJobClaimSchema, durableConformanceReportSchema, type ConformanceJobClaim } from "./composition-conformance-job-worker";
import { resolveExportedColorTagPolicyId, type ExportedColorTagPolicyId } from "./composition-exported-color-tags";
import { executePersistedCompositionEventBatches } from "./composition-conformance-persisted-event-execution";
import { eventBatchExecutionSummarySchema } from "./composition-conformance-event-batch-execution";
import { evaluateEventVisualCoverageGate } from "./composition-conformance-event-visual-gate";
import { evaluateConformanceJobStatus } from "./composition-conformance-job-status";
import { evaluateEventMeasurementGate } from "./composition-event-measurement-gate";
import { wrapConformanceStageFailure, recordConformanceCleanupFailure, ConformanceStageFailure, type ConformanceExecutionStage } from "./composition-conformance-stage-failure";
import { assertConformanceReportMatchesContract } from "./composition-conformance-contract-report-gate";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";
import {createControlledRenderDeadline, CONTROLLED_RENDER_DEADLINE_POLICY} from "./composition-controlled-render-deadline";
import {bindConformanceReportToAttempt} from "./composition-conformance-attempt-binding";

const integritySchema = z.object({ assetId: z.string().uuid(), checksum: z.string().regex(/^[a-f0-9]{64}$/),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/), sizeBytes: z.number().int().positive().max(2 * 1024 ** 3), status: z.literal("MATCH") }).strict();
type IntegrityResult = z.infer<typeof integritySchema>;
type IntegrityScope = { supabase: SupabaseClient<any, any, any>; supabaseUrl: string; organizationId: string; requestId: string; signal?: AbortSignal };
export type ConformanceIntegrityAdapters = {
  snapshot: (params: IntegrityScope & { destinationPath: string }) => Promise<IntegrityResult>;
  recheck: (params: IntegrityScope) => Promise<IntegrityResult>;
};
const defaultEvidence = { visual: prepareAndPersistVisualConformanceReference, audio: prepareAndPersistAudioConformanceReference,
  compare: compareVideoWithPersistedConformanceReferences, events: executePersistedCompositionEventBatches };

type ConformanceJobExecutionInput = {
  claim: ConformanceJobClaim; supabase: SupabaseClient<any, any, any>; supabaseUrl: string; ffmpegPath: string; allowLongAudio?: boolean; capturePlaybackAudio?: boolean;
  colorTagPolicyId?: ExportedColorTagPolicyId;
  signal?: AbortSignal;
};

export const CONFORMANCE_JOB_EXECUTION_POLICY = Object.freeze({
  id: "WHOLE_CONFORMANCE_EXECUTION_BUDGET_V1",
  timeoutMilliseconds: CONTROLLED_RENDER_DEADLINE_POLICY.maximumMilliseconds,
});

/** Includes preparation, all partitions, remote recheck and owned cleanup; no per-stage reset.
 * Waits for adapter ownership before cleanup: a logical timeout is not OS termination. */
export async function executeConformanceJob(params: ConformanceJobExecutionInput,
  integrity: ConformanceIntegrityAdapters, evidence: typeof defaultEvidence = defaultEvidence,
  budgetOptions: {timeoutMilliseconds?: number; clock?: () => number} = {}) {
  assertConformanceJobActive(params.signal);
  const budget = createControlledRenderDeadline(budgetOptions.timeoutMilliseconds
    ?? CONFORMANCE_JOB_EXECUTION_POLICY.timeoutMilliseconds, params.signal, budgetOptions.clock);
  const assertActive = () => {
    try {budget.remainingMilliseconds();}
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "CONTROLLED_RENDER_DEADLINE_EXCEEDED") throw new Error("CONFORMANCE_JOB_DEADLINE_TIMEOUT");
      if (message === "CONTROLLED_RENDER_ABORTED") throw new Error("CONFORMANCE_JOB_EXECUTION_CANCELLED");
      throw new Error("CONFORMANCE_JOB_DEADLINE_INVALID");
    }
  };
  try {
    assertActive();
    const result = await executeActiveConformanceJob({...params, signal: budget.signal}, integrity, evidence, assertActive);
    try {assertActive();} catch (error) {throw wrapConformanceStageFailure("RESOURCE_CLEANUP", error);}
    return result;
  } finally {budget.dispose();}
}

/** Worker-only: MP4 streamed by the integrity service, exact persisted references and a second remote check. */
async function executeActiveConformanceJob(params: ConformanceJobExecutionInput,
  integrity: ConformanceIntegrityAdapters, evidence: typeof defaultEvidence, assertActive: () => void) {
  assertActive();
  const claim = conformanceJobClaimSchema.parse(params.claim);
  resolveExportedColorTagPolicyId(params.colorTagPolicyId);
  const directory = await mkdtemp(join(tmpdir(), "composition-conformance-job-"));
  const videoPath = join(directory, "final.mp4");
  const renderReceiptPath = join(directory, "receipt.json");
  const scope = { supabase: params.supabase, supabaseUrl: params.supabaseUrl,
    organizationId: claim.organization_id, requestId: claim.request_id, signal: params.signal };
  const preparation = { ...scope, revisionId: claim.revision_id, outputParentDirectory: directory };
  let stage: ConformanceExecutionStage = "REMOTE_SNAPSHOT";
  let primaryFailure: ConformanceStageFailure | undefined;
  try {
    assertActive();
    const before = integritySchema.parse(await integrity.snapshot({ ...scope, destinationPath: videoPath }));
    assertActive();
    stage = "PREVIEW_REFERENCE";
    const visual = await evidence.visual(preparation);
    assertActive();
    if (visual.documentHash !== before.documentHash || visual.organizationId !== scope.organizationId
      || visual.revisionId !== claim.revision_id) throw new Error("CONFORMANCE_JOB_REVISION_MISMATCH");
    stage = "AUDIO_REFERENCE";
    const audio = await evidence.audio({ ...preparation, visualChecksum: visual.checksum,
      ffmpegPath: params.ffmpegPath, allowLongAudio: params.allowLongAudio, capturePlaybackAudio: params.capturePlaybackAudio });
    assertActive();
    await writeFile(renderReceiptPath, JSON.stringify({ documentHash: before.documentHash, videoSha256: before.checksum }),
      { flag: "wx", mode: 0o600 });
    stage = "RENDER_COMPARISON";
    assertActive();
    const comparison = await evidence.compare({ ...preparation, checksum: visual.checksum, audioChecksum: audio.checksum,
      videoPath, renderReceiptPath, audioPolicyId: "course-v1",
      ...(params.colorTagPolicyId ? {colorTagPolicyId: params.colorTagPolicyId} : {}) });
    assertActive();
    if (params.colorTagPolicyId && comparison.report.colorTags?.policy !== params.colorTagPolicyId) {
      throw new Error("CONFORMANCE_JOB_COLOR_TAG_EVIDENCE_MISSING_INVALID");
    }
    if (params.capturePlaybackAudio === true && (audio.receipt?.schemaVersion !== 3 || comparison.audioReference.receipt?.schemaVersion !== 3 || !comparison.report.audioPlayback)) {
      throw new Error("CONFORMANCE_JOB_PLAYBACK_EVIDENCE_MISSING_INVALID");
    }
    if (comparison.reference.documentHash !== before.documentHash || comparison.reference.projectHash !== visual.projectHash
      || comparison.reference.organizationId !== scope.organizationId || comparison.reference.revisionId !== claim.revision_id
      || comparison.reference.checksum !== visual.checksum || comparison.audioReference.checksum !== audio.checksum) {
      throw new Error("CONFORMANCE_JOB_REFERENCE_MISMATCH");
    }
    const referenceContract = assertConformanceReportMatchesContract(comparison.reference.contract, comparison.report.visual,
      {videoSha256: before.checksum});
    if (referenceContract.documentHash !== before.documentHash)
      throw new Error("CONFORMANCE_JOB_CONTRACT_DOCUMENT_MISMATCH_INVALID");
    stage = "EVENT_COMPARISON";
    const eventResult = await evidence.events({...preparation, projectHash: visual.projectHash,
      documentHash: before.documentHash, videoSha256: before.checksum, videoPath, renderReceiptPath});
    assertActive();
    const events = eventResult === null ? undefined : eventBatchExecutionSummarySchema.parse(eventResult);
    if (events && events.projectHash !== visual.projectHash) throw new Error("CONFORMANCE_JOB_EVENT_PROJECT_MISMATCH");
    if (comparison.report.visual?.checkpointBatchCoverage && !events) throw new Error("CONFORMANCE_JOB_EVENT_EXECUTION_REQUIRED");
    const eventVisualCoverageGate = events ? evaluateEventVisualCoverageGate({root: comparison.report.visual, execution: events}) : undefined;
    const eventMeasurementGate = eventVisualCoverageGate ? evaluateEventMeasurementGate({comparison: comparison.report, visualCoverageGate: eventVisualCoverageGate}) : undefined;
    const status = evaluateConformanceJobStatus({comparisonStatus: comparison.report.status,
      eventStatus: events?.status, eventVisualCoverageStatus: eventVisualCoverageGate?.status, eventMeasurementStatus: eventMeasurementGate?.status});
    stage = "REMOTE_RECHECK";
    const after = integritySchema.parse(await integrity.recheck(scope));
    assertActive();
    if ((["assetId", "checksum", "documentHash", "sizeBytes"] as const).some((key) => before[key] !== after[key])) {
      throw new Error("CONFORMANCE_JOB_REMOTE_CHANGED_INVALID");
    }
    const { status: _integrityStatus, ...boundIntegrity } = before;
    stage = "REPORT_VALIDATION";
    return durableConformanceReportSchema.parse({ reportVersion: 1, scope: "REMOTE_INTEGRITY_AND_PERSISTED_CONFORMANCE",
      status, organizationId: scope.organizationId, requestId: scope.requestId, revisionId: claim.revision_id,
      attemptBinding: bindConformanceReportToAttempt(claim),
      integrity: boundIntegrity, references: { visualChecksum: visual.checksum, audioChecksum: audio.checksum },
      comparison: {...comparison.report, status, ...(events ? {preEventComparisonStatus: comparison.report.status} : {})},
      ...(events ? {eventCheckpointExecution: events} : {}),
      ...(eventVisualCoverageGate ? {eventVisualCoverageGate} : {}),
      ...(eventMeasurementGate ? {eventMeasurementGate} : {}),
      limitations: [params.capturePlaybackAudio === true ? "BROWSER_AUDIO_GRAPH_NOT_PHYSICAL_OUTPUT" : "SOURCE_AUDIO_MODEL_NOT_PLAYBACK_CAPTURE", "AUDIO_ENVELOPE_NOT_CONTENT_IDENTITY",
        ...(comparison.report.visual?.fontUsage ? [comparison.report.visual.fontUsage.reason] : []),
        ...(referenceContract.schemaVersion === 4 && referenceContract.colorTagPolicy ? ["SDR_PIXEL_CONVERSION_UNATTESTED"] : []),
        "NOT_A_SIGNED_ATTESTATION", "REMOTE_OBJECT_CAN_CHANGE_AFTER_CHECK", "NOT_QA_OR_PUBLICATION_APPROVAL"] });
  } catch (error) {
    // Map cancellation caused by this budget to an operational timeout, not invalid input.
    if (params.signal?.aborted && (!(error instanceof ConformanceStageFailure) || error.retryable)) {
      try {assertActive();} catch (budgetError) {error = budgetError;}
    }
    primaryFailure = wrapConformanceStageFailure(stage, error); throw primaryFailure;
  } finally {
    const cleanups = await Promise.allSettled([rm(videoPath, { force: true }), rm(renderReceiptPath, { force: true })]);
    if (cleanups.some((result) => result.status === "rejected")) throw recordConformanceCleanupFailure(primaryFailure);
    // Never recursively remove unknown files left by another stage; surface failed stage cleanup.
    try { await rmdir(directory); } catch { throw recordConformanceCleanupFailure(primaryFailure); }
  }
}
