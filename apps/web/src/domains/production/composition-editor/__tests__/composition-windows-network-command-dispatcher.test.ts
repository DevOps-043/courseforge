import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp, readdir, rm, rmdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {CompositionWindowsNetworkJournal} from "../qa/composition-windows-network-journal";
import {createWindowsNetworkCommandDispatcher} from "../qa/composition-windows-network-command-dispatcher";
import {WINDOWS_NETWORK_CHANNEL_POLICY, WINDOWS_NETWORK_COMMAND_ORDER, windowsNetworkCommandResponseSchema} from "../qa/composition-windows-network-channel-contract";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "network-dispatch-test-"));
  const journal = new CompositionWindowsNetworkJournal(directory);
  const binding = {channelId: randomUUID(), operationNonce: randomUUID(), scope: {hostId: "host",
    organizationId: randomUUID(), executionId: randomUUID(), appContainerSid: "S-1-15-2-1-2-3-4-5-6-7"}};
  const leaseId = randomUUID(); let calls = 0;
  const execute = async () => {
    assert.equal((await readdir(directory)).length, calls + 1);
    return {leaseId, generation: ++calls, planSha256: "a".repeat(64), persistent: true as const};
  };
  const controller = {denyBeforeStart: execute, allowOriginalServer: execute, sealAfterStop: execute};
  const request = (sequence: number) => ({policy: WINDOWS_NETWORK_CHANNEL_POLICY.id, ...binding,
    requestId: randomUUID(), sequence, command: WINDOWS_NETWORK_COMMAND_ORDER[sequence - 1]});
  return {directory, journal, binding, controller, request, calls: () => calls,
    cleanup: async () => {for (const name of await readdir(directory)) await rm(join(directory, name)); await rmdir(directory);}};
}
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));

test("dispatcher reserves commands before effects and correlates each strict response", async () => {
  const f = await fixture(), signal = new AbortController().signal;
  try {
    const dispatch = createWindowsNetworkCommandDispatcher(f.binding, f.journal, f.controller);
    for (const sequence of [1, 2, 3]) {
      const request = f.request(sequence);
      const response = windowsNetworkCommandResponseSchema.parse(JSON.parse((await dispatch(encode(request), signal)).toString()));
      assert.equal(response.requestId, request.requestId); assert.equal(response.receipt.generation, sequence);
      assert.equal((await readdir(f.directory)).length, sequence);
    }
    assert.equal(f.calls(), 3);
  } finally {await f.cleanup();}
});
test("foreign scope, nonce, channel, order, fields and oversized or invalid UTF8 reject before effects", async () => {
  const f = await fixture(), signal = new AbortController().signal;
  try {
    const dispatch = createWindowsNetworkCommandDispatcher(f.binding, f.journal, f.controller), base = f.request(1);
    for (const changed of [{operationNonce: randomUUID()}, {channelId: randomUUID()}, {scope: {...f.binding.scope, organizationId: randomUUID()}},
      {sequence: 2}, {command: "DELETE_FILTERS"}, {endpoint: "https://external.invalid"}])
      await assert.rejects(dispatch(encode({...base, ...changed}), signal), /RECOVERY_REQUIRED/);
    await assert.rejects(dispatch(Buffer.alloc(32769), signal), /RECOVERY_REQUIRED/);
    await assert.rejects(dispatch(Buffer.from([255]), signal), /RECOVERY_REQUIRED/);
    assert.equal(f.calls(), 0); assert.deepEqual(await readdir(f.directory), []);
  } finally {await f.cleanup();}
});
test("replay is rejected both in memory and by a restarted dispatcher with the same durable channel", async () => {
  const f = await fixture(), signal = new AbortController().signal;
  try {
    const request = encode(f.request(1)), dispatch = createWindowsNetworkCommandDispatcher(f.binding, f.journal, f.controller);
    await dispatch(request, signal);
    await assert.rejects(dispatch(request, signal), /RECOVERY_REQUIRED/);
    const restarted = createWindowsNetworkCommandDispatcher(f.binding, new CompositionWindowsNetworkJournal(f.directory), f.controller);
    await assert.rejects(restarted(request, signal), /RECOVERY_REQUIRED/);
    assert.equal(f.calls(), 1); assert.equal((await readdir(f.directory)).length, 1);
  } finally {await f.cleanup();}
});
test("uncertain effect retains command and latches all later dispatches", async () => {
  const f = await fixture(), signal = new AbortController().signal;
  try {
    f.controller.denyBeforeStart = async () => {throw new Error("private broker details");};
    const dispatch = createWindowsNetworkCommandDispatcher(f.binding, f.journal, f.controller);
    await assert.rejects(dispatch(encode(f.request(1)), signal), {message: "CONTROLLED_RENDER_NETWORK_CHANNEL_RECOVERY_REQUIRED"});
    await assert.rejects(dispatch(encode(f.request(1)), signal), /RECOVERY_REQUIRED/);
    assert.equal((await readdir(f.directory)).length, 1);
  } finally {await f.cleanup();}
});
test("a changed receipt lease cannot authorize the next phase", async () => {
  const f = await fixture(), signal = new AbortController().signal;
  try {
    const dispatch = createWindowsNetworkCommandDispatcher(f.binding, f.journal, f.controller);
    await dispatch(encode(f.request(1)), signal);
    f.controller.allowOriginalServer = async () => ({leaseId: randomUUID(), generation: 2, planSha256: "a".repeat(64), persistent: true});
    await assert.rejects(dispatch(encode(f.request(2)), signal), /RECOVERY_REQUIRED/);
    await assert.rejects(dispatch(encode(f.request(3)), signal), /RECOVERY_REQUIRED/);
    assert.equal((await readdir(f.directory)).length, 2);
  } finally {await f.cleanup();}
});
test("abort rejects a noncooperative effect without publishing its late response", async () => {
  const f = await fixture(), abort = new AbortController();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const started = new Promise<void>(resolve => {entered = resolve;});
  try {
    const original = f.controller.denyBeforeStart;
    f.controller.denyBeforeStart = async () => {entered(); await gate; return original();};
    const dispatch = createWindowsNetworkCommandDispatcher(f.binding, f.journal, f.controller);
    const running = dispatch(encode(f.request(1)), abort.signal), rejected = assert.rejects(running, /RECOVERY_REQUIRED/);
    await started; abort.abort(); await rejected;
    release(); await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(dispatch(encode(f.request(2)), new AbortController().signal), /RECOVERY_REQUIRED/);
    assert.equal((await readdir(f.directory)).length, 1);
  } finally {release(); await f.cleanup();}
});
