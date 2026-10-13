import {createPublicKey, KeyObject} from "node:crypto";
import {createRequire} from "node:module";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createOriginalServerFileSupervisor} from "./original-server-file-channel.mjs";
import {parseObservedOriginalServerChannel} from "./observed-original-server-channel.mjs";
import {readObservedOperatorConfiguration, OBSERVED_NETWORK_OPERATOR_CONFIGURATION_POLICY} from "./observed-producer-operator-configuration.mjs";
import {parseObservedOperatorReference} from "./observed-producer-operator-reference.mjs";
import {readPinnedPackageFile, hashBytes} from "./producer-extension-files.mjs";

const require = createRequire(new URL("../../package.json", import.meta.url));
const compiled = "./dist/composition-worker/domains/production/composition-editor/qa/";
const {createWindowsNetworkCommandClient} = require(`${compiled}composition-windows-network-command-client.js`);
const {createWindowsOriginalServerAuthorization} = require(`${compiled}composition-windows-original-server-authorization.js`);
const {windowsNetworkChannelBindingSchema} = require(`${compiled}composition-windows-network-channel-contract.js`);
const fail = () => {throw new Error("CONTROLLED_RENDER_NETWORK_CHANNEL_RECOVERY_REQUIRED");};

/** Supervisor ONLY. Private KeyObject is captured by operator closure, never copied to JSON/worker.
 * Exchange must authenticate the native broker; no default, spawn or policy mutation at construction. */
export function createOriginalServerNetworkLifecycle(input) {
  const configuration = parseObservedOriginalServerChannel(input.networkChannel);
  const binding = windowsNetworkChannelBindingSchema.parse(input.binding);
  const key = input.privateKey, assertUnchanged = input.assertUnchanged;
  if (!(key instanceof KeyObject) || key.type !== "private" || key.asymmetricKeyType !== "ed25519"
    || typeof assertUnchanged !== "function" || typeof input.exchange !== "function"
    || binding.scope.executionId !== configuration.executionId || binding.operationNonce !== configuration.operationNonce) fail();
  if (createPublicKey(key).export({type: "spki", format: "der"}).toString("base64") !== configuration.publicKeySpki) fail();
  const client = createWindowsNetworkCommandClient(binding, input.exchange);
  let served = false;
  return Object.freeze({executionId: binding.scope.executionId, organizationId: binding.scope.organizationId,
    appContainerSid: binding.scope.appContainerSid, client,
    async serveOriginalServer(root, control, signal) {
      if (served || signal.aborted || client.status() !== "DENIED") fail();
      served = true;
      await assertUnchanged(); signal.throwIfAborted();
      const authorize = createWindowsOriginalServerAuthorization(root, control, client);
      const serve = await createOriginalServerFileSupervisor({directory: configuration.directory,
        binding: {executionId: configuration.executionId, operationNonce: configuration.operationNonce}, privateKey: key, rootIdentity: root,
        authorize: async (candidate, ownedSignal) => {
          await assertUnchanged(); ownedSignal.throwIfAborted();
          const ack = await authorize(candidate, ownedSignal);
          await assertUnchanged(); ownedSignal.throwIfAborted(); return ack;
        }});
      await serve(signal); await assertUnchanged(); signal.throwIfAborted();
      if (client.status() !== "LOCAL_ONLY") fail();
    }});
}

/** Read-only operator composition to supply as networkLifecycle to the Windows host factory.
 * Caller provisions mailbox/ACL/key custody separately; this never installs/activates the broker. */
export async function createMaterializedOriginalServerNetworkLifecycle(input, signal) {
  const reference = parseObservedOperatorReference(input.operatorConfiguration);
  const {manifest, roots} = input.dependencyInventory;
  const declared = new Map(manifest.files.map(file => [resolve(roots[file.rootId], file.path), {...file}]));
  const configPin = declared.get(reference.path);
  if (!configPin || configPin.sha256 !== reference.sha256) fail();
  const tools = dirname(fileURLToPath(import.meta.url));
  const required = ["original-server-network-lifecycle.mjs", "observed-original-server-channel.mjs",
    "original-server-file-channel.mjs", "original-server-channel-policy.mjs", "producer-extension-files.mjs",
    "observed-producer-operator-configuration.mjs"].map(name => join(tools, name));
  required.push(...["composition-windows-network-owned-start.js", "composition-windows-original-server-authorization.js",
    "composition-windows-network-command-client.js", "composition-windows-network-channel-contract.js"]
    .map(name => resolve(tools, "../../dist/composition-worker/domains/production/composition-editor/qa", name)));
  const operator = await readObservedOperatorConfiguration(reference, signal);
  if (operator.configuration.policy !== OBSERVED_NETWORK_OPERATOR_CONFIGURATION_POLICY) fail();
  const channel = operator.configuration.networkChannel;
  if (channel.directory !== join(input.outputParentDirectory, `${channel.executionId}.original-server-channel`)) fail();
  const assertUnchanged = async () => {
    signal.throwIfAborted(); await operator.assertUnchanged();
    for (const path of required) {
      const pin = declared.get(path);
      if (!pin || !Number.isSafeInteger(pin.sizeBytes) || pin.sizeBytes < 1) fail();
      const bytes = await readPinnedPackageFile(path);
      if (bytes.length !== pin.sizeBytes || hashBytes(bytes) !== pin.sha256) fail();
    }
    signal.throwIfAborted();
  };
  await assertUnchanged();
  return createOriginalServerNetworkLifecycle({networkChannel: channel, privateKey: input.privateKey,
    binding: input.binding, exchange: input.exchange, assertUnchanged});
}
