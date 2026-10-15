import {randomUUID} from "node:crypto";
import {z} from "zod";
import {createControlledRenderDeadline} from "./composition-controlled-render-deadline";
import {buildWindowsNetworkPlan, windowsLoopbackEndpointSchema, windowsNetworkScopeSchema,
  type WindowsNetworkScope, type WindowsNetworkPlan} from "./composition-windows-network-policy";

const receiptSchema = z.object({leaseId: z.string().uuid(), generation: z.number().int().positive().safe(),
  planSha256: z.string().regex(/^[a-f0-9]{64}$/), persistent: z.literal(true)}).strict();
type Receipt = z.infer<typeof receiptSchema>;
/** Trusted host/broker ports, NOT document-controlled callbacks or an unauthenticated worker RPC.
 * Native backend/channel authentication/ACL/persistent lease recovery remain separate obligations. */
export interface WindowsNetworkControllerPorts {
  acquireAndDenyAll(scope: WindowsNetworkScope, leaseId: string, plan: WindowsNetworkPlan, signal: AbortSignal): Promise<unknown>;
  readEffectivePolicy(scope: WindowsNetworkScope, leaseId: string, signal: AbortSignal): Promise<unknown>;
  resolveOriginalServer(scope: WindowsNetworkScope, leaseId: string, signal: AbortSignal): Promise<unknown>;
  replaceAtomically(scope: WindowsNetworkScope, leaseId: string, previousGeneration: number,
    plan: WindowsNetworkPlan, signal: AbortSignal): Promise<unknown>;
  confirmOwnedJobStopped(scope: WindowsNetworkScope, leaseId: string, signal: AbortSignal): Promise<unknown>;
}
const failure = (code: string) => new Error(`CONTROLLED_RENDER_NETWORK_CONTROLLER_${code}`);
export const WINDOWS_NETWORK_CONTROLLER_OPERATION_TIMEOUT_MILLISECONDS = 15000;

/** Single execution lifecycle. Never removes policy on error, timeout, disposal or worker disconnect.
 * No default OS implementation: missing native ports cannot silently become a successful sandbox. */
export function createWindowsNetworkController(rawScope: WindowsNetworkScope, ports: WindowsNetworkControllerPorts) {
  const scope = windowsNetworkScopeSchema.parse(rawScope);
  for (const method of ["acquireAndDenyAll", "readEffectivePolicy", "resolveOriginalServer", "replaceAtomically", "confirmOwnedJobStopped"] as const)
    if (typeof ports?.[method] !== "function") throw failure("PORT_REQUIRED");
  const leaseId = randomUUID();
  let state: "NEW" | "DENIED" | "LOCAL_ONLY" | "SEALED" | "RECOVERY_REQUIRED" = "NEW";
  let busy = false, receipt: Receipt | undefined;
  const check = (raw: unknown, plan: WindowsNetworkPlan, minimumGeneration: number) => {
    const parsed = receiptSchema.parse(raw);
    if (parsed.leaseId !== leaseId || parsed.planSha256 !== plan.sha256 || parsed.generation < minimumGeneration)
      throw failure("READBACK_MISMATCH");
    return parsed;
  };
  const run = async <T>(expected: typeof state, signal: AbortSignal, operation: (ownedSignal: AbortSignal) => Promise<T>): Promise<T> => {
    if (!(signal instanceof AbortSignal)) throw failure("SIGNAL_REQUIRED");
    if (busy || state !== expected) throw failure("STATE_INVALID");
    signal.throwIfAborted(); busy = true;
    const deadline = createControlledRenderDeadline(WINDOWS_NETWORK_CONTROLLER_OPERATION_TIMEOUT_MILLISECONDS, signal);
    try {return await deadline.run(() => operation(deadline.signal));}
    catch {state = "RECOVERY_REQUIRED"; throw failure("RECOVERY_REQUIRED");}
    finally {deadline.dispose(); busy = false;}
  };
  const verify = async (plan: WindowsNetworkPlan, acknowledged: Receipt, signal: AbortSignal) => {
    signal.throwIfAborted();
    const observed = check(await ports.readEffectivePolicy({...scope}, leaseId, signal), plan, acknowledged.generation);
    signal.throwIfAborted();
    if (observed.generation !== acknowledged.generation) throw failure("READBACK_MISMATCH");
    return observed;
  };
  return {
    status: () => state,
    denyBeforeStart: (signal: AbortSignal) => run("NEW", signal, async signal => {
      const plan = buildWindowsNetworkPlan(scope);
      const ack = check(await ports.acquireAndDenyAll({...scope}, leaseId, structuredClone(plan), signal), plan, 1);
      receipt = await verify(plan, ack, signal); state = "DENIED";
      return {...receipt};
    }),
    allowOriginalServer: (signal: AbortSignal) => run("DENIED", signal, async signal => {
      // No endpoint parameter from caller/HTML. Backend attests the original owned SDK server.
      await verify(buildWindowsNetworkPlan(scope), receipt!, signal);
      const endpoint = windowsLoopbackEndpointSchema.parse(await ports.resolveOriginalServer({...scope}, leaseId, signal));
      signal.throwIfAborted();
      const plan = buildWindowsNetworkPlan(scope, endpoint);
      const ack = check(await ports.replaceAtomically({...scope}, leaseId, receipt!.generation,
        structuredClone(plan), signal), plan, receipt!.generation + 1);
      receipt = await verify(plan, ack, signal); state = "LOCAL_ONLY";
      return {...receipt};
    }),
    sealAfterStop: (signal: AbortSignal) => run("LOCAL_ONLY", signal, async signal => {
      const plan = buildWindowsNetworkPlan(scope);
      const ack = check(await ports.replaceAtomically({...scope}, leaseId, receipt!.generation,
        structuredClone(plan), signal), plan, receipt!.generation + 1);
      receipt = await verify(plan, ack, signal);
      const stopped = z.object({executionId: z.literal(scope.executionId), leaseId: z.literal(leaseId),
        activeProcesses: z.literal(0), jobClosed: z.literal(true)}).strict();
      stopped.parse(await ports.confirmOwnedJobStopped({...scope}, leaseId, signal));
      signal.throwIfAborted(); state = "SEALED";
      return {...receipt};
    }),
  };
}
