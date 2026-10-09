import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import {createHash} from "node:crypto";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { prepareAndPersistVisualConformanceReference } from "./composition-conformance-reference-pipeline";
import { prepareAndPersistAudioConformanceReference } from "./composition-audio-evidence-pipeline";
import { compareVideoWithPersistedConformanceReferences, compareVideoWithPersistedSilentReference } from "./composition-persisted-audio-comparison";
import {assertSilentConformanceMeasurement} from "./composition-silent-conformance-gate";
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
import type {ComparisonProcessPorts} from "./composition-comparison-process-ports";
import {requiresConformanceExecutionRecovery} from "./composition-conformance-stage-failure";
import {recoverConformanceRenderEvidence, type ConformanceRenderEvidenceReservation} from "./composition-conformance-render-evidence";
import {bindConformanceReferenceReservation} from "./composition-conformance-reference-reservation";
import {controlledReferenceSelectionSchema} from "./composition-controlled-reference-selection";
import {readConformanceCheckpointReservation, type ConformanceCheckpointReservation} from "./composition-conformance-checkpoint-reservation";

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
type ConformanceEvidenceAdapters = typeof defaultEvidence & {compareSilent?: typeof compareVideoWithPersistedSilentReference};

type ConformanceJobExecutionInput = {
  claim: ConformanceJobClaim; supabase: SupabaseClient<any, any, any>; supabaseUrl: string; ffmpegPath: string; allowLongAudio?: boolean; capturePlaybackAudio?: boolean;
  colorTagPolicyId?: ExportedColorTagPolicyId;
  signal?: AbortSignal;
  processPorts?: ComparisonProcessPorts;
  controlledRenderEvidence?: ConformanceRenderEvidenceReservation;
  referenceSelection?: z.input<typeof controlledReferenceSelectionSchema>;
  checkpointReservation?: ConformanceCheckpointReservation;
  /** Host opt-in only after the prepared V2 database gate is installed. No automatic negotiation. */
  enableSilentDurableReports?: boolean;
  reservationEvidence?: z.input<typeof durableConformanceReportSchema>["reservationEvidence"];
  resolveRenderReservation?: (claim: ConformanceJobClaim, signal: AbortSignal) => Promise<{
    controlledRenderEvidence: ConformanceRenderEvidenceReservation;
    referenceSelection: z.input<typeof controlledReferenceSelectionSchema>;
    processPorts: ComparisonProcessPorts;
    reservationEvidence: NonNullable<z.input<typeof durableConformanceReportSchema>["reservationEvidence"]>;
  }>;
};

export const CONFORMANCE_JOB_EXECUTION_POLICY = Object.freeze({
  id: "WHOLE_CONFORMANCE_EXECUTION_BUDGET_V1",
  timeoutMilliseconds: CONTROLLED_RENDER_DEADLINE_POLICY.maximumMilliseconds,
});

/** Includes preparation, all partitions, remote recheck and owned cleanup; no per-stage reset.
 * Waits for adapter ownership before cleanup: a logical timeout is not OS termination. */
export async function executeConformanceJob(params: ConformanceJobExecutionInput,
  integrity: ConformanceIntegrityAdapters, evidence: ConformanceEvidenceAdapters = defaultEvidence,
  budgetOptions: {timeoutMilliseconds?: number; clock?: () => number} = {}) {
  assertConformanceJobActive(params.signal);
  if ((params.controlledRenderEvidence || params.checkpointReservation) && !params.processPorts)
    throw new Error("CONFORMANCE_JOB_CONTROLLED_PROCESS_PORTS_REQUIRED_INVALID");
  if (params.referenceSelection && !params.controlledRenderEvidence)
    throw new Error("CONFORMANCE_JOB_REFERENCE_RESERVATION_AUTHORITY_REQUIRED_INVALID");
  if (params.checkpointReservation && (params.controlledRenderEvidence || params.referenceSelection))
    throw new Error("CONFORMANCE_JOB_CHECKPOINT_RESERVATION_AMBIGUOUS_INVALID");
  if (params.resolveRenderReservation && (params.controlledRenderEvidence || params.referenceSelection
    || params.checkpointReservation || params.processPorts || params.reservationEvidence))
    throw new Error("CONFORMANCE_JOB_DURABLE_RESERVATION_AMBIGUOUS_INVALID");
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
    let reserved: Awaited<ReturnType<typeof readConformanceCheckpointReservation>> | undefined;
    let durable: Awaited<ReturnType<NonNullable<ConformanceJobExecutionInput["resolveRenderReservation"]>>> | undefined;
    if (params.resolveRenderReservation) {
      try {durable = await params.resolveRenderReservation(conformanceJobClaimSchema.parse(params.claim), budget.signal);}
      catch (error) {throw wrapConformanceStageFailure("RENDER_EVIDENCE_ADMISSION", error);}
      assertActive();
      if (!durable?.controlledRenderEvidence || !durable.referenceSelection || !durable.reservationEvidence
        || !durable.processPorts || typeof durable.processPorts.execute !== "function"
        || typeof durable.processPorts.consumePcm !== "function"
        || typeof durable.processPorts.pixelDecoderPath !== "string" || !isAbsolute(durable.processPorts.pixelDecoderPath)
        || typeof durable.processPorts.probePath !== "string" || !isAbsolute(durable.processPorts.probePath))
        throw new Error("CONFORMANCE_JOB_DURABLE_RESERVATION_CONFIGURATION_INVALID");
    }
    if (params.checkpointReservation) {
      try {reserved = await readConformanceCheckpointReservation(params.checkpointReservation,
        conformanceJobClaimSchema.parse(params.claim), budget.signal);}
      catch (error) {throw wrapConformanceStageFailure("RENDER_EVIDENCE_ADMISSION", error);}
      assertActive();
    }
    const result = await executeActiveConformanceJob({...params, ...reserved, ...durable, signal: budget.signal}, integrity, evidence, assertActive);
    try {assertActive();} catch (error) {throw wrapConformanceStageFailure("RESOURCE_CLEANUP", error);}
    return result;
  } finally {budget.dispose();}
}

/** Worker-only: MP4 streamed by the integrity service, exact persisted references and a second remote check. */
async function executeActiveConformanceJob(params: ConformanceJobExecutionInput,
  integrity: ConformanceIntegrityAdapters, evidence: ConformanceEvidenceAdapters, assertActive: () => void) {
  assertActive();
  const claim = conformanceJobClaimSchema.parse(params.claim);
  const controlledReservation = params.controlledRenderEvidence ? structuredClone(params.controlledRenderEvidence) : undefined;
  const referenceSelection = params.referenceSelection ? controlledReferenceSelectionSchema.parse(params.referenceSelection) : undefined;
  resolveExportedColorTagPolicyId(params.colorTagPolicyId);
  const directory = await mkdtemp(join(tmpdir(), "composition-conformance-job-"));
  const videoPath = join(directory, "final.mp4");
  const renderReceiptPath = join(directory, "receipt.json");
  const ownedReceiptPaths = [renderReceiptPath];
  const scope = { supabase: params.supabase, supabaseUrl: params.supabaseUrl,
    organizationId: claim.organization_id, requestId: claim.request_id, signal: params.signal };
  const preparation = { ...scope, revisionId: claim.revision_id, outputParentDirectory: directory };
  let stage: ConformanceExecutionStage = "REMOTE_SNAPSHOT";
  let primaryFailure: ConformanceStageFailure | undefined;
  try {
    assertActive();
    const before = integritySchema.parse(await integrity.snapshot({ ...scope, destinationPath: videoPath }));
    assertActive();
    stage = "RENDER_EVIDENCE_ADMISSION";
    const controlledEvidence = controlledReservation ? await recoverConformanceRenderEvidence({
      supabase: params.supabase, reservation: controlledReservation,
      jobScope: {...scope, revisionId: claim.revision_id}, integrity: before, videoPath, signal: params.signal,
    }) : undefined;
    assertActive();
    if (params.reservationEvidence && (!controlledEvidence
      || params.reservationEvidence.executionId !== controlledEvidence.binding.executionId
      || params.reservationEvidence.supervisorReceiptSha256 !== controlledEvidence.supervisorReceiptSha256))
      throw new Error("CONFORMANCE_JOB_DURABLE_RESERVATION_BINDING_INVALID");
    const referenceReservation = controlledReservation && controlledEvidence && referenceSelection
      ? bindConformanceReferenceReservation(controlledReservation, controlledEvidence, referenceSelection) : undefined;
    const selectedRoot = referenceReservation?.selection.references[0];
    const silent = Boolean(selectedRoot && !selectedRoot.audioChecksum);
    if (silent && params.enableSilentDurableReports !== true)
      throw new Error("CONFORMANCE_JOB_SILENT_RESERVED_REPORT_UNSUPPORTED");
    if (silent && params.capturePlaybackAudio) throw new Error("CONFORMANCE_JOB_SILENT_PLAYBACK_INVALID");
    const receiptPaths = new Map<number, {contractSha256: string; path: string; sha256: string}>();
    if (controlledEvidence) {
      for (const batch of controlledEvidence.batches) {
        const path = batch.batchIndex === 0 ? renderReceiptPath : join(directory, `receipt-batch-${batch.batchIndex}.json`);
        if (batch.batchIndex !== 0) ownedReceiptPaths.push(path);
        await writeFile(path, JSON.stringify(batch.receipt), {flag: "wx", mode: 0o600});
        receiptPaths.set(batch.batchIndex, {contractSha256: batch.contractSha256, path, sha256: batch.receiptSha256});
      }
    }
    const resolveRenderReceipt = controlledEvidence ? (contractSha256: string, batchIndex: number) => {
      const selected = receiptPaths.get(batchIndex);
      if (!selected || selected.contractSha256 !== contractSha256)
        throw new Error("CONFORMANCE_JOB_RENDER_EVIDENCE_BATCH_MISMATCH");
      return {path: selected.path, sha256: selected.sha256};
    } : undefined;
    stage = "PREVIEW_REFERENCE";
    const visual = selectedRoot && controlledEvidence ? {documentHash: before.documentHash,
      projectHash: controlledEvidence.projectHash, organizationId: scope.organizationId, revisionId: claim.revision_id,
      checksum: selectedRoot.visualChecksum} : await evidence.visual(preparation);
    assertActive();
    if (visual.documentHash !== before.documentHash || visual.organizationId !== scope.organizationId
      || visual.revisionId !== claim.revision_id) throw new Error("CONFORMANCE_JOB_REVISION_MISMATCH");
    if (controlledEvidence && visual.projectHash !== controlledEvidence.projectHash)
      throw new Error("CONFORMANCE_JOB_RENDER_EVIDENCE_PROJECT_MISMATCH");
    stage = "AUDIO_REFERENCE";
    const audio = silent ? undefined : selectedRoot ? {checksum: selectedRoot.audioChecksum!, receipt: undefined}
      : await evidence.audio({ ...preparation, visualChecksum: visual.checksum,
        ffmpegPath: params.ffmpegPath, allowLongAudio: params.allowLongAudio, capturePlaybackAudio: params.capturePlaybackAudio });
    assertActive();
    if (!controlledEvidence) await writeFile(renderReceiptPath,
      JSON.stringify({ documentHash: before.documentHash, videoSha256: before.checksum }), { flag: "wx", mode: 0o600 });
    stage = "RENDER_COMPARISON";
    assertActive();
    const comparisonInput = { ...preparation, checksum: visual.checksum,
      videoPath, renderReceiptPath, audioPolicyId: "course-v1", processPorts: params.processPorts,
      ...(referenceReservation && controlledReservation?.artifacts.kind === "EVENT_BATCH_SET" ? {eventBatchIndex: 0} : {}),
      ...(controlledEvidence ? {expectedContractSha256: controlledEvidence.batches[0]!.contractSha256,
        expectedRenderReceiptSha256: controlledEvidence.batches[0]!.receiptSha256} : {}),
      ...(params.colorTagPolicyId ? {colorTagPolicyId: params.colorTagPolicyId} : {}) } as const;
    const comparison = silent
      ? {...await (evidence.compareSilent ?? compareVideoWithPersistedSilentReference)(comparisonInput), audioReference: undefined}
      : await evidence.compare({...comparisonInput, audioChecksum: audio!.checksum});
    assertActive();
    if (params.colorTagPolicyId && comparison.report.colorTags?.policy !== params.colorTagPolicyId) {
      throw new Error("CONFORMANCE_JOB_COLOR_TAG_EVIDENCE_MISSING_INVALID");
    }
    if (params.capturePlaybackAudio === true && (!selectedRoot && audio?.receipt?.schemaVersion !== 3
      || comparison.audioReference?.receipt?.schemaVersion !== 3
      || !("audioPlayback" in comparison.report) || !comparison.report.audioPlayback)) {
      throw new Error("CONFORMANCE_JOB_PLAYBACK_EVIDENCE_MISSING_INVALID");
    }
    if (comparison.reference.documentHash !== before.documentHash || comparison.reference.projectHash !== visual.projectHash
      || comparison.reference.organizationId !== scope.organizationId || comparison.reference.revisionId !== claim.revision_id
      || comparison.reference.checksum !== visual.checksum || comparison.audioReference?.checksum !== audio?.checksum) {
      throw new Error("CONFORMANCE_JOB_REFERENCE_MISMATCH");
    }
    const referenceContract = assertConformanceReportMatchesContract(comparison.reference.contract, comparison.report.visual,
      {videoSha256: before.checksum});
    if (silent) assertSilentConformanceMeasurement(referenceContract, comparison.report);
    if (controlledEvidence && createHash("sha256").update(JSON.stringify(referenceContract), "utf8").digest("hex")
      !== controlledEvidence.batches[0]!.contractSha256)
      throw new Error("CONFORMANCE_JOB_RENDER_EVIDENCE_CONTRACT_MISMATCH");
    if (referenceContract.documentHash !== before.documentHash)
      throw new Error("CONFORMANCE_JOB_CONTRACT_DOCUMENT_MISMATCH_INVALID");
    stage = "EVENT_COMPARISON";
    const eventResult = await evidence.events({...preparation, projectHash: visual.projectHash,
      documentHash: before.documentHash, videoSha256: before.checksum, videoPath, renderReceiptPath,
      processPorts: params.processPorts, resolveRenderReceipt,
      visualReferenceChecksums: referenceReservation?.selection.references.map(reference => reference.visualChecksum)});
    assertActive();
    const events = eventResult === null ? undefined : eventBatchExecutionSummarySchema.parse(eventResult);
    if (events && events.projectHash !== visual.projectHash) throw new Error("CONFORMANCE_JOB_EVENT_PROJECT_MISMATCH");
    if (comparison.report.visual?.checkpointBatchCoverage && !events) throw new Error("CONFORMANCE_JOB_EVENT_EXECUTION_REQUIRED");
    const eventVisualCoverageGate = events ? evaluateEventVisualCoverageGate({root: comparison.report.visual, execution: events}) : undefined;
    const eventMeasurementGate = eventVisualCoverageGate ? evaluateEventMeasurementGate({comparison: comparison.report, visualCoverageGate: eventVisualCoverageGate}) : undefined;
    const status = evaluateConformanceJobStatus({comparisonStatus: comparison.report.status,
      eventStatus: events?.status, eventVisualCoverageStatus: eventVisualCoverageGate?.status, eventMeasurementStatus: eventMeasurementGate?.status});
    if (controlledEvidence && controlledReservation) {
      stage = "RENDER_EVIDENCE_ADMISSION";
      const refreshed = await recoverConformanceRenderEvidence({supabase: params.supabase,
        reservation: controlledReservation, jobScope: {...scope, revisionId: claim.revision_id},
        integrity: before, videoPath, signal: params.signal});
      if (refreshed.supervisorReceiptSha256 !== controlledEvidence.supervisorReceiptSha256)
        throw new Error("CONFORMANCE_JOB_RENDER_EVIDENCE_CHANGED_INVALID");
      assertActive();
    }
    stage = "REMOTE_RECHECK";
    const after = integritySchema.parse(await integrity.recheck(scope));
    assertActive();
    if ((["assetId", "checksum", "documentHash", "sizeBytes"] as const).some((key) => before[key] !== after[key])) {
      throw new Error("CONFORMANCE_JOB_REMOTE_CHANGED_INVALID");
    }
    const { status: _integrityStatus, ...boundIntegrity } = before;
    stage = "REPORT_VALIDATION";
    return durableConformanceReportSchema.parse({ reportVersion: silent ? 2 : 1, scope: "REMOTE_INTEGRITY_AND_PERSISTED_CONFORMANCE",
      status, organizationId: scope.organizationId, requestId: scope.requestId, revisionId: claim.revision_id,
      attemptBinding: bindConformanceReportToAttempt(claim),
      ...(controlledEvidence ? {renderEvidence: {scope: controlledEvidence.scope,
        binding: controlledEvidence.binding, supervisorReceiptSha256: controlledEvidence.supervisorReceiptSha256}} : {}),
      ...(referenceReservation ? {referenceSelection: referenceReservation.selection} : {}),
      ...(params.reservationEvidence ? {reservationEvidence: params.reservationEvidence} : {}),
      ...(silent ? {audioExpectation: {policy: "FROZEN_NO_AUDIO_TRACK_V1", contractSha256: controlledEvidence!.binding.contractSha256}} : {}),
      integrity: boundIntegrity, references: { visualChecksum: visual.checksum, ...(audio ? {audioChecksum: audio.checksum} : {}) },
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
    if (!requiresConformanceExecutionRecovery(error) && params.signal?.aborted && (!(error instanceof ConformanceStageFailure) || error.retryable)) {
      try {assertActive();} catch (budgetError) {error = budgetError;}
    }
    primaryFailure = wrapConformanceStageFailure(stage, error); throw primaryFailure;
  } finally {
    if (!requiresConformanceExecutionRecovery(primaryFailure)) {
      const cleanups = await Promise.allSettled([videoPath, ...ownedReceiptPaths].map(path => rm(path, { force: true })));
      if (cleanups.some((result) => result.status === "rejected")) throw recordConformanceCleanupFailure(primaryFailure);
      // Never recursively remove unknown files left by another stage; surface failed stage cleanup.
      try { await rmdir(directory); } catch { throw recordConformanceCleanupFailure(primaryFailure); }
    }
  }
}
