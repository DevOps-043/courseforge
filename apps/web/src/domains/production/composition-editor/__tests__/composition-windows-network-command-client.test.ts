import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp, readdir, rm, rmdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {createWindowsNetworkCommandClient} from "../qa/composition-windows-network-command-client";
import {createWindowsNetworkCommandDispatcher} from "../qa/composition-windows-network-command-dispatcher";
import {createWindowsNetworkController} from "../qa/composition-windows-network-controller";
import {createJournaledWindowsNetworkPorts, type WindowsNetworkNativePorts} from "../qa/composition-windows-network-journaled-ports";
import {CompositionWindowsNetworkJournal, WINDOWS_NETWORK_JOURNAL_POLICY, type WindowsNetworkIntent} from "../qa/composition-windows-network-journal";
import {buildWindowsNetworkPlan} from "../qa/composition-windows-network-policy";

const binding = {channelId: randomUUID(), operationNonce: randomUUID(), scope: {hostId: "host",
  organizationId: randomUUID(), executionId: randomUUID(), appContainerSid: "S-1-15-2-1-2-3-4-5-6-7"}};
const endpoint = {address: "127.0.0.1" as const, port: 49152, protocol: "TCP" as const};
const signal = () => new AbortController().signal;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const reply = (payload: Buffer) => ({...JSON.parse(payload.toString()), receipt: {leaseId: "00000000-0000-4000-8000-000000000001",
  generation: 1, planSha256: buildWindowsNetworkPlan(binding.scope).sha256, persistent: true}});

test("full client/dispatcher/controller/journal path binds exact plans and durable commands with simulated native ports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "network-client-chain-")), journal = new CompositionWindowsNetworkJournal(directory);
  let installed: WindowsNetworkIntent | undefined; const modes: string[] = [];
  const install = async (intent: WindowsNetworkIntent) => {
    assert.deepEqual(await journal.readIntent(intent.scope, intent.leaseId, intent.generation, signal()), intent);
    installed = structuredClone(intent); modes.push(intent.plan.mode);
  };
  const native: WindowsNetworkNativePorts = {
    installInitialDenyAll: install,
    replaceOwnedPolicy: async (previous, next) => {assert.deepEqual(previous, installed); await install(next);},
    readEffectivePolicy: async intent => {
      assert.deepEqual(intent, installed);
      return {policy: WINDOWS_NETWORK_JOURNAL_POLICY.id, leaseId: intent.leaseId, generation: intent.generation,
        intentSha256: intent.sha256, planSha256: intent.plan.sha256, filterKeys: intent.filterKeys, persistent: true};
    },
    resolveOriginalServer: async () => endpoint,
    confirmOwnedJobStopped: async (scope, leaseId) => ({executionId: scope.executionId, leaseId, activeProcesses: 0, jobClosed: true}),
  };
  try {
    const controller = createWindowsNetworkController(binding.scope, createJournaledWindowsNetworkPorts(journal, native));
    const dispatcher = createWindowsNetworkCommandDispatcher(binding, journal, controller);
    // Direct invocation bypasses physical pipe authentication ONLY for this controlled test.
    const client = createWindowsNetworkCommandClient(binding, dispatcher);
    const first = await client.denyBeforeStart(signal());
    const second = await client.allowOriginalServer(endpoint, signal());
    const third = await client.sealAfterStop(signal());
    assert.equal(second.leaseId, first.leaseId); assert.equal(third.leaseId, first.leaseId);
    assert.equal(client.status(), "SEALED"); assert.equal(controller.status(), "SEALED");
    assert.deepEqual(modes, ["DENY_ALL", "EXACT_LOOPBACK", "DENY_ALL"]);
    assert.equal((await readdir(directory)).length, 10);
  } finally {for (const file of await readdir(directory)) await rm(join(directory, file)); await rmdir(directory);}
});

test("foreign echoes, plan hashes, generations and nonpersistent receipts latch the client without resending", async () => {
  for (const alteration of ["request", "nonce", "scope", "channel", "sequence", "hash", "generation", "persistent", "extra"]) {
    let calls = 0;
    const client = createWindowsNetworkCommandClient(binding, async payload => {
      calls++; const response = reply(payload);
      if (alteration === "request") response.requestId = randomUUID();
      if (alteration === "nonce") response.operationNonce = randomUUID();
      if (alteration === "scope") response.scope.organizationId = randomUUID();
      if (alteration === "channel") response.channelId = randomUUID();
      if (alteration === "sequence") response.sequence = 2;
      if (alteration === "hash") response.receipt.planSha256 = "f".repeat(64);
      if (alteration === "generation") response.receipt.generation = 2;
      if (alteration === "persistent") response.receipt.persistent = false;
      if (alteration === "extra") response.endpoint = "https://external.invalid";
      return encode(response);
    });
    await assert.rejects(client.denyBeforeStart(signal()), /RECOVERY_REQUIRED/);
    assert.equal(client.status(), "RECOVERY_REQUIRED");
    await assert.rejects(client.denyBeforeStart(signal()), /RECOVERY_REQUIRED/); assert.equal(calls, 1);
  }
});

test("invalid response framing/UTF8 and lost transport ACK cannot advance phase", async () => {
  for (const response of [Buffer.alloc(0), Buffer.alloc(32769), Buffer.from([255])]) {
    const client = createWindowsNetworkCommandClient(binding, async () => response);
    await assert.rejects(client.denyBeforeStart(signal()), /RECOVERY_REQUIRED/);
    assert.equal(client.status(), "RECOVERY_REQUIRED");
  }
  let calls = 0;
  const client = createWindowsNetworkCommandClient(binding, async () => {calls++; throw new Error("private transport details");});
  await assert.rejects(client.denyBeforeStart(signal()), {message: "CONTROLLED_RENDER_NETWORK_CHANNEL_RECOVERY_REQUIRED"});
  await assert.rejects(client.allowOriginalServer(endpoint, signal()), /RECOVERY_REQUIRED/); assert.equal(calls, 1);
});

test("client compares original-server expectation independently instead of learning its plan from the reply", async () => {
  const client = createWindowsNetworkCommandClient(binding, async payload => {
    const response = reply(payload);
    if (response.sequence === 2) {response.receipt.generation = 2; response.receipt.planSha256 = buildWindowsNetworkPlan(binding.scope, {...endpoint, port: 49153}).sha256;}
    return encode(response);
  });
  await client.denyBeforeStart(signal());
  await assert.rejects(client.allowOriginalServer(endpoint, signal()), /RECOVERY_REQUIRED/);
});

test("abort suppresses a late transport reply and prevents concurrent or reordered commands", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;}), abort = new AbortController();
  let calls = 0;
  const client = createWindowsNetworkCommandClient(binding, async payload => {calls++; await gate; return encode(reply(payload));});
  await assert.rejects(client.allowOriginalServer(endpoint, signal()), /RECOVERY_REQUIRED/); assert.equal(calls, 0);
  const running = client.denyBeforeStart(abort.signal), rejected = assert.rejects(running, /RECOVERY_REQUIRED/);
  await assert.rejects(client.denyBeforeStart(signal()), /RECOVERY_REQUIRED/);
  abort.abort(); await rejected; release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.status(), "RECOVERY_REQUIRED"); assert.equal(calls, 1);
});
