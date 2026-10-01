import { z } from "zod";
import { createHash } from "node:crypto";
import { compareVideoWithPersistedVisualReference } from "./composition-persisted-reference-comparison";
import { eventBatchMeasurementIdentitySchema, eventBatchMeasurementPacketSchema } from "./composition-conformance-event-batch-execution";
import { eventBatchCaptureLineageSchema } from "../composition-conformance-event-batch-lineage";
import { compositionConformanceContractSchema, type CompositionConformanceContract } from "../composition-preview-render-conformance";

/** Trusted worker adapter: measure the locally integrity-bound MP4 against one private authorized capture. */
export async function measureCompositionEventBatchWithPersistedReference(input: {
  identity: z.infer<typeof eventBatchMeasurementIdentitySchema>; contract: CompositionConformanceContract;
  comparison: Omit<Parameters<typeof compareVideoWithPersistedVisualReference>[0],
    "organizationId" | "revisionId" | "eventBatchIndex" | "includeVisualMeasurements">;
}, compare = compareVideoWithPersistedVisualReference) {
  const identity = eventBatchMeasurementIdentitySchema.parse(input.identity);
  const comparison = {...input.comparison};
  const contract = compositionConformanceContractSchema.parse(input.contract);
  if (contract.schemaVersion !== 4 || !contract.checkpointBatch || contract.documentHash !== identity.documentHash
    || createHash("sha256").update(JSON.stringify(contract)).digest("hex") !== identity.batchContractSha256
    || JSON.stringify(contract.checkpointBatch) !== JSON.stringify(identity.batch)) throw new Error("CONFORMANCE_EVENT_MEASUREMENT_CONTRACT_REQUIRED");
  const expectedLineage = eventBatchCaptureLineageSchema.parse({policy: "VERIFIED_ROOT_EVENT_PARTITION_V1", scope: "ONE_PREVIEW_PARTITION_NOT_GLOBAL_RENDER_ATTESTATION",
    parentContractSha256: identity.parentContractSha256, batchContractSha256: identity.batchContractSha256, batch: identity.batch});
  const result = await compare({...comparison, organizationId: identity.organizationId, revisionId: identity.revisionId,
    eventBatchIndex: identity.batch.batchIndex, includeVisualMeasurements: true});
  const lineage = eventBatchCaptureLineageSchema.safeParse(result.reference.eventBatchLineage);
  if (result.reference.organizationId !== identity.organizationId || result.reference.revisionId !== identity.revisionId
    || result.reference.projectHash !== identity.projectHash || result.reference.documentHash !== identity.documentHash
    || result.reference.checksum !== comparison.checksum || result.report.video.sha256 !== identity.videoSha256
    || result.report.documentHash !== identity.documentHash || !lineage.success || JSON.stringify(lineage.data) !== JSON.stringify(expectedLineage)) {
    throw new Error("CONFORMANCE_EVENT_MEASUREMENT_PROVENANCE_MISMATCH");
  }
  if (!result.report.visualMeasurements) throw new Error("CONFORMANCE_EVENT_MEASUREMENT_SAMPLES_REQUIRED");
  if (result.report.visualMeasurements.previewDocumentHash !== identity.documentHash
    || result.report.visualMeasurements.renderDocumentHash !== identity.documentHash) {
    throw new Error("CONFORMANCE_EVENT_MEASUREMENT_DOCUMENT_MISMATCH");
  }
  return eventBatchMeasurementPacketSchema.parse({schemaVersion: 1, scope: "EVENT_VISUAL_SAMPLE_PACKET_NOT_INDEPENDENT_ATTESTATION",
    identity, previewDocumentHash: result.report.visualMeasurements.previewDocumentHash,
    renderDocumentHash: result.report.visualMeasurements.renderDocumentHash, samples: result.report.visualMeasurements.samples,
    ...(result.report.visualMeasurements.renderColorTags ? {renderColorTags: result.report.visualMeasurements.renderColorTags} : {})});
}
