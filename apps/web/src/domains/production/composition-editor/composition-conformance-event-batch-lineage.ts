import { createHash } from "node:crypto";
import { z } from "zod";
import { eventCheckpointBatchSchema, eventBatchAuthorizationManifestSchema } from "./composition-conformance-batch-contract";
import { compositionConformanceContractSchema } from "./composition-preview-render-conformance";
import { prepareCompositionEventBatchContracts } from "./composition-conformance-event-batch-contract";
import type { CompositionEditorDocument } from "./composition-document.types";

const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const eventBatchCaptureLineageSchema = z.object({
  policy: z.literal("VERIFIED_ROOT_EVENT_PARTITION_V1"),
  scope: z.literal("ONE_PREVIEW_PARTITION_NOT_GLOBAL_RENDER_ATTESTATION"),
  parentContractSha256: digestSchema, batchContractSha256: digestSchema,
  batch: eventCheckpointBatchSchema,
}).strict();

/** A caller-supplied root is not authorization; private readers must obtain it from the scoped revision. */
export function assertEventBatchCaptureLineage(lineage: unknown, contractInput: unknown,
  authorizedSource?: {document: CompositionEditorDocument; parentContract: unknown},
  authorizedRevision?: {parentContract: unknown; batchAuthorization: unknown}) {
  const contract = compositionConformanceContractSchema.parse(contractInput);
  const batch = contract.schemaVersion === 4 ? contract.checkpointBatch : undefined;
  if (!batch) {
    if (lineage !== undefined) throw new Error("CONFORMANCE_EVENT_CAPTURE_UNEXPECTED_LINEAGE");
    return;
  }
  if (lineage === undefined) throw new Error("CONFORMANCE_EVENT_CAPTURE_LINEAGE_MISSING");
  const parsed = eventBatchCaptureLineageSchema.parse(lineage);
  if (parsed.batchContractSha256 !== sha256(contract) || JSON.stringify(parsed.batch) !== JSON.stringify(batch)) {
    throw new Error("CONFORMANCE_EVENT_CAPTURE_LINEAGE_MISMATCH");
  }
  if (authorizedSource) {
    const prepared = prepareCompositionEventBatchContracts({document: authorizedSource.document,
      parentContract: compositionConformanceContractSchema.parse(authorizedSource.parentContract)});
    const expected = prepared.select(batch.batchIndex);
    if (parsed.parentContractSha256 !== prepared.parentContractSha256
      || parsed.batchContractSha256 !== expected.batchContractSha256) {
      throw new Error("CONFORMANCE_EVENT_CAPTURE_PARENT_MISMATCH");
    }
  } else if (authorizedRevision) {
    const parent = compositionConformanceContractSchema.parse(authorizedRevision.parentContract);
    const authorization = eventBatchAuthorizationManifestSchema.parse(authorizedRevision.batchAuthorization);
    if (parent.schemaVersion !== 4 || !parent.checkpointBatch || parent.checkpointBatch.batchIndex !== 0
      || sha256(parent) !== authorization.parentContractSha256
      || parent.documentHash !== authorization.documentHash || contract.documentHash !== authorization.documentHash
      || JSON.stringify(parent.checkpointBatch) !== JSON.stringify(authorization.rootBatch)
      || parsed.parentContractSha256 !== authorization.parentContractSha256
      || JSON.stringify({...batch, batchIndex: 0}) !== JSON.stringify(authorization.rootBatch)
      || parsed.batchContractSha256 !== authorization.batchContractSha256[batch.batchIndex]) {
      throw new Error("CONFORMANCE_EVENT_CAPTURE_AUTHORIZATION_MISMATCH");
    }
  } else if (batch.batchIndex !== 0) {
    throw new Error("CONFORMANCE_EVENT_CAPTURE_AUTHORIZED_PARENT_REQUIRED");
  } else if (parsed.parentContractSha256 !== parsed.batchContractSha256) {
    throw new Error("CONFORMANCE_EVENT_CAPTURE_PARENT_MISMATCH");
  }
}
