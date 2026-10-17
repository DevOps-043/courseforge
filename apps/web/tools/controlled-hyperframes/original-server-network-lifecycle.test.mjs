import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync, randomUUID} from "node:crypto";
import {mkdtemp, rm, readFile, writeFile, mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {createOriginalServerNetworkLifecycle, createMaterializedOriginalServerNetworkLifecycle} from "./original-server-network-lifecycle.mjs";
import {OBSERVED_NETWORK_OPERATOR_CONFIGURATION_POLICY} from "./observed-producer-operator-configuration.mjs";
import {ORIGINAL_SESSION_OBSERVER_POLICY} from "./original-session-observer.mjs";
import {createOriginalServerFileClient, ORIGINAL_SERVER_FILE_CHANNEL_POLICY} from "./original-server-file-channel.mjs";
import {hashBytes} from "./producer-extension-files.mjs";
const require = createRequire(new URL("../../package.json", import.meta.url));
const {buildWindowsNetworkPlan} = require("./dist/composition-worker/domains/production/composition-editor/qa/composition-windows-network-policy.js");
const endpoint = {address: "127.0.0.1", port: 43210, protocol: "TCP"};
async function fixture(context) {
  const directory = await mkdtemp(join(tmpdir(), "supervisor-network-lifecycle-"));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const keys = generateKeyPairSync("ed25519"), der = keys.publicKey.export({type: "spki", format: "der"});
  const executionId = randomUUID(), operationNonce = randomUUID();
  const binding = {channelId: randomUUID(), operationNonce, scope: {executionId, organizationId: randomUUID(), hostId: "host",
    appContainerSid: "S-1-15-2-1-2-3-4-5-6-7"}};
  const networkChannel = {policy: ORIGINAL_SERVER_FILE_CHANNEL_POLICY.id, directory, executionId, operationNonce,
    publicKeySpki: der.toString("base64"), publicKeySha256: hashBytes(der), transportSha256: "a".repeat(64), transportSizeBytes: 1};
  let observations = 0; const commands = [];
  const input = {binding, networkChannel, privateKey: keys.privateKey, assertUnchanged: async () => {}, exchange: async bytes => {
    const request = JSON.parse(bytes); commands.push(request.command);
    return Buffer.from(JSON.stringify({...request, receipt: {leaseId: "00000000-0000-4000-8000-000000000001",
      generation: request.sequence, persistent: true, planSha256: buildWindowsNetworkPlan(binding.scope, request.sequence === 2 ? endpoint : undefined).sha256}}));
  }};
  return {input, commands, keys, control: {observeOriginalListener: async port => {
    observations++; return {port, address: endpoint.address, rootIdentity: {pid: process.pid, creationFileTime: "133000000000000001"}};
  }}, observations: () => observations};
}

test("supervisor composition signs ACK only after two owned observations and validated broker allow", async context => {
  const f = await fixture(context), lifecycle = createOriginalServerNetworkLifecycle(f.input), signal = new AbortController().signal;
  const producer = await createOriginalServerFileClient({directory: f.input.networkChannel.directory,
    binding: {executionId: f.input.binding.scope.executionId, operationNonce: f.input.binding.operationNonce}, publicKey: f.keys.publicKey});
  await lifecycle.client.denyBeforeStart(signal);
  const serving = lifecycle.serveOriginalServer({pid: process.pid, creationFileTime: "133000000000000001"}, f.control, signal);
  const ack = await producer({serverUrl: "http://localhost:43210", address: endpoint.address, port: endpoint.port, signal});
  await serving;
  assert.deepEqual(ack, {status: "AUTHORIZED", address: endpoint.address, port: endpoint.port});
  assert.equal(f.observations(), 2); assert.deepEqual(f.commands, ["DENY_BEFORE_START", "ALLOW_ORIGINAL_SERVER"]);
  assert.equal(lifecycle.appContainerSid, f.input.binding.scope.appContainerSid);
  assert.equal(JSON.stringify(lifecycle).includes("PRIVATE KEY"), false);
  await assert.rejects(lifecycle.serveOriginalServer({pid: process.pid, creationFileTime: "133000000000000001"}, f.control, signal), /RECOVERY_REQUIRED/);
});

test("key mismatch, foreign execution and nonce fail without broker calls", async context => {
  const f = await fixture(context);
  for (const change of [{privateKey: generateKeyPairSync("ed25519").privateKey},
    {networkChannel: {...f.input.networkChannel, executionId: randomUUID()}},
    {networkChannel: {...f.input.networkChannel, operationNonce: randomUUID()}}])
    assert.throws(() => createOriginalServerNetworkLifecycle({...f.input, ...change}), /RECOVERY_REQUIRED/);
  assert.deepEqual(f.commands, []);
});

test("supervisor refuses to serve before deny confirmation", async context => {
  const f = await fixture(context), lifecycle = createOriginalServerNetworkLifecycle(f.input);
  await assert.rejects(lifecycle.serveOriginalServer({pid: process.pid, creationFileTime: "133000000000000001"}, f.control,
    new AbortController().signal), /RECOVERY_REQUIRED/);
  assert.equal(f.observations(), 0); assert.deepEqual(f.commands, []);
});

test("materialized operator composition checks real config and fixed runtime pins before any broker command", async context => {
  const f = await fixture(context), tools = dirname(fileURLToPath(import.meta.url));
  const parent = f.input.networkChannel.directory;
  const directory = join(parent, `${f.input.binding.scope.executionId}.original-server-channel`);
  await mkdir(directory);
  const transport = await readFile(join(tools, "original-server-file-channel.mjs"));
  const networkChannel = {...f.input.networkChannel, directory, transportSha256: hashBytes(transport), transportSizeBytes: transport.length};
  const compiled = join(tools, "../../dist/composition-worker/domains/production/composition-editor/qa");
  const paths = ["original-server-network-lifecycle.mjs", "observed-original-server-channel.mjs", "original-server-file-channel.mjs",
    "original-server-channel-policy.mjs", "producer-extension-files.mjs", "observed-producer-operator-configuration.mjs"];
  const compiledPaths = ["composition-windows-network-owned-start.js", "composition-windows-original-server-authorization.js",
    "composition-windows-network-command-client.js", "composition-windows-network-channel-contract.js"];
  const files = await Promise.all([...paths.map(path => ({rootId: "tools", path, absolute: join(tools, path)})),
    ...compiledPaths.map(path => ({rootId: "compiled", path, absolute: join(compiled, path)}))].map(async ({absolute, ...record}) => {
      const bytes = await readFile(absolute); return {...record, sha256: hashBytes(bytes), sizeBytes: bytes.length};
    }));
  const configPath = join(parent, "operator.json");
  const configuration = {policy: OBSERVED_NETWORK_OPERATOR_CONFIGURATION_POLICY, observerPolicy: ORIGINAL_SESSION_OBSERVER_POLICY,
    packageDirectory: tools, expectedPackageManifestSha256: "a".repeat(64), execution: {},
    dependencyInventory: {roots: {tools}}, networkChannel};
  const bytes = Buffer.from(JSON.stringify(configuration)); await writeFile(configPath, bytes);
  const input = {...f.input, outputParentDirectory: parent, operatorConfiguration: {path: configPath, sha256: hashBytes(bytes)},
    dependencyInventory: {roots: {tools, compiled, configuration: parent}, manifest: {files: [
      ...files, {rootId: "configuration", path: "operator.json", sha256: hashBytes(bytes), sizeBytes: bytes.length}]}}};
  const lifecycle = await createMaterializedOriginalServerNetworkLifecycle(input, new AbortController().signal);
  assert.equal(lifecycle.executionId, f.input.binding.scope.executionId); assert.deepEqual(f.commands, []);
  const corrupt = structuredClone(input.dependencyInventory);
  corrupt.manifest.files.find(file => file.path === "original-server-file-channel.mjs").sha256 = "0".repeat(64);
  await assert.rejects(createMaterializedOriginalServerNetworkLifecycle({...input, dependencyInventory: corrupt}, new AbortController().signal), /RECOVERY_REQUIRED/);
  assert.deepEqual(f.commands, []);
});
