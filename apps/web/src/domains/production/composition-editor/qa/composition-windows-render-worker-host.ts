import {dirname, join, resolve} from "node:path";
import {createControlledRenderWorkerHost} from "./composition-controlled-render-worker-host";
import {createWindowsJobBridgeStart, type WindowsJobBridgeConfiguration} from "./composition-windows-job-bridge";
import type {ControlledExecutionFence} from "./composition-controlled-execution-fence";
import {createWindowsNetworkOwnedStart} from "./composition-windows-network-owned-start";

/** Explicit Windows composition; no flag activation, synthetic-driver default or platform fallback. */
export function createWindowsControlledRenderWorkerHost(input:
  Omit<Parameters<typeof createControlledRenderWorkerHost>[0], "ownedExecutor"> & {
    jobBridge: WindowsJobBridgeConfiguration; executionFence: ControlledExecutionFence;
    /** Explicit one-execution network lifecycle. No native/default transport or policy activation. */
    networkLifecycle?: Parameters<typeof createWindowsNetworkOwnedStart>[1];
  }) {
  if (process.platform !== "win32") throw new Error("CONTROLLED_RENDER_WINDOWS_PLATFORM_UNSUPPORTED");
  const inventory = input.dependencyInventory;
  if (input.networkLifecycle && input.jobBridge.onOwnedReady !== undefined)
    throw new Error("CONTROLLED_RENDER_WINDOWS_NETWORK_LIFECYCLE_CONFIGURATION_INVALID");
  const declaredPaths = new Set(inventory.manifest.files.map(file => {
    const root = inventory.roots[file.rootId];
    if (typeof root !== "string") throw new Error("CONTROLLED_RENDER_WINDOWS_BRIDGE_INVENTORY_REQUIRED");
    return resolve(root, file.path);
  }));
  // The adapter may not launch a bridge/helper outside the operator's verified trees.
  for (const path of [input.jobBridge.powerShellPath, input.jobBridge.bridgeScriptPath,
    join(dirname(input.jobBridge.bridgeScriptPath), "OwnedRenderJob.cs"), join(dirname(input.jobBridge.bridgeScriptPath), "OwnedRenderAccess.cs"),
    join(dirname(input.jobBridge.bridgeScriptPath), "OwnedRenderAppContainer.cs")]) {
    if (!declaredPaths.has(path)) throw new Error("CONTROLLED_RENDER_WINDOWS_BRIDGE_INVENTORY_REQUIRED");
  }
  // Capture the same configuration that the bridge validates/clones below.
  // Late configuration changes cannot authorize an unbounded HTML launch.
  const hasResourceLimits = input.jobBridge.resourceLimits !== undefined;
  const jobBridge: WindowsJobBridgeConfiguration = {...input.jobBridge, prepareLaunch: (descriptor, workspace) => {
    if (workspace.measurementPlan?.document.htmlEditing?.items.length && !hasResourceLimits)
      throw new Error("CONFORMANCE_HTML_PROCESS_QUOTAS_REQUIRED");
    const launch = input.jobBridge.prepareLaunch(descriptor, workspace);
    const node = inventory.manifest.roles.node;
    const expectedNodePath = resolve(inventory.roots[node.rootId], node.path);
    const driverPath = launch.arguments[0] ? resolve(launch.directory, launch.arguments[0]) : undefined;
    if (launch.executable !== expectedNodePath || !driverPath || !declaredPaths.has(driverPath))
      throw new Error("CONTROLLED_RENDER_WINDOWS_BRIDGE_INVENTORY_REQUIRED");
    return launch;
  }};
  return createControlledRenderWorkerHost({...input, ownedExecutor: {
    fence: input.executionFence, start: input.networkLifecycle
      ? createWindowsNetworkOwnedStart(jobBridge, input.networkLifecycle) : createWindowsJobBridgeStart(jobBridge),
  }});
}
