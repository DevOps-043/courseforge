import {createControlledRenderDeadline} from "./composition-controlled-render-deadline";
import {createWindowsNetworkController, WINDOWS_NETWORK_CONTROLLER_OPERATION_TIMEOUT_MILLISECONDS} from "./composition-windows-network-controller";
import {createWindowsNetworkCommandDispatcher} from "./composition-windows-network-command-dispatcher";
import {CompositionWindowsNetworkJournal} from "./composition-windows-network-journal";
import {createJournaledWindowsNetworkPorts, type WindowsNetworkNativePorts} from "./composition-windows-network-journaled-ports";
import {loadWindowsNetworkBrokerConfiguration, type WindowsNetworkBrokerConfiguration} from "./composition-windows-network-broker-configuration";

export interface WindowsNetworkBrokerHostPorts {
  /** Explicit native initialization may load the admitted DLL; never runs during prepare. */
  createNativePorts(configuration: WindowsNetworkBrokerConfiguration, signal: AbortSignal): Promise<WindowsNetworkNativePorts>;
  /** Must invoke C# peer authentication BEFORE invoking the callback, exactly once. */
  serveAuthenticatedOnce(configuration: WindowsNetworkBrokerConfiguration,
    dispatch: (bytes: Uint8Array, signal: AbortSignal) => Promise<Buffer>, signal: AbortSignal): Promise<void>;
}
const fail = () => new Error("CONTROLLED_RENDER_NETWORK_CONTROLLER_RECOVERY_REQUIRED");

/** Operator-only composition root, not a registered worker, service or default transport.
 * Preparation is read-only; serving is a separate explicit activation boundary. */
export async function prepareWindowsNetworkBrokerHost(input: {path: string; sha256: string},
  ports: WindowsNetworkBrokerHostPorts, signal: AbortSignal) {
  if (typeof ports?.createNativePorts !== "function" || typeof ports?.serveAuthenticatedOnce !== "function") throw fail();
  const admitted = await loadWindowsNetworkBrokerConfiguration(input, signal);
  const configuration = structuredClone(admitted.configuration);
  let dispatch: ReturnType<typeof createWindowsNetworkCommandDispatcher> | undefined;
  let busy = false, quarantined = false, sessions = 0;
  return {isQuarantined: () => quarantined,
    serveOnce: async (externalSignal: AbortSignal) => {
      if (busy || quarantined || sessions >= 3 || externalSignal.aborted) throw fail();
      busy = true;
      const deadline = createControlledRenderDeadline(WINDOWS_NETWORK_CONTROLLER_OPERATION_TIMEOUT_MILLISECONDS, externalSignal);
      try {
        await deadline.run(async ownedSignal => {
          await admitted.assertUnchanged(ownedSignal);
          if (!dispatch) {
            const native = await ports.createNativePorts(structuredClone(configuration), ownedSignal);
            ownedSignal.throwIfAborted(); await admitted.assertUnchanged(ownedSignal);
            const journal = new CompositionWindowsNetworkJournal(configuration.journalDirectory);
            const controller = createWindowsNetworkController(configuration.binding.scope, createJournaledWindowsNetworkPorts(journal, native));
            dispatch = createWindowsNetworkCommandDispatcher(configuration.binding, journal, controller);
          }
          let called = false, completed = false;
          await ports.serveAuthenticatedOnce(structuredClone(configuration), async (bytes, peerSignal) => {
            ownedSignal.throwIfAborted(); if (called || peerSignal.aborted) throw fail(); called = true;
            // Host deadline cannot be replaced with an unrelated non-aborted peer signal.
            const commandSignal = AbortSignal.any([ownedSignal, peerSignal]);
            const response = await dispatch!(bytes, commandSignal); commandSignal.throwIfAborted();
            await admitted.assertUnchanged(commandSignal); completed = true; return response;
          }, ownedSignal);
          ownedSignal.throwIfAborted();
          if (!called || !completed) throw fail();
          await admitted.assertUnchanged(ownedSignal); sessions++;
        });
      } catch {quarantined = true; throw fail();}
      finally {deadline.dispose(); busy = false;}
      // No automatic dispose/unload/reclaim: uncertain native work and filters remain operator-owned.
    }};
}
