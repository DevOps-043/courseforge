import {dirname, resolve, join} from "node:path";
import {fileURLToPath} from "node:url";
import {prepareMaterializedProducerLaunch, decodeMaterializedProducerRequest} from "./materialized-producer-request.mjs";
import {collectMaterializedProducerCandidate} from "./materialized-producer-collector.mjs";

/** Supply to createWindowsControlledRenderWorkerHost. Nothing is activated by constructing it.
 * measure must independently collect supervisor artifacts with its own owned process lifecycle;
 * the producer's job is already stopped, so it cannot contain measurement subprocesses. */
export function createMaterializedProducerBridgeConfiguration(input) {
  if (typeof input.measure !== "function") throw new Error("CONTROLLED_RENDER_MEASUREMENT_REQUIRED");
  const {manifest, roots} = input.dependencyInventory;
  const rolePath = role => {
    const binding = manifest.roles[role], root = roots[binding?.rootId];
    if (!binding || typeof root !== "string") throw new Error("CONTROLLED_RENDER_PRODUCER_ROLE_REQUIRED");
    return resolve(root, binding.path);
  };
  const installation = {nodePath: rolePath("node"), browserPath: rolePath("browser"), encoderPath: rolePath("encoder"),
    probePath: rolePath("decoder"), outputParentDirectory: input.outputParentDirectory};
  const toolDirectory = dirname(fileURLToPath(import.meta.url));
  const declaredPaths = new Set(manifest.files.map(file => resolve(roots[file.rootId], file.path)));
  for (const path of [input.powerShellPath, input.bridgeScriptPath, join(dirname(input.bridgeScriptPath), "OwnedRenderJob.cs"),
    ...["run-materialized-producer.mjs", "controlled-materialized-producer.mjs", "materialized-producer-request.mjs",
      "materialized-producer-capture-audit.mjs"]
      .map(file => join(toolDirectory, file)), installation.nodePath, installation.browserPath,
    installation.encoderPath, installation.probePath]) {
    if (!declaredPaths.has(path)) throw new Error("CONTROLLED_RENDER_PRODUCER_INVENTORY_REQUIRED");
  }
  const prepareLaunch = (descriptor, workspace) => prepareMaterializedProducerLaunch(descriptor, workspace, installation);
  return {powerShellPath: input.powerShellPath, bridgeScriptPath: input.bridgeScriptPath, prepareLaunch,
    collectResult: async (descriptor, workspace, signal) => {
      const launch = prepareLaunch(descriptor, workspace);
      const candidate = await collectMaterializedProducerCandidate(decodeMaterializedProducerRequest(launch.arguments[2]), signal);
      // Do not let a measurer mutate the collector's pinned identity or turn its receipt into evidence.
      const artifacts = await input.measure({descriptor: structuredClone(descriptor), workspace: structuredClone(workspace),
        videoPath: candidate.videoPath, videoPin: structuredClone(candidate.videoPin), signal});
      await candidate.assertUnchanged();
      if (!artifacts || !["SINGLE_CONTRACT", "EVENT_BATCH_SET"].includes(artifacts.kind) || !artifacts.input)
        throw new Error("CONTROLLED_RENDER_MEASUREMENT_INVALID");
      // Supervisor admission still derives/validates the complete comparison binding independently.
      return {videoPath: candidate.videoPath, artifacts};
    }};
}
