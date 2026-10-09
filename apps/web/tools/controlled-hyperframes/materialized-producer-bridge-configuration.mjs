import {dirname, resolve, join} from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {prepareMaterializedProducerLaunch, decodeMaterializedProducerRequest} from "./materialized-producer-request.mjs";
import {collectMaterializedProducerCandidate} from "./materialized-producer-collector.mjs";
import {parseObservedOperatorReference} from "./observed-producer-operator-reference.mjs";
const require = createRequire(new URL("../../package.json", import.meta.url));

/** Supply to createWindowsControlledRenderWorkerHost. Nothing is activated by constructing it.
 * measure must independently collect supervisor artifacts with its own owned process lifecycle;
 * the producer's job is already stopped, so it cannot contain measurement subprocesses. */
export function createMaterializedProducerBridgeConfiguration(input) {
  if (typeof input.measure !== "function") throw new Error("CONTROLLED_RENDER_MEASUREMENT_REQUIRED");
  const {windowsJobResourceLimitsSchema} = require("./dist/composition-worker/domains/production/composition-editor/qa/composition-windows-job-resource-policy.js");
  const resourceLimits = input.resourceLimits === undefined ? undefined : windowsJobResourceLimitsSchema.parse(input.resourceLimits);
  const {windowsReducedTokenSchema} = require("./dist/composition-worker/domains/production/composition-editor/qa/composition-windows-reduced-token-policy.js");
  const reducedToken = input.reducedToken === undefined ? undefined : windowsReducedTokenSchema.parse(input.reducedToken);
  if (reducedToken && !resourceLimits) throw new Error("CONTROLLED_RENDER_WINDOWS_RESOURCE_LIMIT_REQUIRED");
  const {manifest, roots} = input.dependencyInventory;
  const rolePath = role => {
    const binding = manifest.roles[role], root = roots[binding?.rootId];
    if (!binding || typeof root !== "string") throw new Error("CONTROLLED_RENDER_PRODUCER_ROLE_REQUIRED");
    return resolve(root, binding.path);
  };
  const installation = {nodePath: rolePath("node"), browserPath: rolePath("browser"), encoderPath: rolePath("encoder"),
    probePath: rolePath("decoder"), outputParentDirectory: input.outputParentDirectory};
  if (Object.hasOwn(input, "operatorConfiguration")) {
    const reference = parseObservedOperatorReference(input.operatorConfiguration);
    const declared = manifest.files.find(file => resolve(roots[file.rootId], file.path) === reference.path);
    if (!declared || declared.sha256 !== reference.sha256) throw new Error("CONTROLLED_RENDER_OBSERVED_CONFIGURATION_INVENTORY_REQUIRED");
    installation.operatorConfiguration = reference;
  }
  const toolDirectory = dirname(fileURLToPath(import.meta.url));
  const declaredPaths = new Set(manifest.files.map(file => resolve(roots[file.rootId], file.path)));
  for (const path of [input.powerShellPath, input.bridgeScriptPath, join(dirname(input.bridgeScriptPath), "OwnedRenderJob.cs"),
    join(dirname(input.bridgeScriptPath), "OwnedRenderAccess.cs"),
    join(dirname(input.bridgeScriptPath), "OwnedRenderAppContainer.cs"),
    ...["run-materialized-producer.mjs", "controlled-materialized-producer.mjs", "materialized-producer-request.mjs",
      "materialized-producer-capture-audit.mjs", "admitted-observed-producer.mjs",
      "build-producer-extension-v1.mjs", "producer-extension-v1.mjs", "producer-extension-files.mjs",
      "observed-producer-operator-reference.mjs", "original-session-receipt.mjs", "original-session-observer.mjs",
      "materialized-measurement-plan-policy.mjs", "original-native-receipt.mjs",
      ...(installation.operatorConfiguration ? ["run-observed-materialized-producer.mjs", "original-session-observer.mjs",
        "observed-producer-operator-configuration.mjs", "materialized-measurement-plan.mjs", "original-session-native-observer.mjs",
        "original-session-sdr-stages.mjs", "closed-stage-executor.mjs"] : [])]
      .map(file => join(toolDirectory, file)), installation.nodePath, installation.browserPath,
    installation.encoderPath, installation.probePath]) {
    if (!declaredPaths.has(path)) throw new Error("CONTROLLED_RENDER_PRODUCER_INVENTORY_REQUIRED");
  }
  const prepareLaunch = (descriptor, workspace) => prepareMaterializedProducerLaunch(descriptor, workspace, installation);
  return {powerShellPath: input.powerShellPath, bridgeScriptPath: input.bridgeScriptPath, prepareLaunch,
    ...(resourceLimits ? {resourceLimits} : {}),
    ...(reducedToken ? {reducedToken} : {}),
    collectResult: async (descriptor, workspace, signal) => {
      const launch = prepareLaunch(descriptor, workspace);
      const expectedObservation = installation.operatorConfiguration ? {execution: descriptor.contract.renderExecution,
        frameCount: Math.ceil(descriptor.contract.canvas.durationSeconds * descriptor.contract.canvas.fps), contract: descriptor.contract,
        document: workspace.measurementPlan?.document} : undefined;
      const candidate = await collectMaterializedProducerCandidate(decodeMaterializedProducerRequest(launch.arguments[2]), signal, expectedObservation);
      // Do not let a measurer mutate the collector's pinned identity or turn its receipt into evidence.
      const measured = await input.measure({descriptor: structuredClone(descriptor), workspace: structuredClone(workspace),
        videoPath: candidate.videoPath, videoPin: structuredClone(candidate.videoPin), signal,
        ...(candidate.originalSession ? {originalSession: structuredClone(candidate.originalSession),
          originalSessionPin: structuredClone(candidate.originalSessionPin)} : {}),
        ...(candidate.originalNative ? {originalNative: structuredClone(candidate.originalNative),
          originalNativePin: structuredClone(candidate.originalNativePin)} : {})});
      const withSelection = measured?.kind === "MEASURED_REFERENCE_ARTIFACTS";
      let artifacts = withSelection ? measured.artifacts : measured;
      let referenceSelection;
      if (withSelection) {
        const selectorPath = resolve(toolDirectory, "../../dist/composition-worker/domains/production/composition-editor/qa/composition-controlled-reference-selection.js");
        if (!declaredPaths.has(selectorPath)) throw new Error("CONTROLLED_RENDER_REFERENCE_MEASURER_INVENTORY_REQUIRED");
        const {controlledReferenceSelectionSchema, bindControlledReferenceSelection} = require("./dist/composition-worker/domains/production/composition-editor/qa/composition-controlled-reference-selection.js");
        const selected = controlledReferenceSelectionSchema.parse(measured.referenceSelection);
        referenceSelection = bindControlledReferenceSelection(descriptor, selected.references);
        if (JSON.stringify(referenceSelection) !== JSON.stringify(selected))
          throw new Error("CONTROLLED_RENDER_REFERENCE_SELECTION_BINDING_INVALID");
      }
      await candidate.assertUnchanged();
      if (!artifacts || !["SINGLE_CONTRACT", "EVENT_BATCH_SET"].includes(artifacts.kind) || !artifacts.input)
        throw new Error("CONTROLLED_RENDER_MEASUREMENT_INVALID");
      if (candidate.originalNative) {
        const {bindOriginalExecutionObservation} = require("./dist/composition-worker/domains/production/composition-editor/qa/composition-original-execution-binding.js");
        const observation = bindOriginalExecutionObservation({expected: descriptor.contract.renderExecution,
          documentHash: descriptor.contract.documentHash, videoSha256: candidate.videoPin.sha256,
          observation: candidate.originalNative.renderExecutionObservation, supplied: artifacts.input.observation});
        artifacts = {...artifacts, input: {...artifacts.input, observation}};
      }
      if (candidate.originalNative && artifacts.kind === "SINGLE_CONTRACT") {
        if (candidate.originalNative.eventNativeEvidence) throw new Error("CONTROLLED_RENDER_EVENT_NATIVE_COVERAGE_REQUIRED");
        const {attachOriginalNativeSingleComparison} = require("./dist/composition-worker/domains/production/composition-editor/qa/composition-controlled-native-binding.js");
        artifacts = attachOriginalNativeSingleComparison({expectedContract: descriptor.contract, artifacts,
          originalNative: candidate.originalNative});
      }
      if (candidate.originalNative && artifacts.kind === "EVENT_BATCH_SET") {
        const {attachOriginalNativeEventComparison} = require("./dist/composition-worker/domains/production/composition-editor/qa/composition-controlled-event-native-binding.js");
        artifacts = attachOriginalNativeEventComparison({expectedDocument: workspace.measurementPlan?.document,
          expectedContract: descriptor.contract, artifacts, originalNative: candidate.originalNative});
      }
      // Supervisor admission still derives/validates the complete comparison binding independently.
      return {videoPath: candidate.videoPath, artifacts, ...(referenceSelection ? {referenceSelection} : {})};
    }};
}
