import type {WindowsNetworkControllerPorts} from "./composition-windows-network-controller";
import {CompositionWindowsNetworkJournal, windowsNetworkObservationSchema,
  type WindowsNetworkIntent} from "./composition-windows-network-journal";
import type {WindowsNetworkScope} from "./composition-windows-network-policy";

/** Operator native bridge only. A cached plan or journal is not an effective-policy readback.
 * Implementations must translate/read BFE and separately validate arbitration and ownership. */
export interface WindowsNetworkNativePorts {
  installInitialDenyAll(intent: WindowsNetworkIntent, signal: AbortSignal): Promise<void>;
  replaceOwnedPolicy(previous: WindowsNetworkIntent, next: WindowsNetworkIntent, signal: AbortSignal): Promise<void>;
  readEffectivePolicy(intent: WindowsNetworkIntent, signal: AbortSignal): Promise<unknown>;
  resolveOriginalServer(scope: WindowsNetworkScope, leaseId: string, signal: AbortSignal): Promise<unknown>;
  confirmOwnedJobStopped(scope: WindowsNetworkScope, leaseId: string, signal: AbortSignal): Promise<unknown>;
}
const fail = () => new Error("CONTROLLED_RENDER_NETWORK_CONTROLLER_RECOVERY_REQUIRED");

/** Connects immutable journal ordering to the lifecycle. No native default, service or activation.
 * One host-owned instance per controller; restart requires explicit recovery, never a latest lookup. */
export function createJournaledWindowsNetworkPorts(journal: CompositionWindowsNetworkJournal,
  native: WindowsNetworkNativePorts): WindowsNetworkControllerPorts {
  for (const method of ["installInitialDenyAll", "replaceOwnedPolicy", "readEffectivePolicy", "resolveOriginalServer", "confirmOwnedJobStopped"] as const)
    if (typeof native?.[method] !== "function") throw fail();
  let current: WindowsNetworkIntent | undefined;
  const checkNative = async (intent: WindowsNetworkIntent, signal: AbortSignal) => {
    signal.throwIfAborted();
    const observed = windowsNetworkObservationSchema.parse(await native.readEffectivePolicy(structuredClone(intent), signal));
    signal.throwIfAborted();
    if (observed.leaseId !== intent.leaseId || observed.generation !== intent.generation
      || observed.intentSha256 !== intent.sha256 || observed.planSha256 !== intent.plan.sha256
      || JSON.stringify(observed.filterKeys) !== JSON.stringify(intent.filterKeys)) throw fail();
    return observed;
  };
  const owned = async (scope: WindowsNetworkScope, leaseId: string, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (!current || current.leaseId !== leaseId || JSON.stringify(current.scope) !== JSON.stringify(scope)) throw fail();
    const stored = await journal.readIntent(scope, leaseId, current.generation, signal);
    if (JSON.stringify(stored) !== JSON.stringify(current)) throw fail();
    await journal.readObservation(stored, signal);
    return stored;
  };
  const receipt = (intent: WindowsNetworkIntent) => ({leaseId: intent.leaseId, generation: intent.generation,
    planSha256: intent.plan.sha256, persistent: true as const});
  return {
    acquireAndDenyAll: async (scope, leaseId, plan, signal) => {
      try {
        if (current) throw fail();
        const intent = await journal.acquire(scope, leaseId, plan, signal);
        signal.throwIfAborted();
        await native.installInitialDenyAll(structuredClone(intent), signal);
        const observed = await checkNative(intent, signal);
        await journal.recordObservation(intent, observed, signal);
        signal.throwIfAborted(); current = intent;
        return receipt(intent);
      } catch {throw fail();}
    },
    replaceAtomically: async (scope, leaseId, previousGeneration, plan, signal) => {
      try {
        const previous = await owned(scope, leaseId, signal);
        if (previous.generation !== previousGeneration) throw fail();
        await checkNative(previous, signal);
        const next = await journal.reserveNext(scope, leaseId, previousGeneration, plan, signal);
        signal.throwIfAborted();
        await native.replaceOwnedPolicy(structuredClone(previous), structuredClone(next), signal);
        await journal.recordObservation(next, await checkNative(next, signal), signal);
        signal.throwIfAborted(); current = next;
        return receipt(next);
      } catch {throw fail();}
    },
    readEffectivePolicy: async (scope, leaseId, signal) => {
      try {const intent = await owned(scope, leaseId, signal); await checkNative(intent, signal); return receipt(intent);}
      catch {throw fail();}
    },
    resolveOriginalServer: async (scope, leaseId, signal) => {
      await owned(scope, leaseId, signal); return native.resolveOriginalServer(structuredClone(scope), leaseId, signal);
    },
    confirmOwnedJobStopped: async (scope, leaseId, signal) => {
      await owned(scope, leaseId, signal); return native.confirmOwnedJobStopped(structuredClone(scope), leaseId, signal);
    },
  };
}
