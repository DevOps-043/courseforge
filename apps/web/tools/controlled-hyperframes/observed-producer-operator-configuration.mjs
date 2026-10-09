import {dirname, isAbsolute, relative, sep} from "node:path";
import {assertPlainDirectory, hashBytes, readPinnedPackageFile} from "./producer-extension-files.mjs";
import {ORIGINAL_SESSION_OBSERVER_POLICY} from "./original-session-observer.mjs";
import {parseObservedOperatorReference} from "./observed-producer-operator-reference.mjs";

export const OBSERVED_OPERATOR_CONFIGURATION_POLICY = "OBSERVED_PRODUCER_OPERATOR_CONFIGURATION_V1";
const MAXIMUM_CONFIGURATION_BYTES = 4 * 1024 * 1024;
const fail = () => {throw new Error("CONTROLLED_RENDER_OBSERVED_OPERATOR_CONFIGURATION_INVALID");};
const exact = (value, fields) => value && typeof value === "object" && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(fields.sort());

export async function readObservedOperatorConfiguration(reference, signal) {
  try {
    reference = parseObservedOperatorReference(reference);
    if (!(signal instanceof AbortSignal)) fail();
    signal.throwIfAborted();
    await assertPlainDirectory(dirname(reference.path));
    const bytes = await readPinnedPackageFile(reference.path, MAXIMUM_CONFIGURATION_BYTES);
    if (hashBytes(bytes) !== reference.sha256) fail();
    const configuration = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
    if (!exact(configuration, ["policy", "observerPolicy", "packageDirectory", "expectedPackageManifestSha256", "dependencyInventory", "execution"])
      || configuration.policy !== OBSERVED_OPERATOR_CONFIGURATION_POLICY
      || configuration.observerPolicy !== ORIGINAL_SESSION_OBSERVER_POLICY) fail();
    // Bootstrap metadata cannot be a self-hashed file in its own runtime inventory.
    const roots = configuration.dependencyInventory?.roots;
    if (!roots || typeof roots !== "object" || Array.isArray(roots)) fail();
    for (const root of Object.values(roots)) {
      if (typeof root !== "string" || !isAbsolute(root)) fail();
      const suffix = relative(root, reference.path);
      if (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`)) fail();
    }
    signal.throwIfAborted();
    return {configuration, assertUnchanged: async () => {
      signal.throwIfAborted();
      if (hashBytes(await readPinnedPackageFile(reference.path, MAXIMUM_CONFIGURATION_BYTES)) !== reference.sha256) fail();
      signal.throwIfAborted();
    }};
  } catch {fail();}
}
