import {z} from "zod";
import {createControlledRenderDeadline} from "./composition-controlled-render-deadline";
import {CONTROLLED_EXECUTOR_OWNERSHIP_POLICY, type ControlledOwnedExecutorConfiguration} from "./composition-controlled-owned-executor";
import {createWindowsJobBridgeStart, type WindowsJobBridgeConfiguration, type WindowsOwnedRootControl,
  type WindowsOwnedRootIdentity} from "./composition-windows-job-bridge";
import type {createWindowsNetworkCommandClient} from "./composition-windows-network-command-client";
import {windowsAppContainerSidSchema} from "./composition-windows-reduced-token-policy";

type DefaultWorkspace = Parameters<ControlledOwnedExecutorConfiguration["start"]>[1];
const recovery = () => new Error("CONTROLLED_RENDER_NETWORK_CONTROLLER_RECOVERY_REQUIRED");

/** One operator-bound execution, with synchronous ownership of the pending launch intent.
 * No native default, service activation, retry, policy removal, or fabricated no-process STOP.
 * serveOriginalServer owns the mailbox/signing key and must drain before returning.
 * Broker's seal port still MUST independently confirm the original owned Job is closed. */
export function createWindowsNetworkOwnedStart<TResult, TWorkspace extends {directory: string} = DefaultWorkspace>(
  bridge: Omit<WindowsJobBridgeConfiguration<TResult, TWorkspace>, "onOwnedReady">,
  network: {executionId: string; organizationId: string; appContainerSid: string; client: ReturnType<typeof createWindowsNetworkCommandClient>;
    serveOriginalServer: (root: WindowsOwnedRootIdentity, control: WindowsOwnedRootControl, signal: AbortSignal) => Promise<void>},
  ports: Parameters<typeof createWindowsJobBridgeStart>[1] = {},
): ControlledOwnedExecutorConfiguration<TResult, TWorkspace>["start"] {
  const executionId = z.string().uuid().parse(network.executionId);
  const organizationId = z.string().uuid().parse(network.organizationId);
  const appContainerSid = windowsAppContainerSidSchema.parse(network.appContainerSid);
  if (bridge.reducedToken?.policy !== "WINDOWS_APPCONTAINER_NO_NETWORK_V5" || bridge.reducedToken.appContainerSid !== appContainerSid)
    throw recovery();
  const client = network.client, serve = network.serveOriginalServer;
  if (typeof serve !== "function" || client.status() !== "NEW") throw recovery();
  const startBridge = createWindowsJobBridgeStart({...bridge,
    onOwnedReady: async (descriptor, _workspace, root, signal, control) => {
      if (descriptor.executionId !== executionId || client.status() !== "DENIED") throw recovery();
      await serve(root, control, signal);
      if (client.status() !== "LOCAL_ONLY") throw recovery();
    }}, ports);
  let used = false;
  return (descriptor, workspace, signal) => {
    if (used || descriptor.executionId !== executionId || descriptor.organizationId !== organizationId || signal.aborted) throw recovery();
    used = true;
    const capturedDescriptor = structuredClone(descriptor), capturedWorkspace = structuredClone(workspace);
    const cancellation = new AbortController();
    const ownedSignal = AbortSignal.any([signal, cancellation.signal]);
    let stopRequested = false;
    let stopWork: Promise<unknown> | undefined;
    // Promise is retained and drained; it never yields an untracked handle after cancellation.
    const launched = Promise.resolve().then(async () => {
      await client.denyBeforeStart(ownedSignal);
      if (stopRequested || ownedSignal.aborted || client.status() !== "DENIED") throw recovery();
      return startBridge(capturedDescriptor, capturedWorkspace, ownedSignal);
    });
    void launched.catch(() => {});
    const stopAndConfirm = () => {
      if (!stopWork) {
        stopRequested = true;
        // Cancel prelaunch/native command work too. Retain the parent's fence if its drain hangs.
        cancellation.abort();
        stopWork = (async () => {
          let execution;
          try {execution = await launched;} catch {throw recovery();}
          const confirmation = await execution.stopAndConfirm();
          const cleanup = createControlledRenderDeadline(CONTROLLED_EXECUTOR_OWNERSHIP_POLICY.maximumStopMilliseconds);
          try {
            // Use a distinct cleanup signal: a cancelled render still needs a bounded deny-all seal.
            await cleanup.run(async cleanupSignal => {
              await client.sealAfterStop(cleanupSignal);
              cleanupSignal.throwIfAborted();
              if (client.status() !== "SEALED") throw recovery();
            });
            return confirmation;
          } catch {throw recovery();}
          finally {cleanup.dispose();}
        })();
        void stopWork.catch(() => {});
      }
      return stopWork;
    };
    const completion = launched.then(async execution => {
      const candidate = await execution.completion;
      await stopAndConfirm();
      signal.throwIfAborted();
      return candidate;
    });
    void completion.catch(() => {});
    return {completion, stopAndConfirm};
  };
}
