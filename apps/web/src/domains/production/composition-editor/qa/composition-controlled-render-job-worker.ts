import {z} from "zod";
import {CompositionControlledRenderQueueService} from "./composition-controlled-render-queue.service";
import {CompositionRenderSupervisorService} from "./composition-render-supervisor.service";
import {CompositionRenderCheckpointStore} from "./composition-render-checkpoint-store";
import {createConformanceJobLease,validateConformanceJobLeaseTimers} from "./composition-conformance-job-lease";
import {CONTROLLED_RENDER_WORKER_POLICY,classifyControlledRenderWorkerFailure,type ControlledRenderQueueClaim} from "./composition-controlled-render-worker-contract";
import type {ControlledRenderCheckpoint,RenderCheckpointScope} from "./composition-render-checkpoint";

type Host = {supervisor:{execute:(...args:Parameters<CompositionRenderSupervisorService["execute"]>) => Promise<{assetId:string}>;
    resumeCheckpoint:(...args:Parameters<CompositionRenderSupervisorService["resumeCheckpoint"]>) => Promise<{assetId:string}>};
  checkpoints:{save:(checkpoint:ControlledRenderCheckpoint) => ReturnType<CompositionRenderCheckpointStore["save"]>;
    read:(scope:RenderCheckpointScope) => Promise<unknown>}};

/** One leased queue job. The host factory must bind the queue lease to all supervisor RPC writes. */
export async function processControlledRenderJob(input:{queue:CompositionControlledRenderQueueService;workerId:string;
  createHost:(claim:ControlledRenderQueueClaim) => Host|Promise<Host>;signal?:AbortSignal;
  heartbeatMilliseconds?:number;renewalTimeoutMilliseconds?:number}) {
  input.signal?.throwIfAborted();
  validateConformanceJobLeaseTimers(input.heartbeatMilliseconds ?? CONTROLLED_RENDER_WORKER_POLICY.heartbeatMilliseconds,
    input.renewalTimeoutMilliseconds ?? CONTROLLED_RENDER_WORKER_POLICY.rpcTimeoutMilliseconds);
  const claim = await input.queue.claim(input.workerId,input.signal);
  if (!claim) return {status:"IDLE" as const};
  const lease = createConformanceJobLease({signal:input.signal,
    heartbeatMs:input.heartbeatMilliseconds ?? CONTROLLED_RENDER_WORKER_POLICY.heartbeatMilliseconds,
    renewalTimeoutMs:input.renewalTimeoutMilliseconds ?? CONTROLLED_RENDER_WORKER_POLICY.rpcTimeoutMilliseconds,
    renew:signal => input.queue.renew(claim,signal)});
  let assetId:string|null = null;
  let failure:ReturnType<typeof classifyControlledRenderWorkerFailure>|null = null;
  try {
    try {
      if (!await input.queue.renew(claim,lease.signal)) return {status:"LEASE_LOST" as const,requestId:claim.requestId};
    } catch {return {status:"LEASE_LOST" as const,requestId:claim.requestId};}
    lease.signal.throwIfAborted();
    const host = await input.createHost(claim);
    lease.signal.throwIfAborted();
    const result = claim.action === "EXECUTE"
      ? await host.supervisor.execute({organizationId:claim.organizationId,requestId:claim.requestId,
        issuanceId:claim.issuanceId,supervisorId:claim.supervisorId,keyId:claim.keyId,contract:claim.contract},lease.signal,
        checkpoint => host.checkpoints.save(checkpoint))
      : await (async () => {
        const scope = {organizationId:claim.organizationId,requestId:claim.requestId,revisionId:claim.revisionId,
          productionJobId:claim.productionJobId,executionId:claim.executionId!};
        // Missing/corrupt journal does not authorize a new render or a replacement challenge.
        const checkpoint = await host.checkpoints.read(scope);
        lease.signal.throwIfAborted();
        return host.supervisor.resumeCheckpoint(checkpoint,scope,lease.signal);
      })();
    assetId = z.string().uuid().parse(result.assetId);
  } catch (error) {failure = classifyControlledRenderWorkerFailure(error);}
  finally {await lease.close();}
  if (lease.lost) return {status:"LEASE_LOST" as const,requestId:claim.requestId};
  if (input.signal?.aborted) return {status:"CANCELLED" as const,requestId:claim.requestId};
  // Finish ACK failure is not converted into render failure; a later claim reconciles durable finalization.
  const finished = await input.queue.finish(claim,assetId,failure,input.signal);
  return {status:!finished ? "LEASE_LOST" as const : failure?.recoveryRequired ? "RECOVERY_REQUIRED" as const
    : failure ? "FAILED_ATTEMPT" as const : "SUCCEEDED" as const,
    requestId:claim.requestId,attempt:claim.attempt,errorCode:failure?.code ?? null};
}
