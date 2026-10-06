import {createHash, createPublicKey} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import {z} from "zod";
import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";
import {renderSupervisorReceiptSchema, RENDER_SUPERVISOR_RECEIPT_LIMITS} from "../composition-render-supervisor-receipt";
import {pinConformanceFile, assertConformanceFileUnchanged} from "./composition-conformance-file-integrity";
import {buildSupervisedComparisonArtifacts, buildSupervisedEventComparisonArtifacts} from "./composition-supervised-comparison-artifacts";
import {buildControlledSupervisorBinding, type ControlledSupervisorArtifacts} from "./composition-render-supervisor-binding";
import {controlledWorkerLeaseArguments} from "./composition-controlled-render-worker-contract";

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const identifier = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const maximumVideoBytes = 2 * 1024 ** 3;
const maximumContractBytes = 1024 ** 2;

export const renderAuthorityContextSchema = z.object({
  organizationId: uuid, requestId: uuid, revisionId: uuid, productionJobId: uuid,
  executionId: uuid, attempt: z.number().int().min(1).max(5), leaseToken: uuid, challengeSha256: hash,
  documentHash: hash, projectHash: hash, contractSha256: hash,
  artifactKind: z.enum(["SINGLE_CONTRACT", "EVENT_BATCH_SET"]), supervisorId: identifier, keyId: identifier,
  issuedAtMilliseconds: timestamp, expiresAtMilliseconds: timestamp,
  contract: compositionConformanceContractSchema,
  key: z.object({publicKeySpkiBase64: z.string().min(1).max(1024).regex(/^[A-Za-z0-9+/]+={0,2}$/),
    notBeforeMilliseconds: timestamp, notAfterMilliseconds: timestamp, revoked: z.boolean()}).strict(),
}).strict().superRefine((context, validation) => {
  const contract = context.contract;
  if (contract.schemaVersion !== 4 || !contract.renderExecution || contract.documentHash !== context.documentHash
    || digest(contract) !== context.contractSha256
    || (contract.checkpointBatch ? "EVENT_BATCH_SET" : "SINGLE_CONTRACT") !== context.artifactKind
    || context.expiresAtMilliseconds <= context.issuedAtMilliseconds
    || context.expiresAtMilliseconds - context.issuedAtMilliseconds > RENDER_SUPERVISOR_RECEIPT_LIMITS.maximumLifetimeMilliseconds)
    validation.addIssue({code: "custom", message: "RENDER_AUTHORITY_CONTEXT_INVALID"});
});

type SingleArtifacts = Extract<ControlledSupervisorArtifacts, {kind: "SINGLE_CONTRACT"}>;
type EventArtifacts = Extract<ControlledSupervisorArtifacts, {kind: "EVENT_BATCH_SET"}>;
type AuthorityContext = z.output<typeof renderAuthorityContextSchema>;
const recoveryScopeSchema = z.object({organizationId: uuid, requestId: uuid, executionId: uuid,
  revisionId: uuid, productionJobId: uuid}).strict();
const consumedExecutionSchema = z.object({state: z.literal("CONSUMED"), context: renderAuthorityContextSchema,
  receipt: renderSupervisorReceiptSchema, receiptSha256: hash, consumedAtMilliseconds: timestamp}).strict()
  .superRefine((record, validation) => {
    if (record.receiptSha256 !== digest(record.receipt)
      || record.consumedAtMilliseconds < record.context.issuedAtMilliseconds
      || record.consumedAtMilliseconds >= record.context.expiresAtMilliseconds)
      validation.addIssue({code: "custom", message: "RENDER_AUTHORITY_CONSUMED_RECORD_INVALID"});
  });
const scopeSchema = z.object({organizationId: uuid, requestId: uuid, executionId: uuid, leaseToken: uuid}).strict();
const issueSchema = z.object({organizationId: uuid, requestId: uuid, issuanceId: uuid,
  supervisorId: identifier, keyId: identifier, contract: compositionConformanceContractSchema}).strict();

/** Worker-only authority adapter. No HTTP entry point, defaults or credentials are enabled here. */
export class CompositionRenderAuthorityService {
  constructor(private readonly supabase: SupabaseClient<any, any, any>, private readonly clock: () => number = Date.now,
    private readonly workerLeaseToken?:string) {}

  async issue(input: z.input<typeof issueSchema>) {
    const parsed = issueSchema.safeParse(input);
    if (!parsed.success) throw new Error("RENDER_AUTHORITY_INPUT_INVALID");
    const params = parsed.data;
    if (params.contract.schemaVersion !== 4 || !params.contract.renderExecution
      || Buffer.byteLength(JSON.stringify(params.contract), "utf8") > maximumContractBytes)
      throw new Error("RENDER_AUTHORITY_INPUT_INVALID");
    const result = await this.supabase.rpc("issue_composition_render_execution", {
      ...controlledWorkerLeaseArguments(this.workerLeaseToken),
      p_organization_id: params.organizationId, p_request_id: params.requestId, p_issuance_id: params.issuanceId,
      p_supervisor_id: params.supervisorId, p_key_id: params.keyId, p_contract: params.contract,
      p_contract_sha256: digest(params.contract),
    });
    if (result.error) throw new Error("RENDER_AUTHORITY_ISSUE_FAILED");
    const context = this.parseContext(result.data);
    if (context.organizationId !== params.organizationId || context.requestId !== params.requestId
      || context.supervisorId !== params.supervisorId || context.keyId !== params.keyId
      || context.contractSha256 !== digest(params.contract)) throw new Error("RENDER_AUTHORITY_CONTEXT_MISMATCH");
    return context;
  }

  async admit(input: {scope: z.input<typeof scopeSchema>; supervisorReceipt: unknown;
    videoPath: string; artifacts: SingleArtifacts | EventArtifacts}) {
    const parsed = scopeSchema.safeParse(input.scope);
    if (!parsed.success) throw new Error("RENDER_AUTHORITY_INPUT_INVALID");
    const scope = parsed.data;
    const result = await this.supabase.rpc("read_composition_render_execution", {
      p_organization_id: scope.organizationId, p_request_id: scope.requestId,
      p_execution_id: scope.executionId, p_lease_token: scope.leaseToken,
    });
    if (result.error || !result.data) throw new Error("RENDER_AUTHORITY_CONTEXT_UNAVAILABLE");
    const context = this.parseContext(result.data);
    if (Object.entries(scope).some(([field, value]) => context[field as keyof typeof scope] !== value)
      || context.artifactKind !== input.artifacts.kind) throw new Error("RENDER_AUTHORITY_CONTEXT_MISMATCH");
    const {verified, output, receipt} = await this.verifyArtifacts(context, input.supervisorReceipt,
      input.artifacts, input.videoPath, this.clock());
    await assertConformanceFileUnchanged(input.videoPath, output, maximumVideoBytes);
    const committed = await this.supabase.rpc("consume_composition_render_execution", {
      ...controlledWorkerLeaseArguments(this.workerLeaseToken),
      p_organization_id: scope.organizationId, p_request_id: scope.requestId, p_execution_id: scope.executionId,
      p_lease_token: scope.leaseToken, p_receipt: receipt, p_receipt_sha256: verified.provenance.receiptSha256,
    });
    if (committed.error || committed.data !== true) throw new Error("RENDER_AUTHORITY_CONSUMPTION_REJECTED");
    await assertConformanceFileUnchanged(input.videoPath, output, maximumVideoBytes);
    return verified;
  }

  /** Read-only reconciliation of a committed receipt. Never renews a challenge or consumes a new output. */
  async recover(input: {scope: z.input<typeof recoveryScopeSchema>; videoPath: string; artifacts: SingleArtifacts | EventArtifacts}) {
    const parsed = recoveryScopeSchema.safeParse(input.scope);
    if (!parsed.success) throw new Error("RENDER_AUTHORITY_INPUT_INVALID");
    const scope = parsed.data;
    const readRecord = async () => {
      const result = await this.supabase.rpc("read_consumed_composition_render_execution", {
        p_organization_id: scope.organizationId, p_request_id: scope.requestId, p_execution_id: scope.executionId,
        p_revision_id: scope.revisionId, p_production_job_id: scope.productionJobId,
      });
      if (result.error || !result.data) throw new Error("RENDER_AUTHORITY_RECOVERY_UNAVAILABLE");
      const record = consumedExecutionSchema.safeParse(result.data);
      const now = this.clock();
      if (!record.success || !Number.isSafeInteger(now) || now < 0
        || record.data.consumedAtMilliseconds > now + RENDER_SUPERVISOR_RECEIPT_LIMITS.maximumClockSkewMilliseconds)
        throw new Error("RENDER_AUTHORITY_CONSUMED_RECORD_INVALID");
      if (Object.entries(scope).some(([field, value]) => record.data.context[field as keyof typeof scope] !== value)
        || record.data.context.artifactKind !== input.artifacts.kind) throw new Error("RENDER_AUTHORITY_CONTEXT_MISMATCH");
      return record.data;
    };
    const record = await readRecord();
    // Time comes from the committed authority ledger, never from a caller's receipt or clock override.
    // Current revocation remains enforced through the key returned by this fresh scoped RPC.
    const {verified, output} = await this.verifyArtifacts(record.context, record.receipt,
      input.artifacts, input.videoPath, record.consumedAtMilliseconds);
    if (verified.provenance.receiptSha256 !== record.receiptSha256)
      throw new Error("RENDER_AUTHORITY_CONSUMED_RECORD_INVALID");
    await assertConformanceFileUnchanged(input.videoPath, output, maximumVideoBytes);
    const refreshed = await readRecord();
    if (digest(refreshed) !== digest(record)) throw new Error("RENDER_AUTHORITY_RECOVERY_CHANGED");
    await assertConformanceFileUnchanged(input.videoPath, output, maximumVideoBytes);
    return {...verified, recovery: {policy: "CONSUMED_LEDGER_RECOVERY_NOT_NEW_ADMISSION_V1" as const,
      consumedAtMilliseconds: record.consumedAtMilliseconds, checkedAtMilliseconds: this.clock()}};
  }

  private async verifyArtifacts(context: AuthorityContext, receiptInput: unknown,
    artifactInput: SingleArtifacts | EventArtifacts, videoPath: string, verificationTime: number) {
    const receipt = renderSupervisorReceiptSchema.safeParse(receiptInput);
    if (!receipt.success || receipt.data.payload.supervisorId !== context.supervisorId
      || receipt.data.payload.keyId !== context.keyId) throw new Error("RENDER_AUTHORITY_ISSUER_MISMATCH");
    if (receipt.data.payload.issuedAtMilliseconds < context.issuedAtMilliseconds
      || receipt.data.payload.expiresAtMilliseconds > context.expiresAtMilliseconds)
      throw new Error("RENDER_AUTHORITY_RECEIPT_INTERVAL_INVALID");
    const output = await pinConformanceFile(videoPath, maximumVideoBytes);
    const expectedBinding = buildControlledSupervisorBinding(context, artifactInput, output);
    const publicKey = this.publicKey(context.key.publicKeySpkiBase64);
    const authorization = {supervisorReceipt: receipt.data, expectedBinding, nowMilliseconds: verificationTime,
      trustedKeys: [{supervisorId: context.supervisorId, keyId: context.keyId, publicKey,
        organizationIds: [context.organizationId], notBeforeMilliseconds: context.key.notBeforeMilliseconds,
        notAfterMilliseconds: context.key.notAfterMilliseconds, revoked: context.key.revoked}]};
    const verified = artifactInput.kind === "SINGLE_CONTRACT"
      ? buildSupervisedComparisonArtifacts({...artifactInput.input, ...authorization})
      : buildSupervisedEventComparisonArtifacts({...artifactInput.input, ...authorization});
    return {verified, output, receipt: receipt.data};
  }

  /** Invalidates admission authority only; OS/process cancellation belongs to the supervisor. */
  async cancel(input: z.input<typeof scopeSchema>) {
    const parsed = scopeSchema.safeParse(input);
    if (!parsed.success) throw new Error("RENDER_AUTHORITY_INPUT_INVALID");
    const scope = parsed.data;
    const result = await this.supabase.rpc("cancel_composition_render_execution", {
      ...controlledWorkerLeaseArguments(this.workerLeaseToken),
      p_organization_id: scope.organizationId, p_request_id: scope.requestId,
      p_execution_id: scope.executionId, p_lease_token: scope.leaseToken,
    });
    if (result.error || typeof result.data !== "boolean") throw new Error("RENDER_AUTHORITY_CANCEL_FAILED");
    return result.data;
  }

  private parseContext(input: unknown) {
    const parsed = renderAuthorityContextSchema.safeParse(input);
    const now = this.clock();
    if (!parsed.success || !Number.isSafeInteger(now) || now < 0 || now >= parsed.data.expiresAtMilliseconds
      || parsed.data.issuedAtMilliseconds > now + RENDER_SUPERVISOR_RECEIPT_LIMITS.maximumClockSkewMilliseconds)
      throw new Error("RENDER_AUTHORITY_CONTEXT_INVALID");
    return parsed.data;
  }

  private publicKey(encoded: string) {
    try {
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.toString("base64") !== encoded) throw new Error();
      return createPublicKey({key: bytes, format: "der", type: "spki"});
    } catch {throw new Error("RENDER_AUTHORITY_TRUST_INVALID");}
  }
}
