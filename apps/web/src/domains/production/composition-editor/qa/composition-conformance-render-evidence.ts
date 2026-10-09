import {createHash} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import {CompositionRenderAuthorityService} from "./composition-render-authority.service";
import {renderCheckpointScopeSchema, CONTROLLED_RENDER_CHECKPOINT_POLICY, type RenderCheckpointScope} from "./composition-render-checkpoint";
import type {ControlledSupervisorArtifacts} from "./composition-render-supervisor-binding";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";

/** Trusted host reservation, never inferred from a receipt, URL or unscoped latest execution. */
export type ConformanceRenderEvidenceReservation = {
  scope: RenderCheckpointScope;
  artifacts: ControlledSupervisorArtifacts;
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");

/** Read-only admission of previously consumed issuer/output evidence. Does not consume, sign or render. */
export async function recoverConformanceRenderEvidence(params: {
  supabase: SupabaseClient<any, any, any>;
  reservation: ConformanceRenderEvidenceReservation;
  jobScope: {organizationId: string; requestId: string; revisionId: string};
  integrity: {documentHash: string; checksum: string; sizeBytes: number};
  videoPath: string;
  signal?: AbortSignal;
}, clock: () => number = Date.now) {
  assertConformanceJobActive(params.signal);
  if (Buffer.byteLength(JSON.stringify(params.reservation), "utf8") > CONTROLLED_RENDER_CHECKPOINT_POLICY.maximumBytes)
    throw new Error("CONFORMANCE_JOB_RENDER_EVIDENCE_LIMIT_EXCEEDED");
  const reservation = structuredClone(params.reservation);
  const scope = renderCheckpointScopeSchema.parse(reservation.scope);
  if ((["organizationId", "requestId", "revisionId"] as const).some(key => scope[key] !== params.jobScope[key]))
    throw new Error("CONFORMANCE_JOB_RENDER_EVIDENCE_SCOPE_MISMATCH");
  const recovered = await new CompositionRenderAuthorityService(params.supabase, clock).recover({
    scope, artifacts: reservation.artifacts, videoPath: params.videoPath,
  });
  assertConformanceJobActive(params.signal);
  const binding = recovered.provenance.binding;
  if (binding.documentHash !== params.integrity.documentHash || binding.videoSha256 !== params.integrity.checksum
    || binding.sizeBytes !== params.integrity.sizeBytes)
    throw new Error("CONFORMANCE_JOB_RENDER_EVIDENCE_INTEGRITY_MISMATCH");
  const batches = "receipt" in recovered ? [recovered] : recovered.artifacts;
  return {
    scope: "CONSUMED_SUPERVISOR_ISSUER_OUTPUT_NOT_ISOLATION_OR_CONFORMANCE" as const,
    projectHash: binding.projectHash,
    contractSha256: binding.contractSha256,
    supervisorReceiptSha256: recovered.provenance.receiptSha256,
    binding: structuredClone(binding),
    batches: batches.map((batch, batchIndex) => ({batchIndex, contractSha256: digest(batch.contract),
      receiptSha256: digest(batch.receipt), receipt: structuredClone(batch.receipt)})),
  };
}
