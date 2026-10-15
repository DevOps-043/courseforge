import { readPersistedVisualConformanceEvidence } from "./composition-conformance-evidence-reader";
import { compareExportedVideoWithPreview } from "./composition-exported-video-conformance";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";
import {requiresConformanceExecutionRecovery} from "./composition-conformance-stage-failure";
import {createHash} from "node:crypto";
import {pinConformanceFile, assertConformanceFileUnchanged} from "./composition-conformance-file-integrity";
import {CONTROLLED_RENDER_CHECKPOINT_POLICY} from "./composition-render-checkpoint";
import {assertSilentConformanceContract, assertSilentConformanceMeasurement} from "./composition-silent-conformance-gate";

const defaultDependencies = { readReference: readPersistedVisualConformanceEvidence, compare: compareExportedVideoWithPreview };
type VideoComparisonInput = Pick<Parameters<typeof compareExportedVideoWithPreview>[0], "videoPath" | "renderReceiptPath" | "audioPolicyId" | "colorTagPolicyId" | "audioReferencePath" | "audioReferenceMetadataPath" | "includeVisualMeasurements" | "signal" | "processPorts">;

/** Worker-only comparison. The video/receipt must separately pass the remote integrity gate; this service authenticates only the visual reference. */
export async function compareVideoWithPersistedVisualReference(
  params: Parameters<typeof readPersistedVisualConformanceEvidence>[0] & VideoComparisonInput
    & {expectedContractSha256?: string; expectedRenderReceiptSha256?: string; audioExpectation?: "NOT_REQUIRED"},
  dependencies: typeof defaultDependencies = defaultDependencies,
) {
  assertConformanceJobActive(params.signal);
  if (Boolean(params.audioReferencePath) !== Boolean(params.audioReferenceMetadataPath)) throw new Error("EXPORTED_AUDIO_REFERENCE_ARGUMENTS_INVALID");
  const reference = await dependencies.readReference(params);
  let terminationUnconfirmed = false;
  try {
    assertConformanceJobActive(params.signal);
    if (params.audioExpectation === "NOT_REQUIRED") {
      assertSilentConformanceContract(reference.contract);
      if (params.audioReferencePath || params.audioReferenceMetadataPath)
        throw new Error("CONFORMANCE_SILENT_AUDIO_REFERENCE_INVALID");
    }
    if (params.expectedContractSha256 !== undefined
      && (!/^[a-f0-9]{64}$/.test(params.expectedContractSha256)
        || createHash("sha256").update(JSON.stringify(reference.contract), "utf8").digest("hex") !== params.expectedContractSha256))
      throw new Error("CONFORMANCE_COMPARISON_AUTHORIZED_CONTRACT_MISMATCH");
    const receiptPin = params.expectedRenderReceiptSha256 === undefined ? undefined
      : await pinConformanceFile(params.renderReceiptPath, CONTROLLED_RENDER_CHECKPOINT_POLICY.maximumBytes);
    if (receiptPin && receiptPin.sha256 !== params.expectedRenderReceiptSha256)
      throw new Error("CONFORMANCE_COMPARISON_AUTHORIZED_RECEIPT_MISMATCH");
    const report = await dependencies.compare({ videoPath: params.videoPath, renderReceiptPath: params.renderReceiptPath,
      audioPolicyId: params.audioPolicyId, contractPath: reference.contractPath,
      previewDirectory: reference.previewDirectory, previewMetadataPath: reference.previewMetadataPath,
      ...(params.signal ? {signal: params.signal} : {}),
      ...(params.processPorts ? {processPorts: params.processPorts} : {}),
      ...(params.includeVisualMeasurements === true ? {includeVisualMeasurements: true} : {}),
      ...(params.colorTagPolicyId ? {colorTagPolicyId: params.colorTagPolicyId} : {}),
      ...(params.audioReferencePath ? { audioReferencePath: params.audioReferencePath } : {}),
      ...(params.audioReferenceMetadataPath ? { audioReferenceMetadataPath: params.audioReferenceMetadataPath } : {}) });
    assertConformanceJobActive(params.signal);
    if (receiptPin) await assertConformanceFileUnchanged(params.renderReceiptPath, receiptPin, CONTROLLED_RENDER_CHECKPOINT_POLICY.maximumBytes);
    if (params.audioExpectation === "NOT_REQUIRED") assertSilentConformanceMeasurement(reference.contract, report);
    return { reference: { organizationId: reference.receipt.organizationId, revisionId: reference.receipt.revisionId,
      projectHash: reference.receipt.projectHash, documentHash: reference.receipt.documentHash,
      contract: reference.contract,
      ...(reference.receipt.eventBatchLineage ? {eventBatchLineage: reference.receipt.eventBatchLineage} : {}),
      checksum: reference.checksum, status: reference.status, provenance: "SCOPED_WORKER_VISUAL_EVIDENCE" as const }, report };
  } catch (error) {
    terminationUnconfirmed = requiresConformanceExecutionRecovery(error);
    throw error;
  } finally {
    if (!terminationUnconfirmed) {
      try { await reference.cleanup(); }
      catch { throw new Error("CONFORMANCE_COMPARISON_CLEANUP_FAILED"); }
    }
  }
}
