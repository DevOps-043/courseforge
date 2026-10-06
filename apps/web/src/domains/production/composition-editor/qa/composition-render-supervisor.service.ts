import {createHash,createPublicKey, type KeyObject} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import {CompositionRenderAuthorityService} from "./composition-render-authority.service";
import {CompositionControlledRenderUploadService} from "./composition-controlled-render-upload.service";
import {buildControlledSupervisorBinding, type ControlledSupervisorArtifacts} from "./composition-render-supervisor-binding";
import {signRenderSupervisorReceipt} from "./composition-render-supervisor-signature";
import {pinConformanceFile, assertConformanceFileUnchanged} from "./composition-conformance-file-integrity";
import {CONTROLLED_RENDER_STORAGE} from "./composition-controlled-render-storage-policy";
import {RENDER_SUPERVISOR_RECEIPT_POLICY} from "../composition-render-supervisor-receipt";
import {createControlledRenderDeadline, CONTROLLED_RENDER_DEADLINE_POLICY} from "./composition-controlled-render-deadline";
import {CONTROLLED_RENDER_CHECKPOINT_POLICY,parseControlledRenderCheckpoint,type ControlledRenderCheckpoint,type RenderCheckpointScope} from "./composition-render-checkpoint";

type IssueInput = Parameters<CompositionRenderAuthorityService["issue"]>[0];
type Context = Awaited<ReturnType<CompositionRenderAuthorityService["issue"]>>;
export type ControlledSupervisorRenderer = (descriptor: {
  organizationId: string; revisionId: string;
  executionId: string; documentHash: string; projectHash: string; contract: Context["contract"];
}, signal?: AbortSignal) => Promise<{videoPath: string; artifacts: ControlledSupervisorArtifacts}>;

/** Host coordinator, not an isolated renderer. Caller must supply an operator-owned renderer adapter. */
export class CompositionRenderSupervisorService {
  private readonly authority: CompositionRenderAuthorityService;
  private readonly uploader: CompositionControlledRenderUploadService;
  constructor(supabase: SupabaseClient<any, any, any>, projectUrl: string, private readonly privateKey: KeyObject,
    private readonly render: ControlledSupervisorRenderer, fetchImpl: typeof fetch = fetch,
    private readonly clock: () => number = Date.now,workerLeaseToken?:string) {
    this.authority = new CompositionRenderAuthorityService(supabase, clock,workerLeaseToken);
    this.uploader = new CompositionControlledRenderUploadService(supabase, projectUrl, fetchImpl, clock,workerLeaseToken);
  }

  async execute(input: IssueInput, signal?: AbortSignal,
    persistCheckpoint?: (checkpoint:ControlledRenderCheckpoint) => Promise<void>) {
    signal?.throwIfAborted();
    const context = await this.authority.issue(input);
    const admissionScope = {organizationId: context.organizationId, requestId: context.requestId,
      executionId: context.executionId, leaseToken: context.leaseToken};
    let admitted = false, admissionStarted = false;
    let budget: ReturnType<typeof createControlledRenderDeadline> | undefined;
    try {
      if (this.privateKey.type !== "private" || this.privateKey.asymmetricKeyType !== "ed25519"
        || createPublicKey(this.privateKey).export({format: "der", type: "spki"}).toString("base64") !== context.key.publicKeySpkiBase64)
        throw new Error("RENDER_SUPERVISOR_SIGNING_KEY_MISMATCH");
      signal?.throwIfAborted();
      const remaining = context.expiresAtMilliseconds - this.clock();
      if (remaining < CONTROLLED_RENDER_DEADLINE_POLICY.minimumMilliseconds)
        throw new Error("RENDER_SUPERVISOR_AUTHORITY_EXPIRED");
      budget = createControlledRenderDeadline(Math.min(remaining, CONTROLLED_RENDER_DEADLINE_POLICY.maximumMilliseconds), signal);
      // Explicit projection: no private key, trust keys, DB credential, lease or receipt is given to the renderer.
      const produced = await this.render(structuredClone({executionId: context.executionId, documentHash: context.documentHash,
        organizationId: context.organizationId, revisionId: context.revisionId,
        projectHash: context.projectHash, contract: context.contract}), budget.signal);
      // Await adapter ownership; a logical deadline is not proof that its OS processes have terminated.
      budget.remainingMilliseconds();
      signal?.throwIfAborted();
      if (produced.artifacts.kind !== context.artifactKind) throw new Error("RENDER_SUPERVISOR_ARTIFACT_KIND_MISMATCH");
      const output = await pinConformanceFile(produced.videoPath, CONTROLLED_RENDER_STORAGE.maximumVideoBytes);
      const binding = buildControlledSupervisorBinding(context, produced.artifacts, output);
      const issuedAtMilliseconds = this.clock();
      if (!Number.isSafeInteger(issuedAtMilliseconds) || issuedAtMilliseconds < context.issuedAtMilliseconds
        || issuedAtMilliseconds >= context.expiresAtMilliseconds) throw new Error("RENDER_SUPERVISOR_AUTHORITY_EXPIRED");
      const receipt = signRenderSupervisorReceipt({policy: RENDER_SUPERVISOR_RECEIPT_POLICY,
        scope: "SIGNED_ISSUER_AND_OUTPUT_BINDING_NOT_ISOLATION_OR_CONFORMANCE", supervisorId: context.supervisorId,
        keyId: context.keyId, issuedAtMilliseconds, expiresAtMilliseconds: context.expiresAtMilliseconds, binding}, this.privateKey);
      await assertConformanceFileUnchanged(produced.videoPath, output, CONTROLLED_RENDER_STORAGE.maximumVideoBytes);
      budget.remainingMilliseconds();
      const recovery = {scope: {organizationId: context.organizationId, requestId: context.requestId, executionId: context.executionId,
        revisionId: context.revisionId, productionJobId: context.productionJobId}, videoPath: produced.videoPath, artifacts: produced.artifacts};
      if (persistCheckpoint) {
        const checkpoint = parseControlledRenderCheckpoint({version:CONTROLLED_RENDER_CHECKPOINT_POLICY.version,...recovery,leaseToken:context.leaseToken,
          supervisorReceipt:receipt},recovery.scope);
        try {await persistCheckpoint(checkpoint);} catch {throw new Error("RENDER_SUPERVISOR_CHECKPOINT_WRITE_FAILED");}
        budget.remainingMilliseconds(); signal?.throwIfAborted();
        await assertConformanceFileUnchanged(produced.videoPath,output,CONTROLLED_RENDER_STORAGE.maximumVideoBytes);
      }
      admissionStarted = true;
      try {await this.authority.admit({scope: admissionScope, supervisorReceipt: receipt,
        videoPath: produced.videoPath, artifacts: produced.artifacts});}
      catch {
        // An ACK may be lost after consumption. Reconcile ledger; never blindly render or consume again.
        await this.authority.recover(recovery);
      }
      admitted = true;
      budget.dispose();
      signal?.throwIfAborted();
      return await this.uploader.uploadAndFinalize({...recovery, signal});
    } catch (error) {
      // Do not cancel an uncertain/consumed admission or erase the output needed to resume its upload.
      if (!admitted && !admissionStarted) {
        try {await this.authority.cancel(admissionScope);}
        catch {throw new Error("RENDER_SUPERVISOR_CANCELLATION_UNCONFIRMED");}
      }
      if (error instanceof Error && /^(RENDER_(SUPERVISOR|AUTHORITY)|CONTROLLED_RENDER|CONFORMANCE_FILE)_[A-Z_]+$/.test(error.message)) throw error;
      if (signal?.aborted) throw new Error("RENDER_SUPERVISOR_CANCELLED");
      throw new Error("RENDER_SUPERVISOR_EXECUTION_FAILED");
    } finally {budget?.dispose();}
  }

  /** Retry upload/finalization of a consumed output without issuing a new challenge or calling the renderer. */
  resume(input: Parameters<CompositionControlledRenderUploadService["uploadAndFinalize"]>[0]) {
    return this.uploader.uploadAndFinalize(input);
  }

  /** Replay the exact admission after a process restart; never issue a new challenge or invoke the renderer. */
  async resumeCheckpoint(raw:unknown,expectedScope:RenderCheckpointScope,signal?:AbortSignal) {
    signal?.throwIfAborted();
    const checkpoint = parseControlledRenderCheckpoint(raw,expectedScope);
    const recovery = {scope:checkpoint.scope,videoPath:checkpoint.videoPath,artifacts:checkpoint.artifacts};
    try {
      await this.authority.admit({scope:{organizationId:checkpoint.scope.organizationId,requestId:checkpoint.scope.requestId,
        executionId:checkpoint.scope.executionId,leaseToken:checkpoint.leaseToken},supervisorReceipt:checkpoint.supervisorReceipt,
        videoPath:checkpoint.videoPath,artifacts:checkpoint.artifacts});
    } catch {
      // Expired/live read or lost ACK cannot justify a new render: only a verified CONSUMED ledger can recover.
      const recovered = await this.authority.recover(recovery);
      if (recovered.provenance.receiptSha256 !== createHash("sha256").update(JSON.stringify(checkpoint.supervisorReceipt)).digest("hex"))
        throw new Error("RENDER_SUPERVISOR_CHECKPOINT_RECEIPT_MISMATCH");
    }
    signal?.throwIfAborted();
    return this.uploader.uploadAndFinalize({...recovery,signal});
  }
}
