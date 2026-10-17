import type {SupabaseClient} from "@supabase/supabase-js";
import {CONTROLLED_RENDER_WORKER_POLICY,controlledRenderQueueClaimSchema,controlledRenderWorkerIdSchema,
  type ControlledRenderQueueClaim,type classifyControlledRenderWorkerFailure} from "./composition-controlled-render-worker-contract";

/** Service-role host adapter only. No HTTP route or background worker is activated. */
export class CompositionControlledRenderQueueService {
  constructor(private readonly supabase:SupabaseClient<any,any,any>) {}

  async claim(workerId:string,signal?:AbortSignal) {
    const worker = controlledRenderWorkerIdSchema.safeParse(workerId);
    if (!worker.success) throw new Error("CONTROLLED_RENDER_WORKER_ID_INVALID");
    const result = await this.rpc("claim_controlled_render_worker_job",{p_worker_id:worker.data},signal);
    const parsed = controlledRenderQueueClaimSchema.nullable().safeParse(result.data);
    if (result.error || !parsed.success) throw new Error("CONTROLLED_RENDER_WORKER_CLAIM_FAILED");
    if (parsed.data && parsed.data.workerId !== worker.data) throw new Error("CONTROLLED_RENDER_WORKER_CLAIM_INVALID");
    return parsed.data;
  }

  async renew(claim:ControlledRenderQueueClaim,signal?:AbortSignal) {
    const result = await this.rpc("renew_controlled_render_worker_job",this.scope(claim),signal);
    return !result.error && result.data === true;
  }

  async finish(claim:ControlledRenderQueueClaim,assetId:string|null,
    failure:ReturnType<typeof classifyControlledRenderWorkerFailure>|null,signal?:AbortSignal) {
    const result = await this.rpc("finish_controlled_render_worker_job",{...this.scope(claim),p_asset_id:assetId,
      p_error_code:failure?.code ?? null,p_retryable:failure?.retryable ?? false,
      p_recovery_required:failure?.recoveryRequired ?? false},signal);
    if (result.error || typeof result.data !== "boolean") throw new Error("CONTROLLED_RENDER_WORKER_FINISH_UNCONFIRMED");
    return result.data;
  }

  private scope(claim:ControlledRenderQueueClaim) {
    return {p_organization_id:claim.organizationId,p_request_id:claim.requestId,
      p_worker_id:claim.workerId,p_worker_lease_token:claim.leaseToken};
  }

  private async rpc(name:string,args:Record<string,unknown>,signal?:AbortSignal) {
    const timeout = AbortSignal.timeout(CONTROLLED_RENDER_WORKER_POLICY.rpcTimeoutMilliseconds);
    const bounded = signal ? AbortSignal.any([signal,timeout]) : timeout;
    bounded.throwIfAborted();
    try {return await this.supabase.rpc(name,args).abortSignal(bounded);}
    catch {throw new Error("CONTROLLED_RENDER_WORKER_RPC_UNAVAILABLE");}
  }
}
