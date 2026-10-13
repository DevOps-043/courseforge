import {z} from "zod";
import {createControlledRenderDeadline} from "./composition-controlled-render-deadline";
import {WINDOWS_NETWORK_CONTROLLER_OPERATION_TIMEOUT_MILLISECONDS} from "./composition-windows-network-controller";
import {CompositionWindowsNetworkJournal} from "./composition-windows-network-journal";
import type {createWindowsNetworkController} from "./composition-windows-network-controller";
import {WINDOWS_NETWORK_CHANNEL_POLICY, windowsNetworkCommandSchema, windowsNetworkCommandResponseSchema,
  windowsNetworkChannelBindingSchema} from "./composition-windows-network-channel-contract";

const bindingSchema = windowsNetworkChannelBindingSchema;
const fail = () => new Error("CONTROLLED_RENDER_NETWORK_CHANNEL_RECOVERY_REQUIRED");
type Controller = Pick<ReturnType<typeof createWindowsNetworkController>, "denyBeforeStart" | "allowOriginalServer" | "sealAfterStop">;

/** Broker-owned dispatcher, callable ONLY after native pipe peer authentication.
 * Configuration comes from the operator/launch owner, never from payload or HTML. */
export function createWindowsNetworkCommandDispatcher(rawBinding: z.infer<typeof bindingSchema>,
  journal: CompositionWindowsNetworkJournal, controller: Controller) {
  const binding = bindingSchema.parse(rawBinding);
  let nextSequence = 1, busy = false, failed = false, leaseId: string | undefined;
  return async (bytes: Uint8Array, signal: AbortSignal): Promise<Buffer> => {
    if (!(signal instanceof AbortSignal) || signal.aborted || busy || failed) throw fail();
    let request: z.infer<typeof windowsNetworkCommandSchema>;
    try {
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > WINDOWS_NETWORK_CHANNEL_POLICY.maximumPayloadBytes) throw fail();
      request = windowsNetworkCommandSchema.parse(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)));
      if (request.channelId !== binding.channelId || request.operationNonce !== binding.operationNonce
        || JSON.stringify(request.scope) !== JSON.stringify(binding.scope) || request.sequence !== nextSequence) throw fail();
    } catch {throw fail();}
    busy = true;
    const deadline = createControlledRenderDeadline(WINDOWS_NETWORK_CONTROLLER_OPERATION_TIMEOUT_MILLISECONDS, signal);
    try {
      return await deadline.run(async ownedSignal => {
        await journal.reserveCommand(request, ownedSignal); ownedSignal.throwIfAborted();
        const receipt = request.command === "DENY_BEFORE_START" ? await controller.denyBeforeStart(ownedSignal)
          : request.command === "ALLOW_ORIGINAL_SERVER" ? await controller.allowOriginalServer(ownedSignal)
          : await controller.sealAfterStop(ownedSignal);
        ownedSignal.throwIfAborted();
        const response = windowsNetworkCommandResponseSchema.parse({...request, receipt});
        if (response.receipt.generation !== request.sequence || leaseId !== undefined && response.receipt.leaseId !== leaseId) throw fail();
        const encoded = Buffer.from(JSON.stringify(response));
        if (encoded.length > WINDOWS_NETWORK_CHANNEL_POLICY.maximumPayloadBytes) throw fail();
        leaseId = response.receipt.leaseId; nextSequence++;
        return encoded;
      });
    } catch {failed = true; throw fail();}
    finally {deadline.dispose(); busy = false;}
  };
}
