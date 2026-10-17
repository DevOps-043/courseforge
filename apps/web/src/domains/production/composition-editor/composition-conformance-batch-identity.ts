import { createHash } from "node:crypto";
import type { CompositionEditorDocument } from "./composition-document.types";
import { buildCompositionEventCheckpointPlan, requireSingleEventCheckpointBatch } from "./composition-conformance-event-checkpoints";
import { eventCheckpointBatchSchema } from "./composition-conformance-batch-contract";

/** Server-only: every selected partition carries the hash of the complete deterministic plan. */
export function selectCompositionEventCheckpointBatch(document: CompositionEditorDocument, batchIndex = 0) {
  const plan = buildCompositionEventCheckpointPlan(document);
  if (!Number.isSafeInteger(batchIndex) || batchIndex < 0 || batchIndex >= plan.batches.length) {
    throw new Error("CONFORMANCE_EVENT_BATCH_INDEX_INVALID");
  }
  const batch = eventCheckpointBatchSchema.parse({batchIndex, batchCount: plan.batches.length,
    totalCheckpointCount: plan.checkpointCount,
    planSha256: createHash("sha256").update(JSON.stringify(plan)).digest("hex")});
  return {batch, checkpoints: plan.batches[batchIndex]!};
}

export function assertCompositionEventCheckpointBatch(document: CompositionEditorDocument,
  contract: {checkpoints: unknown; checkpointBatch?: unknown}) {
  if (contract.checkpointBatch === undefined) {
    if (JSON.stringify(requireSingleEventCheckpointBatch(document)) !== JSON.stringify(contract.checkpoints)) {
      throw new Error("CONFORMANCE_REFERENCE_EVENT_PLAN_MISMATCH");
    }
    return;
  }
  const batch = eventCheckpointBatchSchema.parse(contract.checkpointBatch);
  const expected = selectCompositionEventCheckpointBatch(document, batch.batchIndex);
  if (JSON.stringify(batch) !== JSON.stringify(expected.batch) || JSON.stringify(contract.checkpoints) !== JSON.stringify(expected.checkpoints)) {
    throw new Error("CONFORMANCE_REFERENCE_EVENT_BATCH_MISMATCH");
  }
}
