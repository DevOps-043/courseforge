import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp, readdir, readFile, rm, rmdir, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {buildWindowsNetworkPlan} from "../qa/composition-windows-network-policy";
import {CompositionWindowsNetworkJournal, WINDOWS_NETWORK_JOURNAL_POLICY, type WindowsNetworkIntent} from "../qa/composition-windows-network-journal";
import {createWindowsNetworkController} from "../qa/composition-windows-network-controller";
import {createJournaledWindowsNetworkPorts, type WindowsNetworkNativePorts} from "../qa/composition-windows-network-journaled-ports";

const scope = {hostId: "host", organizationId: "00000000-0000-4000-8000-000000000001",
  executionId: "00000000-0000-4000-8000-000000000002", appContainerSid: "S-1-15-2-1-2-3-4-5-6-7"};
const endpoint = {address: "127.0.0.1" as const, port: 49152, protocol: "TCP" as const};
const observation = (intent: WindowsNetworkIntent) => ({policy: WINDOWS_NETWORK_JOURNAL_POLICY.id, leaseId: intent.leaseId,
  generation: intent.generation, intentSha256: intent.sha256, planSha256: intent.plan.sha256,
  filterKeys: intent.filterKeys, persistent: true as const});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "network-journal-test-"));
  return {directory, journal: new CompositionWindowsNetworkJournal(directory),
    cleanup: async () => {for (const name of await readdir(directory)) await rm(join(directory, name)); await rmdir(directory);}};
}

test("package reservation survives recreation and rejects other lease, execution and organization", async () => {
  const f = await fixture(), lease = randomUUID(), signal = new AbortController().signal;
  try {
    const intent = await f.journal.acquire(scope, lease, buildWindowsNetworkPlan(scope), signal);
    assert.equal(intent.filterKeys.length, 4); assert.equal(new Set(intent.filterKeys).size, 4);
    const restarted = new CompositionWindowsNetworkJournal(f.directory);
    assert.deepEqual(await restarted.readIntent(scope, lease, 1, signal), intent);
    for (const foreign of [scope, {...scope, executionId: randomUUID()}, {...scope, organizationId: randomUUID()}])
      await assert.rejects(restarted.acquire(foreign, randomUUID(), buildWindowsNetworkPlan(foreign), signal), /RECOVERY_REQUIRED/);
    await assert.rejects(restarted.readIntent({...scope, organizationId: randomUUID()}, lease, 1, signal), /RECOVERY_REQUIRED/);
    assert.equal((await readdir(f.directory)).length, 2);
  } finally {await f.cleanup();}
});

test("unobserved native intent cannot progress; exact observations permit only three immutable generations", async () => {
  const f = await fixture(), signal = new AbortController().signal, lease = randomUUID();
  try {
    const first = await f.journal.acquire(scope, lease, buildWindowsNetworkPlan(scope), signal);
    await assert.rejects(f.journal.reserveNext(scope, lease, 1, buildWindowsNetworkPlan(scope, endpoint), signal), /RECOVERY_REQUIRED/);
    await f.journal.recordObservation(first, observation(first), signal);
    const second = await f.journal.reserveNext(scope, lease, 1, buildWindowsNetworkPlan(scope, endpoint), signal);
    assert.equal(second.filterKeys.length, 9);
    await assert.rejects(f.journal.reserveNext(scope, lease, 1, second.plan, signal), /RECOVERY_REQUIRED/);
    await f.journal.recordObservation(second, observation(second), signal);
    const third = await f.journal.reserveNext(scope, lease, 2, buildWindowsNetworkPlan(scope), signal);
    await f.journal.recordObservation(third, observation(third), signal);
    await assert.rejects(f.journal.reserveNext(scope, lease, 3, buildWindowsNetworkPlan(scope, endpoint), signal), /RECOVERY_REQUIRED/);
    assert.equal((await readdir(f.directory)).length, 7);
    assert.deepEqual(await f.journal.readObservation(third, signal), observation(third));
  } finally {await f.cleanup();}
});

test("concurrent next-generation writers create one intent and preserve every reserved key", async () => {
  const f = await fixture(), signal = new AbortController().signal, lease = randomUUID();
  try {
    const first = await f.journal.acquire(scope, lease, buildWindowsNetworkPlan(scope), signal);
    await f.journal.recordObservation(first, observation(first), signal);
    const restarted = new CompositionWindowsNetworkJournal(f.directory);
    const results = await Promise.allSettled([f.journal, restarted].map(journal =>
      journal.reserveNext(scope, lease, 1, buildWindowsNetworkPlan(scope, endpoint), signal)));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected").length, 1);
    assert.equal((await readdir(f.directory)).length, 4);
    const winner = results.find(result => result.status === "fulfilled");
    if (winner?.status !== "fulfilled") throw new Error("Missing winner");
    assert.deepEqual(await restarted.readIntent(scope, lease, 2, signal), winner.value);
  } finally {await f.cleanup();}
});

test("observations cannot substitute keys, checksum, lease or persistence", async () => {
  const f = await fixture(), signal = new AbortController().signal, lease = randomUUID();
  try {
    const intent = await f.journal.acquire(scope, lease, buildWindowsNetworkPlan(scope), signal);
    for (const changed of [{leaseId: randomUUID()}, {intentSha256: "f".repeat(64)}, {persistent: false},
      {filterKeys: intent.filterKeys.map(() => randomUUID())}])
      await assert.rejects(f.journal.recordObservation(intent, {...observation(intent), ...changed}, signal), /RECOVERY_REQUIRED/);
    assert.equal((await readdir(f.directory)).length, 2);
    await f.journal.recordObservation(intent, observation(intent), signal);
    await assert.rejects(f.journal.recordObservation(intent, observation(intent), signal), /RECOVERY_REQUIRED/);
    assert.equal((await readdir(f.directory)).length, 3);
  } finally {await f.cleanup();}
});

test("malformed retained reservation blocks reuse; no automatic cleanup or partial-record recovery", async () => {
  const f = await fixture(), signal = new AbortController().signal, lease = randomUUID();
  try {
    await f.journal.acquire(scope, lease, buildWindowsNetworkPlan(scope), signal);
    const name = (await readdir(f.directory)).find(name => name.endsWith(".lease.json"))!;
    await writeFile(join(f.directory, name), "partial");
    await assert.rejects(f.journal.readIntent(scope, lease, 1, signal), /RECOVERY_REQUIRED/);
    await assert.rejects(f.journal.acquire(scope, randomUUID(), buildWindowsNetworkPlan(scope), signal), /RECOVERY_REQUIRED/);
    assert.equal(await readFile(join(f.directory, name), "utf8"), "partial");
  } finally {await f.cleanup();}
});

test("invalid plans and pre-cancellation do not reserve a package", async () => {
  const f = await fixture(), signal = new AbortController().signal;
  try {
    const altered = buildWindowsNetworkPlan(scope); altered.rules.pop();
    await assert.rejects(f.journal.acquire(scope, randomUUID(), altered, signal), /RECOVERY_REQUIRED/);
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(f.journal.acquire(scope, randomUUID(), buildWindowsNetworkPlan(scope), cancelled.signal), /RECOVERY_REQUIRED/);
    assert.deepEqual(await readdir(f.directory), []);
  } finally {await f.cleanup();}
});

test("controller journal adapter persists exact keys before native writes and reads back before acknowledgement", async () => {
  const f = await fixture(), signal = new AbortController().signal;
  let installed: WindowsNetworkIntent | undefined; const generations: number[] = [];
  const apply = async (intent: WindowsNetworkIntent) => {
    assert.deepEqual(await f.journal.readIntent(intent.scope, intent.leaseId, intent.generation, signal), intent);
    await assert.rejects(f.journal.readObservation(intent, signal), /RECOVERY_REQUIRED/);
    installed = structuredClone(intent); generations.push(intent.generation);
  };
  const native: WindowsNetworkNativePorts = {
    installInitialDenyAll: apply,
    replaceOwnedPolicy: async (previous, next) => {assert.deepEqual(previous, installed); await apply(next);},
    readEffectivePolicy: async intent => {assert.deepEqual(intent, installed); return observation(intent);},
    resolveOriginalServer: async () => endpoint,
    confirmOwnedJobStopped: async (scope, leaseId) => ({executionId: scope.executionId, leaseId, activeProcesses: 0, jobClosed: true}),
  };
  try {
    const controller = createWindowsNetworkController(scope, createJournaledWindowsNetworkPorts(f.journal, native));
    await controller.denyBeforeStart(signal); await controller.allowOriginalServer(signal); await controller.sealAfterStop(signal);
    assert.equal(controller.status(), "SEALED"); assert.deepEqual(generations, [1, 2, 3]);
    assert.equal((await readdir(f.directory)).length, 7);
  } finally {await f.cleanup();}
});

test("lost native ACK keeps only the reserved intent and forbids a second native write", async () => {
  const f = await fixture(), signal = new AbortController().signal; let calls = 0;
  const native: WindowsNetworkNativePorts = {
    installInitialDenyAll: async () => {calls++; throw new Error("lost ACK, kernel outcome unknown");},
    replaceOwnedPolicy: async () => {throw new Error("Unexpected replace");},
    readEffectivePolicy: async () => {throw new Error("No blind readback/retry after lost ACK");},
    resolveOriginalServer: async () => endpoint,
    confirmOwnedJobStopped: async () => {throw new Error("Unexpected stop");},
  };
  try {
    const controller = createWindowsNetworkController(scope, createJournaledWindowsNetworkPorts(f.journal, native));
    await assert.rejects(controller.denyBeforeStart(signal), /RECOVERY_REQUIRED/);
    await assert.rejects(controller.denyBeforeStart(signal), /STATE_INVALID/);
    assert.equal(calls, 1); assert.equal((await readdir(f.directory)).length, 2);
    assert.equal((await readdir(f.directory)).some(name => name.endsWith(".observed.json")), false);
  } finally {await f.cleanup();}
});

test("foreign native readback cannot create an observed marker or authorize start", async () => {
  const f = await fixture(), signal = new AbortController().signal;
  const native: WindowsNetworkNativePorts = {
    installInitialDenyAll: async () => {}, replaceOwnedPolicy: async () => {},
    readEffectivePolicy: async intent => ({...observation(intent), filterKeys: intent.filterKeys.map(() => randomUUID())}),
    resolveOriginalServer: async () => endpoint, confirmOwnedJobStopped: async () => ({}),
  };
  try {
    const controller = createWindowsNetworkController(scope, createJournaledWindowsNetworkPorts(f.journal, native));
    await assert.rejects(controller.denyBeforeStart(signal), /RECOVERY_REQUIRED/);
    assert.equal(controller.status(), "RECOVERY_REQUIRED");
    assert.equal((await readdir(f.directory)).length, 2);
  } finally {await f.cleanup();}
});
