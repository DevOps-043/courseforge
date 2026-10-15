import {z} from "zod";
import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";
import {requiresControlledExecutorIntervention} from "./composition-controlled-execution-fence";

export const CONTROLLED_RENDER_WORKER_POLICY = {leaseSeconds:120,heartbeatMilliseconds:30_000,
  rpcTimeoutMilliseconds:15_000,maximumAttempts:5} as const;
const uuid = z.string().uuid().transform(value => value.toLowerCase());
export const controlledRenderWorkerIdSchema = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
export const controlledRenderQueueClaimSchema = z.object({organizationId:uuid,requestId:uuid,revisionId:uuid,
  productionJobId:uuid,workerId:controlledRenderWorkerIdSchema,leaseToken:uuid,issuanceId:uuid,
  attempt:z.number().int().min(1).max(CONTROLLED_RENDER_WORKER_POLICY.maximumAttempts),
  supervisorId:controlledRenderWorkerIdSchema,keyId:controlledRenderWorkerIdSchema,
  action:z.enum(["EXECUTE","RESUME"]),executionId:uuid.nullable(),contract:compositionConformanceContractSchema,
}).strict().superRefine((claim,context) => {
  if ((claim.action === "EXECUTE") !== (claim.executionId === null) || claim.contract.schemaVersion !== 4
    || claim.contract.renderExecution?.backend !== "CONTROLLED")
    context.addIssue({code:"custom",message:"CONTROLLED_RENDER_WORKER_CLAIM_INVALID"});
});
export type ControlledRenderQueueClaim = z.output<typeof controlledRenderQueueClaimSchema>;

/** Queue ownership is distinct from the authority challenge lease, and never goes to the renderer. */
export function controlledWorkerLeaseArguments(token?:string) {
  if (token === undefined) return {};
  const parsed = uuid.safeParse(token);
  if (!parsed.success) throw new Error("CONTROLLED_RENDER_WORKER_LEASE_INVALID");
  return {p_worker_lease_token:parsed.data};
}

export function classifyControlledRenderWorkerFailure(error:unknown) {
  const code = error instanceof Error && /^(CONTROLLED_RENDER|RENDER_SUPERVISOR|RENDER_AUTHORITY|CONFORMANCE_FILE)_[A-Z_]+$/.test(error.message)
    ? error.message : "CONTROLLED_RENDER_WORKER_FAILED";
  const recoveryRequired = code.includes("CHECKPOINT") || code === "RENDER_SUPERVISOR_CANCELLATION_UNCONFIRMED"
    || requiresControlledExecutorIntervention(code);
  const retryable = ["CONTROLLED_RENDER_UPLOAD_TRANSPORT_FAILED","CONTROLLED_RENDER_UPLOAD_TOKEN_UNAVAILABLE",
    "CONTROLLED_RENDER_STORAGE_UNAVAILABLE","CONTROLLED_RENDER_STORAGE_READ_FAILED","CONTROLLED_RENDER_FINALIZATION_REJECTED",
    "RENDER_AUTHORITY_ISSUE_FAILED","RENDER_AUTHORITY_RECOVERY_UNAVAILABLE"].includes(code);
  return {code,retryable:!recoveryRequired && retryable,recoveryRequired};
}
