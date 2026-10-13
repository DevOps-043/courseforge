import {createHash} from "node:crypto";
import {z} from "zod";
import {CompositionWindowsNetworkJournal, type WindowsNetworkIntent} from "./composition-windows-network-journal";
import {encodeWindowsNetworkNativeRecord, windowsNetworkNativeConfigurationSchema} from "./composition-windows-network-native-record";
import {createControlledRenderDeadline} from "./composition-controlled-render-deadline";
import {WINDOWS_NETWORK_CONTROLLER_OPERATION_TIMEOUT_MILLISECONDS} from "./composition-windows-network-controller";

export type ManagedWindowsNetworkInvocation = (call: {operation: 1 | 2 | 3; previous: Buffer | null; next: Buffer;
  providerId: string; sublayerId: string; leaseId: string; packageSid: string}, signal: AbortSignal) => Promise<unknown>;
const ownedObservationSchema = z.object({Scope: z.literal("OWNED_FILTERS_MATCH_NOT_EFFECTIVE_NETWORK_POLICY"),
  Operation: z.number().int().min(1).max(3), RecordSha256: z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const fail = () => new Error("CONTROLLED_RENDER_NETWORK_CONTROLLER_RECOVERY_REQUIRED");

/** Concrete binary/owner binding for NetworkPolicyInvocation.Invoke, never a global-policy port.
 * Managed invoker must come from admitted DLL/C# bridge; no default subprocess or activation. */
export function createWindowsOwnedNetworkPolicyInvoker(rawAuthority: z.infer<typeof windowsNetworkNativeConfigurationSchema>,
  journal: CompositionWindowsNetworkJournal, invokeManaged: ManagedWindowsNetworkInvocation) {
  const authority = windowsNetworkNativeConfigurationSchema.parse(rawAuthority);
  if (typeof invokeManaged !== "function") throw fail();
  let busy = false, quarantined = false;
  const checkIntent = async (intent: WindowsNetworkIntent, signal: AbortSignal) => {
    const stored = await journal.readIntent(intent.scope, intent.leaseId, intent.generation, signal);
    if (JSON.stringify(stored) !== JSON.stringify(intent)) throw fail();
  };
  const invoke = async (operation: 1 | 2 | 3, previous: WindowsNetworkIntent | undefined,
    intent: WindowsNetworkIntent, signal: AbortSignal) => {
    if (!(signal instanceof AbortSignal) || signal.aborted || busy || quarantined) throw fail();
    busy = true;
    const deadline = createControlledRenderDeadline(WINDOWS_NETWORK_CONTROLLER_OPERATION_TIMEOUT_MILLISECONDS, signal);
    try {
      return await deadline.run(async ownedSignal => {
        await checkIntent(intent, ownedSignal);
        if (operation === 1 && intent.generation !== 1) throw fail();
        if (previous) {
          await checkIntent(previous, ownedSignal);
          if (previous.leaseId !== intent.leaseId || JSON.stringify(previous.scope) !== JSON.stringify(intent.scope)
            || intent.generation !== previous.generation + 1) throw fail();
        }
        const next = encodeWindowsNetworkNativeRecord(intent, authority);
        const previousBytes = previous ? encodeWindowsNetworkNativeRecord(previous, authority) : null;
        const recordSha256 = createHash("sha256").update(next).digest("hex");
        const observed = ownedObservationSchema.parse(await invokeManaged({operation, previous: previousBytes, next: Buffer.from(next),
          ...authority, leaseId: intent.leaseId, packageSid: intent.scope.appContainerSid}, ownedSignal));
        ownedSignal.throwIfAborted();
        if (observed.Operation !== operation || observed.RecordSha256 !== recordSha256) throw fail();
        await checkIntent(intent, ownedSignal); if (previous) await checkIntent(previous, ownedSignal);
        ownedSignal.throwIfAborted(); return observed;
      });
    } catch {quarantined = true; throw fail();}
    finally {deadline.dispose(); busy = false;}
  };
  return {isQuarantined: () => quarantined,
    installInitialDenyAll: (intent: WindowsNetworkIntent, signal: AbortSignal) => invoke(1, undefined, intent, signal),
    replaceOwnedPolicy: (previous: WindowsNetworkIntent, next: WindowsNetworkIntent, signal: AbortSignal) => invoke(2, previous, next, signal),
    readOwnedPolicy: (intent: WindowsNetworkIntent, signal: AbortSignal) => invoke(3, undefined, intent, signal)};
}
