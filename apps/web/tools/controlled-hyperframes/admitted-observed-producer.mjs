import {createRequire} from "node:module";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {verifyProducerExtensionPackage} from "./build-producer-extension-v1.mjs";

const appRequire = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"));
const fail = code => {throw new Error(`CONTROLLED_RENDER_OBSERVED_INSTALLATION_${code}`);};

/** Host-only installation loader. Must run inside the admitted, owned worker process.
 * This gate checks declared bytes, not dynamic loading closure or OS immutability. */
export async function loadAdmittedObservedProducer(input, ports = {}) {
  if (!input || !(input.signal instanceof AbortSignal) || !input.observer
    || !["onSession", "onBeforeFrame", "onAfterFrame"].every(key => typeof input.observer[key] === "function")
    || !input.nativePaths || !["browser", "encoder", "decoder"].every(key => typeof input.nativePaths[key] === "string")) fail("INPUT_INVALID");
  if ((input.observer.onEncode !== undefined || input.observer.onAfterAssemble !== undefined)
    && (typeof input.observer.onEncode !== "function" || typeof input.observer.onAfterAssemble !== "function")) fail("INPUT_INVALID");
  const signal = input.signal;
  signal.throwIfAborted();
  const observer = Object.freeze({onSession: input.observer.onSession,
    onBeforeFrame: input.observer.onBeforeFrame, onAfterFrame: input.observer.onAfterFrame,
    ...(input.observer.onEncode ? {onEncode: input.observer.onEncode, onAfterAssemble: input.observer.onAfterAssemble} : {})});
  const inventory = structuredClone(input.dependencyInventory);
  const execution = structuredClone(input.execution);
  const nativePaths = {...input.nativePaths};
  const packageRequest = {directory: input.packageDirectory,
    expectedManifestSha256: input.expectedPackageManifestSha256, signal};
  try {
    // Use the operational build; no test-build or SDK fallback.
    const {admitControlledDependencyInventory} = appRequire(
      "./dist/composition-worker/domains/production/composition-editor/qa/composition-controlled-dependency-inventory.js");
    const admission = await admitControlledDependencyInventory(inventory, execution, signal);
    const artifact = await verifyProducerExtensionPackage(packageRequest);
    const role = inventory.manifest.roles.producer;
    const root = inventory.roots[role.rootId];
    if (typeof root !== "string" || resolve(root, role.path) !== artifact.entryPath) fail("PRODUCER_ROLE_MISMATCH");
    for (const name of ["browser", "encoder", "decoder"]) {
      const binding = inventory.manifest.roles[name];
      if (resolve(inventory.roots[binding.rootId], binding.path) !== nativePaths[name]) fail("NATIVE_ROLE_MISMATCH");
    }
    const declared = new Map(inventory.manifest.files.map(file => [resolve(inventory.roots[file.rootId], file.path), file]));
    for (const file of artifact.files) {
      const expected = declared.get(join(packageRequest.directory, file.path));
      if (!expected || expected.sha256 !== file.sha256 || expected.sizeBytes !== file.sizeBytes) fail("PACKAGE_INVENTORY_MISMATCH");
    }
    const assertUnchanged = async () => {
      signal.throwIfAborted();
      await admission.assertUnchanged();
      await verifyProducerExtensionPackage(packageRequest);
      signal.throwIfAborted();
    };
    await assertUnchanged();
    // Import port is exclusively for host tests; never populate it from job metadata.
    const producerModule = await (ports.importModule ?? (url => import(url)))(pathToFileURL(artifact.entryPath).href);
    await assertUnchanged();
    if (!producerModule?.DEFAULT_CONFIG || typeof producerModule.DEFAULT_CONFIG !== "object"
      || typeof producerModule.createRenderJob !== "function" || typeof producerModule.executeObservedRenderJob !== "function") fail("MODULE_INVALID");
    const producer = Object.freeze({DEFAULT_CONFIG: structuredClone(producerModule.DEFAULT_CONFIG),
      createRenderJob: config => producerModule.createRenderJob(config),
      async executeObservedRenderJob(job, directory, outputPath, progress, jobSignal, hooks) {
        if (jobSignal !== signal || hooks !== observer) fail("EXECUTION_BINDING_INVALID");
        await assertUnchanged();
        try {return await producerModule.executeObservedRenderJob(job, directory, outputPath, progress, signal, observer);}
        finally {await assertUnchanged();}
      }});
    return {producer, observer, assertUnchanged, readFileObservations: async () => {
      await assertUnchanged();
      return admission.readFileObservations();
    }};
  } catch (error) {
    if (signal.aborted) fail("ABORTED");
    if (error instanceof Error && /^CONTROLLED_RENDER_OBSERVED_INSTALLATION_[A-Z_]+$/.test(error.message)) throw error;
    fail("ADMISSION_FAILED");
  }
}
