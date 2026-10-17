import {createHash} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import {z} from "zod";
import {CONTROLLED_RENDER_CHECKPOINT_POLICY, controlledCheckpointArtifactsSchema, parseControlledRenderCheckpoint,
  renderCheckpointScopeSchema, type ControlledRenderCheckpoint} from "./composition-render-checkpoint";
import {renderSupervisorBindingSchema} from "../composition-render-supervisor-receipt";
import {buildControlledSupervisorBinding} from "./composition-render-supervisor-binding";
import {bindControlledReferenceSelection, controlledReferenceSelectionSchema} from "./composition-controlled-reference-selection";
import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";
import {assertConformanceJobActive, CONFORMANCE_JOB_LEASE_POLICY} from "./composition-conformance-job-lease";
import {conformanceJobClaimSchema, type ConformanceJobClaim} from "./composition-conformance-job-worker";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const reservationSchema = z.object({version: z.literal(1), policy: z.literal("EXACT_JOB_RENDER_RESERVATION_V1"),
  jobId: z.string().uuid(), scope: renderCheckpointScopeSchema, binding: renderSupervisorBindingSchema,
  supervisorReceiptSha256: hash, artifacts: controlledCheckpointArtifactsSchema,
  referenceSelection: controlledReferenceSelectionSchema}).strict();
export type ConformanceRenderReservation = z.output<typeof reservationSchema>;
type JobScope = Pick<ConformanceJobClaim, "id" | "organization_id" | "request_id" | "revision_id">;
const digest = (bytes: string) => createHash("sha256").update(bytes, "utf8").digest("hex");

function validateReservationInputs(reservation: Omit<ConformanceRenderReservation, "jobId" | "policy" | "version">,
  job: Omit<JobScope, "id">) {
  const {scope, binding, artifacts} = reservation;
  if (scope.organizationId !== job.organization_id
    || scope.requestId !== job.request_id || scope.revisionId !== job.revision_id
    || Object.entries(scope).some(([field, value]) => binding[field as keyof typeof scope] !== value))
    throw new Error("CONFORMANCE_JOB_RESERVATION_SCOPE_MISMATCH");
  const contract = compositionConformanceContractSchema.parse(artifacts.kind === "SINGLE_CONTRACT"
    ? artifacts.input.contract : artifacts.input.parentContract);
  const derived = buildControlledSupervisorBinding({...binding, contract}, artifacts,
    {sha256: binding.videoSha256, sizeBytes: binding.sizeBytes});
  const selection = bindControlledReferenceSelection({organizationId: scope.organizationId,
    revisionId: scope.revisionId, executionId: scope.executionId, documentHash: binding.documentHash,
    projectHash: binding.projectHash, contract}, reservation.referenceSelection.references);
  if (JSON.stringify(derived) !== JSON.stringify(binding)
    || JSON.stringify(selection) !== JSON.stringify(reservation.referenceSelection))
    throw new Error("CONFORMANCE_JOB_RESERVATION_BINDING_INVALID");
  return reservation;
}

function parseReservation(raw: unknown, job: JobScope) {
  const reservation = reservationSchema.parse(raw);
  if (reservation.jobId !== job.id) throw new Error("CONFORMANCE_JOB_RESERVATION_SCOPE_MISMATCH");
  validateReservationInputs(reservation, job);
  return reservation;
}

const deferredSchema = reservationSchema.omit({jobId: true, policy: true}).extend({
  policy: z.literal("EXACT_RENDER_RESERVATION_OUTBOX_V1"),
}).strict();

/** Immutable DB reservation. Contains no lease, private key, retained path or credentials.
 * The consumed authority ledger still authenticates signature/revocation/output at measurement time. */
export class CompositionConformanceRenderReservationService {
  constructor(private readonly supabase: SupabaseClient<any, any, any>) {}

  /** Consumed checkpoint transport before upload/finalization. Does not invent a job ID.
   * DB attaches this exact payload when the integrity-triggered conformance job exists. */
  async defer(raw: ControlledRenderCheckpoint, signal?: AbortSignal) {
    assertConformanceJobActive(signal);
    const checkpoint = parseControlledRenderCheckpoint(raw, raw.scope);
    if (!checkpoint.referenceSelection) throw new Error("CONFORMANCE_JOB_RESERVATION_REFERENCES_REQUIRED_INVALID");
    const reservation = deferredSchema.parse({version: 1, policy: "EXACT_RENDER_RESERVATION_OUTBOX_V1",
      scope: checkpoint.scope, binding: checkpoint.supervisorReceipt.payload.binding,
      supervisorReceiptSha256: digest(JSON.stringify(checkpoint.supervisorReceipt)), artifacts: checkpoint.artifacts,
      referenceSelection: checkpoint.referenceSelection});
    validateReservationInputs(reservation, {organization_id: checkpoint.scope.organizationId,
      request_id: checkpoint.scope.requestId, revision_id: checkpoint.scope.revisionId});
    const bytes = JSON.stringify(reservation), sha256 = digest(bytes);
    if (Buffer.byteLength(bytes, "utf8") > CONTROLLED_RENDER_CHECKPOINT_POLICY.maximumBytes)
      throw new Error("CONFORMANCE_JOB_RESERVATION_LIMIT_EXCEEDED");
    const result = await this.rpc("stage_hyperframes_conformance_render_reservation", {
      p_organization_id: checkpoint.scope.organizationId, p_request_id: checkpoint.scope.requestId,
      p_revision_id: checkpoint.scope.revisionId, p_execution_id: checkpoint.scope.executionId,
      p_reservation_text: bytes, p_reservation_sha256: sha256,
    }, signal);
    assertConformanceJobActive(signal);
    if (result.error || result.data !== sha256) throw new Error("CONFORMANCE_JOB_RESERVATION_WRITE_UNCONFIRMED");
    return {sha256};
  }

  async publish(job: JobScope, raw: ControlledRenderCheckpoint, signal?: AbortSignal) {
    assertConformanceJobActive(signal);
    const checkpoint = parseControlledRenderCheckpoint(raw, raw.scope);
    if (!checkpoint.referenceSelection) throw new Error("CONFORMANCE_JOB_RESERVATION_REFERENCES_REQUIRED_INVALID");
    const reservation = parseReservation({version: 1, policy: "EXACT_JOB_RENDER_RESERVATION_V1", jobId: job.id,
      scope: checkpoint.scope, binding: checkpoint.supervisorReceipt.payload.binding,
      supervisorReceiptSha256: digest(JSON.stringify(checkpoint.supervisorReceipt)), artifacts: checkpoint.artifacts,
      referenceSelection: checkpoint.referenceSelection}, job);
    const bytes = JSON.stringify(reservation);
    if (Buffer.byteLength(bytes, "utf8") > CONTROLLED_RENDER_CHECKPOINT_POLICY.maximumBytes)
      throw new Error("CONFORMANCE_JOB_RESERVATION_LIMIT_EXCEEDED");
    const sha256 = digest(bytes);
    const result = await this.rpc("register_hyperframes_conformance_render_reservation", {
      p_job_id: job.id, p_organization_id: job.organization_id, p_request_id: job.request_id,
      p_revision_id: job.revision_id, p_reservation_text: bytes, p_reservation_sha256: sha256,
    }, signal);
    assertConformanceJobActive(signal);
    if (result.error || result.data !== sha256) throw new Error("CONFORMANCE_JOB_RESERVATION_WRITE_UNCONFIRMED");
    return {reservation, sha256};
  }

  async read(rawClaim: ConformanceJobClaim, signal?: AbortSignal) {
    assertConformanceJobActive(signal);
    const claim = conformanceJobClaimSchema.parse(rawClaim);
    const result = await this.rpc("read_hyperframes_conformance_render_reservation", {
      p_job_id: claim.id, p_lease_token: claim.lease_token, p_organization_id: claim.organization_id,
      p_request_id: claim.request_id, p_revision_id: claim.revision_id,
    }, signal);
    assertConformanceJobActive(signal);
    if (result.error || !result.data) throw new Error("CONFORMANCE_JOB_RESERVATION_UNAVAILABLE");
    const response = z.object({reservationText: z.string(), sha256: hash}).strict().parse(result.data);
    if (Buffer.byteLength(response.reservationText, "utf8") > CONTROLLED_RENDER_CHECKPOINT_POLICY.maximumBytes
      || digest(response.reservationText) !== response.sha256)
      throw new Error("CONFORMANCE_JOB_RESERVATION_INTEGRITY_INVALID");
    return {reservation: parseReservation(JSON.parse(response.reservationText), claim), sha256: response.sha256};
  }

  private async rpc(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(CONFORMANCE_JOB_LEASE_POLICY.renewalTimeoutMs);
    const bounded = signal ? AbortSignal.any([signal, timeout]) : timeout;
    assertConformanceJobActive(bounded);
    try {
      const result = await this.supabase.rpc(name, args).abortSignal(bounded);
      assertConformanceJobActive(bounded);
      return result;
    } catch {throw new Error("CONFORMANCE_JOB_RESERVATION_RPC_UNCONFIRMED");}
  }
}
