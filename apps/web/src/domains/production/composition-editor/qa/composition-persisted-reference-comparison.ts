import { readPersistedVisualConformanceEvidence } from "./composition-conformance-evidence-reader";
import { compareExportedVideoWithPreview } from "./composition-exported-video-conformance";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";
import {requiresControlledExecutorIntervention} from "./composition-controlled-execution-fence";

const defaultDependencies = { readReference: readPersistedVisualConformanceEvidence, compare: compareExportedVideoWithPreview };
type VideoComparisonInput = Pick<Parameters<typeof compareExportedVideoWithPreview>[0], "videoPath" | "renderReceiptPath" | "audioPolicyId" | "colorTagPolicyId" | "audioReferencePath" | "audioReferenceMetadataPath" | "includeVisualMeasurements" | "signal" | "processPorts">;

/** Worker-only comparison. The video/receipt must separately pass the remote integrity gate; this service authenticates only the visual reference. */
export async function compareVideoWithPersistedVisualReference(
  params: Parameters<typeof readPersistedVisualConformanceEvidence>[0] & VideoComparisonInput,
  dependencies: typeof defaultDependencies = defaultDependencies,
) {
  assertConformanceJobActive(params.signal);
  if (Boolean(params.audioReferencePath) !== Boolean(params.audioReferenceMetadataPath)) throw new Error("EXPORTED_AUDIO_REFERENCE_ARGUMENTS_INVALID");
  const reference = await dependencies.readReference(params);
  let terminationUnconfirmed = false;
  try {
    assertConformanceJobActive(params.signal);
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
    return { reference: { organizationId: reference.receipt.organizationId, revisionId: reference.receipt.revisionId,
      projectHash: reference.receipt.projectHash, documentHash: reference.receipt.documentHash,
      contract: reference.contract,
      ...(reference.receipt.eventBatchLineage ? {eventBatchLineage: reference.receipt.eventBatchLineage} : {}),
      checksum: reference.checksum, status: reference.status, provenance: "SCOPED_WORKER_VISUAL_EVIDENCE" as const }, report };
  } catch (error) {
    terminationUnconfirmed = error instanceof Error && requiresControlledExecutorIntervention(error.message);
    throw error;
  } finally {
    if (!terminationUnconfirmed) {
      try { await reference.cleanup(); }
      catch { throw new Error("CONFORMANCE_COMPARISON_CLEANUP_FAILED"); }
    }
  }
}
