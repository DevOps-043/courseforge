import {parseControlledRenderCheckpoint, renderCheckpointScopeSchema, type RenderCheckpointScope} from "./composition-render-checkpoint";
import type {CompositionRenderCheckpointStore} from "./composition-render-checkpoint-store";
import type {ConformanceJobClaim} from "./composition-conformance-job-worker";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";

export type ConformanceCheckpointReservation = {
  scope: RenderCheckpointScope;
  store: Pick<CompositionRenderCheckpointStore, "read">;
};

/** Reads only the host-reserved checkpoint. The consumed authority ledger must still authenticate it. */
export async function readConformanceCheckpointReservation(input: ConformanceCheckpointReservation,
  claim: ConformanceJobClaim, signal?: AbortSignal) {
  assertConformanceJobActive(signal);
  const scope = renderCheckpointScopeSchema.parse(input.scope);
  if (scope.organizationId !== claim.organization_id || scope.requestId !== claim.request_id
    || scope.revisionId !== claim.revision_id)
    throw new Error("CONFORMANCE_JOB_CHECKPOINT_SCOPE_MISMATCH");
  const checkpoint = parseControlledRenderCheckpoint(await input.store.read(scope), scope);
  assertConformanceJobActive(signal);
  if (!checkpoint.referenceSelection) throw new Error("CONFORMANCE_JOB_CHECKPOINT_REFERENCE_SELECTION_REQUIRED_INVALID");
  return {controlledRenderEvidence: {scope: checkpoint.scope, artifacts: checkpoint.artifacts},
    referenceSelection: checkpoint.referenceSelection};
}
