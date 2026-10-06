import {isAbsolute,relative,sep} from "node:path";
import type {ControlledSupervisorRenderer} from "./composition-render-supervisor.service";
import {materializeControlledRenderRevision} from "./composition-controlled-render-materialization";
import {admitControlledDependencyInventory, type ControlledDependencyInventoryConfiguration} from "./composition-controlled-dependency-inventory";
import {requiresControlledExecutorIntervention} from "./composition-controlled-execution-fence";

type Workspace = Awaited<ReturnType<typeof materializeControlledRenderRevision>>;
export type ControlledMaterializedExecutor = (descriptor: Parameters<ControlledSupervisorRenderer>[0],
  workspace: Pick<Workspace,"directory" | "entryPath" | "receipt">,
  signal?: AbortSignal) => ReturnType<ControlledSupervisorRenderer>;

/** Connects authorized materialization to the host coordinator. Does not supply or simulate OS isolation. */
export function createMaterializedControlledRenderer(input: {
  dependencyInventory?: ControlledDependencyInventoryConfiguration;
  storage: Pick<Parameters<typeof materializeControlledRenderRevision>[0],"supabase" | "supabaseUrl" | "outputParentDirectory" | "fetchImpl" | "animationRuntimeSha256" | "readHtmlEditingAuthority">;
  execute: ControlledMaterializedExecutor;
}): ControlledSupervisorRenderer {
  return async (descriptor,signal) => {
    const execution = descriptor.contract.schemaVersion === 4 ? descriptor.contract.renderExecution : undefined;
    if (input.dependencyInventory && !execution)
      throw new Error("CONTROLLED_RENDER_DEPENDENCY_EXECUTION_REQUIRED");
    const dependencies = input.dependencyInventory ? await admitControlledDependencyInventory(
      input.dependencyInventory, execution!, signal) : undefined;
    const workspace = await materializeControlledRenderRevision({...input.storage,organizationId:descriptor.organizationId,
      revisionId:descriptor.revisionId,expected:descriptor,signal});
    let terminationUnconfirmed = false;
    try {
      await dependencies?.assertUnchanged();
      signal?.throwIfAborted();
      const result = await input.execute(structuredClone(descriptor),{directory:workspace.directory,entryPath:workspace.entryPath,
        receipt:structuredClone(workspace.receipt)},signal);
      signal?.throwIfAborted();
      const outputRelative = relative(workspace.directory,result.videoPath);
      const insideInputDirectory = outputRelative === "" || (!isAbsolute(outputRelative)
        && outputRelative !== ".." && !outputRelative.startsWith(`..${sep}`));
      if (!isAbsolute(result.videoPath) || insideInputDirectory)
        throw new Error("CONTROLLED_RENDER_OUTPUT_OWNERSHIP_INVALID");
      await workspace.assertUnchanged();
      await dependencies?.assertUnchanged();
      signal?.throwIfAborted();
      return result;
    } catch (error) {
      terminationUnconfirmed = error instanceof Error && requiresControlledExecutorIntervention(error.message);
      throw error;
    } finally {
      // Do not remove files that an unconfirmed process tree could still be using.
      if (!terminationUnconfirmed) await workspace.cleanup();
    }
  };
}
