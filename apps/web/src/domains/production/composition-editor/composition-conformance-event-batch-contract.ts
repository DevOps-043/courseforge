import { createHash } from "node:crypto";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "./composition-document.types";
import { hashCompositionDocument } from "./composition-document.service";
import { buildCompositionEventCheckpointPlan } from "./composition-conformance-event-checkpoints";
import { compositionConformanceContractSchema, type CompositionConformanceContract } from "./composition-preview-render-conformance";
import { buildTextParityCheckpointPlans } from "./composition-text-checkpoint-plan";
import { eventBatchAuthorizationManifestSchema } from "./composition-conformance-batch-contract";

const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Server-only: derive partitions from one verified root without changing its frozen obligations. */
export function prepareCompositionEventBatchContracts(input: {
  document: CompositionEditorDocument; parentContract: CompositionConformanceContract;
}) {
  const document = compositionEditorDocumentSchema.parse(input.document);
  const parent = compositionConformanceContractSchema.parse(input.parentContract);
  if (parent.schemaVersion !== 4 || !parent.checkpointPolicy || !parent.checkpointBatch
    || parent.checkpointBatch.batchIndex !== 0 || parent.documentHash !== hashCompositionDocument(document)) {
    throw new Error("CONFORMANCE_EVENT_EXECUTION_PARENT_INVALID");
  }
  const plan = buildCompositionEventCheckpointPlan(document);
  const planSha256 = sha256(plan);
  if (planSha256 !== parent.checkpointBatch.planSha256 || plan.batches.length !== parent.checkpointBatch.batchCount
    || plan.checkpointCount !== parent.checkpointBatch.totalCheckpointCount
    || JSON.stringify(plan.batches[0]) !== JSON.stringify(parent.checkpoints)) {
    throw new Error("CONFORMANCE_EVENT_EXECUTION_PLAN_MISMATCH");
  }
  const textPlans = (checkpoints: typeof parent.checkpoints) =>
    buildTextParityCheckpointPlans(document, checkpoints, parent.textParity.visibilityPolicy ?? false);
  if (JSON.stringify(textPlans(parent.checkpoints)) !== JSON.stringify(parent.textParity.checkpoints)) {
    throw new Error("CONFORMANCE_EVENT_EXECUTION_TEXT_MISMATCH");
  }
  return {
    documentHash: parent.documentHash, parentContractSha256: sha256(parent), planSha256,
    batchCount: plan.batches.length, checkpointCount: plan.checkpointCount,
    select(batchIndex: number) {
      if (!Number.isSafeInteger(batchIndex) || batchIndex < 0 || batchIndex >= plan.batches.length) {
        throw new Error("CONFORMANCE_EVENT_BATCH_INDEX_INVALID");
      }
      const checkpoints = plan.batches[batchIndex]!;
      const contract = compositionConformanceContractSchema.parse({...parent, checkpoints,
        checkpointBatch: {...parent.checkpointBatch, batchIndex},
        textParity: {...parent.textParity, checkpoints: textPlans(checkpoints)}});
      return {contract, batchContractSha256: sha256(contract)};
    },
  };
}

/** Freeze all child identities in the authorized revision, not in evidence supplied later by a worker. */
export function buildCompositionEventBatchAuthorization(input: {
  document: CompositionEditorDocument; parentContract: CompositionConformanceContract;
}) {
  const prepared = prepareCompositionEventBatchContracts(input);
  const root = prepared.select(0).contract;
  if (root.schemaVersion !== 4) throw new Error("CONFORMANCE_EVENT_EXECUTION_PARENT_INVALID");
  return eventBatchAuthorizationManifestSchema.parse({schemaVersion: 1,
    policy: "FROZEN_EVENT_PARTITION_CONTRACT_HASHES_V1", scope: "AUTHORIZED_CONTRACT_IDENTITIES_NOT_MEASUREMENT_COVERAGE",
    documentHash: prepared.documentHash, parentContractSha256: prepared.parentContractSha256,
    rootBatch: root.checkpointBatch,
    batchContractSha256: Array.from({length: prepared.batchCount}, (_, index) => prepared.select(index).batchContractSha256)});
}

export function assertSnapshotEventBatchAuthorization(manifest: unknown, document: CompositionEditorDocument) {
  if (!manifest || typeof manifest !== "object" || !("conformance_contract" in manifest)) {
    throw new Error("CONFORMANCE_SNAPSHOT_EVENT_AUTHORIZATION_MISMATCH");
  }
  const contract = compositionConformanceContractSchema.parse(manifest.conformance_contract);
  const authorization = "conformance_event_batch_authorization" in manifest ? manifest.conformance_event_batch_authorization : undefined;
  if (contract.schemaVersion !== 4 || !contract.checkpointBatch) {
    if (authorization !== undefined) throw new Error("CONFORMANCE_SNAPSHOT_EVENT_AUTHORIZATION_MISMATCH");
    return;
  }
  const stored = eventBatchAuthorizationManifestSchema.safeParse(authorization);
  if (!stored.success || JSON.stringify(stored.data) !== JSON.stringify(buildCompositionEventBatchAuthorization({document, parentContract: contract}))) {
    throw new Error("CONFORMANCE_SNAPSHOT_EVENT_AUTHORIZATION_MISMATCH");
  }
}
