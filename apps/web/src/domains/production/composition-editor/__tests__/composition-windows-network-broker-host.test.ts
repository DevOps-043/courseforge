import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {mkdtemp, readdir, writeFile, mkdir, rm, rmdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {prepareWindowsNetworkBrokerHost, type WindowsNetworkBrokerHostPorts} from "../qa/composition-windows-network-broker-host";
import {loadWindowsNetworkBrokerConfiguration, WINDOWS_NETWORK_BROKER_CONFIGURATION_POLICY} from "../qa/composition-windows-network-broker-configuration";
import {WINDOWS_NETWORK_CHANNEL_POLICY, WINDOWS_NETWORK_COMMAND_ORDER} from "../qa/composition-windows-network-channel-contract";
import type {WindowsNetworkIntent} from "../qa/composition-windows-network-journal";
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const signal = () => new AbortController().signal;

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "broker-host-test-")), journal = join(directory, "journal"); await mkdir(journal);
  const files: Record<string, {path: string; sha256: string; sizeBytes: number}> = {};
  for (const role of ["server", "client", "loader", "invocation", "nativeLibrary"]) {
    const bytes = Buffer.from(`fixture ${role}; not executable native code`), path = join(directory, `${role}.fixture`);
    await writeFile(path, bytes); files[role] = {path, sha256: digest(bytes), sizeBytes: bytes.length};
  }
  const binding = {channelId: randomUUID(), operationNonce: randomUUID(), scope: {hostId: "host", organizationId: randomUUID(),
    executionId: randomUUID(), appContainerSid: "S-1-15-2-1-2-3-4-5-6-7"}};
  const configuration = {policy: WINDOWS_NETWORK_BROKER_CONFIGURATION_POLICY.id, binding,
    authority: {providerId: randomUUID(), sublayerId: randomUUID()}, journalDirectory: journal,
    clientPeer: {pid: 100, creationFileTime: "133000000000000001", accountSid: "S-1-5-21-1-2-3-1001", logonSid: "S-1-5-5-1-2"},
    brokerPeer: {pid: 101, creationFileTime: "133000000000000002", accountSid: "S-1-5-21-1-2-3-1002", logonSid: "S-1-5-5-1-3"}, files};
  const path = join(directory, "operator.json"), bytes = Buffer.from(JSON.stringify(configuration)); await writeFile(path, bytes);
  return {directory, journal, configuration, reference: {path, sha256: digest(bytes)},
    cleanup: async () => {for (const name of await readdir(journal)) await rm(join(journal, name)); await rmdir(journal);
      for (const name of await readdir(directory)) await rm(join(directory, name)); await rmdir(directory);}};
}
const idlePorts = (counts: {factory: number; serve: number}): WindowsNetworkBrokerHostPorts => ({
  createNativePorts: async () => {counts.factory++; throw new Error("No native initialization expected");},
  serveAuthenticatedOnce: async () => {counts.serve++;},
});

test("read-only preparation pins operator bytes and files without invoking activation callbacks", async () => {
  const f = await fixture(), counts = {factory: 0, serve: 0};
  try {
    const host = await prepareWindowsNetworkBrokerHost(f.reference, idlePorts(counts), signal());
    assert.equal(host.isQuarantined(), false); assert.deepEqual(counts, {factory: 0, serve: 0});
    assert.deepEqual(await readdir(f.journal), []);
    const admitted = await loadWindowsNetworkBrokerConfiguration(f.reference, signal());
    admitted.configuration.clientPeer.pid = 999; await admitted.assertUnchanged(signal());
    assert.equal((await loadWindowsNetworkBrokerConfiguration(f.reference, signal())).configuration.clientPeer.pid, 100);
  } finally {await f.cleanup();}
});
test("pins and peer separation reject before native initialization", async () => {
  const f = await fixture(), counts = {factory: 0, serve: 0};
  try {
    await assert.rejects(prepareWindowsNetworkBrokerHost({...f.reference, sha256: "f".repeat(64)}, idlePorts(counts), signal()), /RECOVERY_REQUIRED/);
    const changed = structuredClone(f.configuration); changed.brokerPeer.accountSid = changed.clientPeer.accountSid;
    const bytes = Buffer.from(JSON.stringify(changed)); await writeFile(f.reference.path, bytes);
    await assert.rejects(prepareWindowsNetworkBrokerHost({...f.reference, sha256: digest(bytes)}, idlePorts(counts), signal()), /RECOVERY_REQUIRED/);
    assert.deepEqual(counts, {factory: 0, serve: 0});
  } finally {await f.cleanup();}
});
test("file mutation after preparation quarantines before invoking native factory", async () => {
  const f = await fixture(), counts = {factory: 0, serve: 0};
  try {
    const host = await prepareWindowsNetworkBrokerHost(f.reference, idlePorts(counts), signal());
    await writeFile(f.configuration.files.nativeLibrary.path, "changed");
    await assert.rejects(host.serveOnce(signal()), /RECOVERY_REQUIRED/);
    assert.equal(host.isQuarantined(), true); assert.deepEqual(counts, {factory: 0, serve: 0});
  } finally {await f.cleanup();}
});
test("explicit serving composes all three phases with simulated authenticated pipe and native calls", async () => {
  const f = await fixture(); let installed: WindowsNetworkIntent | undefined, phase = 0, factoryCalls = 0;
  try {
    const ports: WindowsNetworkBrokerHostPorts = {
      createNativePorts: async () => {factoryCalls++; return {
        installInitialDenyAll: async intent => {installed = intent;},
        replaceOwnedPolicy: async (previous, next) => {assert.deepEqual(previous, installed); installed = next;},
        readEffectivePolicy: async intent => ({policy: "LOCAL_WINDOWS_NETWORK_INTENT_JOURNAL_V1", leaseId: intent.leaseId,
          generation: intent.generation, intentSha256: intent.sha256, planSha256: intent.plan.sha256, filterKeys: intent.filterKeys, persistent: true}),
        resolveOriginalServer: async () => ({address: "127.0.0.1", port: 49152, protocol: "TCP"}),
        confirmOwnedJobStopped: async (scope, leaseId) => ({executionId: scope.executionId, leaseId, activeProcesses: 0, jobClosed: true}),
      };},
      serveAuthenticatedOnce: async (_configuration, dispatch, ownedSignal) => {
        const sequence = ++phase;
        const response = JSON.parse((await dispatch(Buffer.from(JSON.stringify({policy: WINDOWS_NETWORK_CHANNEL_POLICY.id,
          ...f.configuration.binding, requestId: randomUUID(), sequence, command: WINDOWS_NETWORK_COMMAND_ORDER[sequence - 1]})), ownedSignal)).toString());
        assert.equal(response.receipt.generation, sequence);
      },
    };
    const host = await prepareWindowsNetworkBrokerHost(f.reference, ports, signal());
    for (let index = 0; index < 3; index++) await host.serveOnce(signal());
    assert.equal(factoryCalls, 1); assert.equal(phase, 3); assert.equal((await readdir(f.journal)).length, 10);
    await assert.rejects(host.serveOnce(signal()), /RECOVERY_REQUIRED/);
  } finally {await f.cleanup();}
});
test("a server returning without authenticated dispatch cannot count as a successful session", async () => {
  const f = await fixture();
  try {
    const ports: WindowsNetworkBrokerHostPorts = {createNativePorts: async () => ({installInitialDenyAll: async () => {},
      replaceOwnedPolicy: async () => {}, readEffectivePolicy: async () => ({}), resolveOriginalServer: async () => ({}),
      confirmOwnedJobStopped: async () => ({})}), serveAuthenticatedOnce: async () => {}};
    const host = await prepareWindowsNetworkBrokerHost(f.reference, ports, signal());
    await assert.rejects(host.serveOnce(signal()), /RECOVERY_REQUIRED/); assert.equal(host.isQuarantined(), true);
    assert.deepEqual(await readdir(f.journal), []);
  } finally {await f.cleanup();}
});
