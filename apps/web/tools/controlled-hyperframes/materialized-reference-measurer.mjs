import {createRequire} from "node:module";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {createMaterializedProducerBridgeConfiguration} from "./materialized-producer-bridge-configuration.mjs";

const require = createRequire(new URL("../../package.json", import.meta.url));
const compiledRoot = "./dist/composition-worker/domains/production/composition-editor";
const reportLimitBytes = 20 * 1024 * 1024;

/** Explicit operator integration. No credentials, resolver, or callback enters the child request.
 * Requires original observed producer; local measurement diagnostics do not extend the signed receipt. */
export function createMaterializedProducerReferenceBridgeConfiguration(input) {
  if (!input.operatorConfiguration || !input.supabase
    || (typeof input.resolveReferences !== "function" && !Object.hasOwn(input, "referenceSelections"))
    || (Object.hasOwn(input, "referenceSelections") && Object.hasOwn(input, "resolveReferences"))
    || !input.measurementFence || Object.hasOwn(input, "measure"))
    throw new Error("CONTROLLED_RENDER_REFERENCE_MEASURER_CONFIGURATION_REQUIRED");
  const {manifest, roots} = input.dependencyInventory;
  const directory = dirname(fileURLToPath(import.meta.url));
  const declared = new Set(manifest.files.map(file => resolve(roots[file.rootId], file.path)));
  for (const path of [fileURLToPath(import.meta.url),
    resolve(directory, "../../dist/composition-worker/domains/production/composition-editor/qa/composition-controlled-reference-measurement.js"),
    resolve(directory, "../../dist/composition-worker/domains/production/composition-editor/qa/composition-controlled-reference-selection.js"),
    resolve(directory, "../../dist/composition-worker/domains/production/composition-editor/qa/composition-windows-comparison-process-ports.js")]) {
    if (!declared.has(path)) throw new Error("CONTROLLED_RENDER_REFERENCE_MEASURER_INVENTORY_REQUIRED");
  }
  const {measureControlledConformanceReferences} = require(`${compiledRoot}/qa/composition-controlled-reference-measurement.js`);
  const {createControlledReferenceSelectionResolver, bindControlledReferenceSelection} = require(`${compiledRoot}/qa/composition-controlled-reference-selection.js`);
  const resolveReferences = Object.hasOwn(input, "referenceSelections")
    ? createControlledReferenceSelectionResolver(input.referenceSelections) : input.resolveReferences;
  const {createWindowsComparisonProcessPorts} = require(`${compiledRoot}/qa/composition-windows-comparison-process-ports.js`);
  const {attachOriginalNativeSingleComparison} = require(`${compiledRoot}/qa/composition-controlled-native-binding.js`);
  const {attachOriginalNativeEventComparison} = require(`${compiledRoot}/qa/composition-controlled-event-native-binding.js`);
  const {prepareCompositionEventBatchContracts} = require(`${compiledRoot}/composition-conformance-event-batch-contract.js`);
  const {pinConformanceFile, assertConformanceFileUnchanged} = require(`${compiledRoot}/qa/composition-conformance-file-integrity.js`);
  const bridge = createMaterializedProducerBridgeConfiguration({...input, measure: async candidate => {
    const {descriptor, workspace, originalNative, signal} = candidate;
    signal.throwIfAborted();
    if (!originalNative) throw new Error("CONTROLLED_RENDER_ORIGINAL_NATIVE_REQUIRED");
    const observation = originalNative.renderExecutionObservation;
    let artifacts;
    if (descriptor.contract.checkpointBatch) {
      const document = workspace.measurementPlan?.document;
      const prepared = prepareCompositionEventBatchContracts({document, parentContract: descriptor.contract});
      artifacts = attachOriginalNativeEventComparison({expectedDocument: document, expectedContract: descriptor.contract,
        originalNative, artifacts: {kind: "EVENT_BATCH_SET", input: {document, parentContract: descriptor.contract,
          observation, videoSha256: candidate.videoPin.sha256,
          batches: Array.from({length: prepared.batchCount}, (_, index) => ({contract: prepared.select(index).contract}))}}});
    } else {
      artifacts = attachOriginalNativeSingleComparison({expectedContract: descriptor.contract, originalNative,
        artifacts: {kind: "SINGLE_CONTRACT", input: {contract: descriptor.contract, observation,
          documentHash: descriptor.documentHash, videoSha256: candidate.videoPin.sha256}}});
    }
    const referenceSelection = bindControlledReferenceSelection(descriptor, await resolveReferences(structuredClone(descriptor)));
    const references = referenceSelection.references;
    signal.throwIfAborted();
    const processPorts = createWindowsComparisonProcessPorts({descriptor,
      dependencyInventory: input.dependencyInventory, measurementFence: input.measurementFence,
      outputParentDirectory: input.outputParentDirectory, powerShellPath: input.powerShellPath,
      bridgeScriptPath: input.bridgeScriptPath, resourceLimits: bridge.resourceLimits, reducedToken: bridge.reducedToken});
    const measured = await measureControlledConformanceReferences({descriptor, artifacts, references,
      supabase: input.supabase, videoPath: candidate.videoPath, videoPin: candidate.videoPin,
      outputParentDirectory: input.outputParentDirectory, processPorts, signal});
    signal.throwIfAborted();
    // Preserve actual metrics, including FAIL/INCOMPLETE, instead of returning identity-only artifacts.
    const encoded = JSON.stringify(measured);
    if (Buffer.byteLength(encoded) > reportLimitBytes) throw new Error("CONTROLLED_RENDER_MEASUREMENT_REPORT_LIMIT");
    const reportPath = join(dirname(candidate.videoPath), "controlled-measurements.json");
    await writeFile(reportPath, encoded, {flag: "wx", mode: 0o600});
    const pin = await pinConformanceFile(reportPath, reportLimitBytes, false, signal);
    await assertConformanceFileUnchanged(reportPath, pin, reportLimitBytes, false, signal);
    if (measured.status === "FAIL") throw new Error("CONTROLLED_RENDER_MEASUREMENT_FAILED");
    if (measured.referenceSelectionSha256 !== createHash("sha256").update(JSON.stringify(referenceSelection)).digest("hex"))
      throw new Error("CONTROLLED_RENDER_REFERENCE_SELECTION_MEASUREMENT_MISMATCH");
    return {kind: "MEASURED_REFERENCE_ARTIFACTS", artifacts, referenceSelection};
  }});
  return {...bridge, prepareLaunch: (descriptor, workspace) => {
    const plan = workspace.measurementPlan;
    if (!workspace.measurementPlanReference || !plan || descriptor.contract.schemaVersion !== 4
      || !descriptor.contract.renderExecution || !plan.document
      || ["organizationId", "revisionId", "documentHash", "projectHash"].some(key => plan[key] !== descriptor[key])
      || plan.contractSha256 !== createHash("sha256").update(JSON.stringify(descriptor.contract)).digest("hex"))
      throw new Error("CONTROLLED_RENDER_REFERENCE_MEASUREMENT_PLAN_REQUIRED");
    return bridge.prepareLaunch(descriptor, workspace);
  }};
}
