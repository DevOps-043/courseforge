import {randomUUID} from "node:crypto";
import type {z} from "zod";
import {createControlledRenderDeadline} from "./composition-controlled-render-deadline";
import {WINDOWS_NETWORK_CONTROLLER_OPERATION_TIMEOUT_MILLISECONDS} from "./composition-windows-network-controller";
import {buildWindowsNetworkPlan, type WindowsLoopbackEndpoint} from "./composition-windows-network-policy";
import {WINDOWS_NETWORK_CHANNEL_POLICY, WINDOWS_NETWORK_COMMAND_ORDER, windowsNetworkChannelBindingSchema,
  windowsNetworkCommandSchema, windowsNetworkCommandResponseSchema} from "./composition-windows-network-channel-contract";

export type WindowsNetworkExchange = (payload: Buffer, signal: AbortSignal) => Promise<Uint8Array>;
const fail = () => new Error("CONTROLLED_RENDER_NETWORK_CHANNEL_RECOVERY_REQUIRED");

/** Host-owned command client. Exchange MUST authenticate native pipe server before writing.
 * No transport default, automatic reconnect/replay, or restart from a declarative response. */
export function createWindowsNetworkCommandClient(rawBinding: z.infer<typeof windowsNetworkChannelBindingSchema>, exchange: WindowsNetworkExchange) {
  const binding = windowsNetworkChannelBindingSchema.parse(rawBinding);
  if (typeof exchange !== "function") throw fail();
  let nextSequence = 1, busy = false, failed = false, leaseId: string | undefined;
  const send = async (sequence: number, expectedPlanSha256: string, signal: AbortSignal) => {
    if (!(signal instanceof AbortSignal) || signal.aborted || busy || failed || sequence !== nextSequence) throw fail();
    const request = windowsNetworkCommandSchema.parse({policy: WINDOWS_NETWORK_CHANNEL_POLICY.id, ...binding,
      requestId: randomUUID(), sequence, command: WINDOWS_NETWORK_COMMAND_ORDER[sequence - 1]});
    const encoded = Buffer.from(JSON.stringify(request));
    if (encoded.length > WINDOWS_NETWORK_CHANNEL_POLICY.maximumPayloadBytes) throw fail();
    busy = true;
    const deadline = createControlledRenderDeadline(WINDOWS_NETWORK_CONTROLLER_OPERATION_TIMEOUT_MILLISECONDS, signal);
    try {
      return await deadline.run(async ownedSignal => {
        const raw = await exchange(encoded, ownedSignal); ownedSignal.throwIfAborted();
        if (!(raw instanceof Uint8Array) || raw.byteLength === 0 || raw.byteLength > WINDOWS_NETWORK_CHANNEL_POLICY.maximumPayloadBytes) throw fail();
        const response = windowsNetworkCommandResponseSchema.parse(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(raw)));
        const {receipt, ...echo} = response;
        if (JSON.stringify(echo) !== JSON.stringify(request) || receipt.generation !== sequence
          || receipt.planSha256 !== expectedPlanSha256 || leaseId !== undefined && receipt.leaseId !== leaseId) throw fail();
        ownedSignal.throwIfAborted(); leaseId = receipt.leaseId; nextSequence++;
        return {...receipt};
      });
    } catch {failed = true; throw fail();}
    finally {deadline.dispose(); busy = false;}
  };
  return {
    status: () => failed ? "RECOVERY_REQUIRED" as const : (["NEW", "DENIED", "LOCAL_ONLY", "SEALED"] as const)[nextSequence - 1],
    denyBeforeStart: (signal: AbortSignal) => send(1, buildWindowsNetworkPlan(binding.scope).sha256, signal),
    /** Expected endpoint comes from independently owned original SDK observation, never broker response/HTML. */
    allowOriginalServer: (expectedEndpoint: WindowsLoopbackEndpoint, signal: AbortSignal) =>
      send(2, buildWindowsNetworkPlan(binding.scope, expectedEndpoint).sha256, signal),
    sealAfterStop: (signal: AbortSignal) => send(3, buildWindowsNetworkPlan(binding.scope).sha256, signal),
  };
}
