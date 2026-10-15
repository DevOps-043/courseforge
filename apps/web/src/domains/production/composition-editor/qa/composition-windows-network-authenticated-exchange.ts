import {createControlledRenderDeadline} from "./composition-controlled-render-deadline";
import {WINDOWS_NETWORK_CONTROLLER_OPERATION_TIMEOUT_MILLISECONDS} from "./composition-windows-network-controller";
import {loadWindowsNetworkBrokerConfiguration} from "./composition-windows-network-broker-configuration";
import {WINDOWS_NETWORK_CHANNEL_POLICY, windowsNetworkCommandSchema} from "./composition-windows-network-channel-contract";
import type {WindowsNetworkExchange} from "./composition-windows-network-command-client";

export type WindowsNetworkManagedExchangeRequest = {
  channelId: string; expectedServerPid: number; expectedServerCreationFileTime: string;
  expectedServerSid: string; expectedServerLogonSid: string; expectedClientSid: string;
  /** Must execute inside this admitted client process, not an arbitrary PowerShell child. */
  expectedClientPid: number; expectedClientCreationFileTime: string; expectedClientLogonSid: string;
  serverSourcePath: string; clientSourcePath: string; payload: Uint8Array;
};
export type WindowsNetworkManagedExchange = (request: WindowsNetworkManagedExchangeRequest, signal: AbortSignal) => Promise<Uint8Array>;
const failure = () => new Error("CONTROLLED_RENDER_NETWORK_CHANNEL_RECOVERY_REQUIRED");

/** Read-only preparation, explicit exchange invocation only. Managed runtime MUST invoke
 * AuthenticatedNetworkPipe.ExchangeBoundOnceAsync in the admitted client process and bind its token/
 * creation identity. Spawning a child changes PID and cannot satisfy server peer authentication.
 * No runtime default, compilation, pipe opening or native action during preparation. */
export async function prepareWindowsAuthenticatedNetworkExchange(reference: {path: string; sha256: string},
  invokeManaged: WindowsNetworkManagedExchange, signal: AbortSignal): Promise<WindowsNetworkExchange> {
  if (typeof invokeManaged !== "function") throw failure();
  const admitted = await loadWindowsNetworkBrokerConfiguration(reference, signal);
  const configuration = structuredClone(admitted.configuration);
  const binding = configuration.binding;
  let busy = false, failed = false, sequence = 1;
  return async (bytes, externalSignal) => {
    if (busy || failed || externalSignal.aborted || sequence > 3) throw failure();
    busy = true;
    const deadline = createControlledRenderDeadline(WINDOWS_NETWORK_CONTROLLER_OPERATION_TIMEOUT_MILLISECONDS, externalSignal);
    try {
      return await deadline.run(async ownedSignal => {
        await admitted.assertUnchanged(ownedSignal);
        if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > WINDOWS_NETWORK_CHANNEL_POLICY.maximumPayloadBytes) throw failure();
        const payload = Uint8Array.from(bytes);
        const command = windowsNetworkCommandSchema.parse(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(payload)));
        if (command.channelId !== binding.channelId || command.operationNonce !== binding.operationNonce
          || command.sequence !== sequence || JSON.stringify(command.scope) !== JSON.stringify(binding.scope)
          || process.pid !== configuration.clientPeer.pid) throw failure();
        const response = await invokeManaged({channelId: binding.channelId, expectedServerPid: configuration.brokerPeer.pid,
          expectedServerCreationFileTime: configuration.brokerPeer.creationFileTime,
          expectedServerSid: configuration.brokerPeer.accountSid, expectedServerLogonSid: configuration.brokerPeer.logonSid,
          expectedClientPid: configuration.clientPeer.pid, expectedClientCreationFileTime: configuration.clientPeer.creationFileTime,
          expectedClientSid: configuration.clientPeer.accountSid, expectedClientLogonSid: configuration.clientPeer.logonSid,
          serverSourcePath: configuration.files.server.path, clientSourcePath: configuration.files.client.path, payload}, ownedSignal);
        ownedSignal.throwIfAborted();
        if (!(response instanceof Uint8Array) || response.byteLength < 1
          || response.byteLength > WINDOWS_NETWORK_CHANNEL_POLICY.maximumPayloadBytes) throw failure();
        const captured = Uint8Array.from(response);
        await admitted.assertUnchanged(ownedSignal); ownedSignal.throwIfAborted();
        sequence++; return captured;
      });
    } catch {failed = true; throw failure();}
    finally {busy = false; deadline.dispose();}
  };
}
