import assert from "node:assert/strict";
import test from "node:test";
import {createOwnedControlledExecutor, CONTROLLED_EXECUTOR_OWNERSHIP_POLICY} from "../qa/composition-controlled-owned-executor";
import {classifyControlledRenderWorkerFailure} from "../qa/composition-controlled-render-worker-contract";
import type {ControlledMaterializedExecutor} from "../qa/composition-materialized-supervisor-renderer";

const executionId = "00000000-0000-4000-8000-000000000001";
const descriptor = {executionId} as Parameters<ControlledMaterializedExecutor>[0];
const workspace = {directory: "private workspace"} as Parameters<ControlledMaterializedExecutor>[1];
const result = {videoPath: "operator output"} as Awaited<ReturnType<ControlledMaterializedExecutor>>;
const stopped = {status: "STOPPED", executionId};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => {resolve = finish;});
  return {promise, resolve};
}

test("output is withheld until matching stop confirmation, and inputs are independent clones", async () => {
  const confirmation = deferred<unknown>();
  const closing = deferred<void>();
  let closes = 0, published = false;
  const execute = createOwnedControlledExecutor({start: (received, receivedWorkspace) => {
    assert.notEqual(received, descriptor); assert.notEqual(receivedWorkspace, workspace);
    return {completion: Promise.resolve(result), stopAndConfirm: () => {closes++; closing.resolve(); return confirmation.promise;}};
  }});
  const running = execute(descriptor, workspace).then(value => {published = true; return value;});
  await closing.promise;
  assert.equal(published, false);
  confirmation.resolve(stopped);
  assert.equal(await running, result); assert.equal(closes, 1);
});

test("root failure still drains ownership and never exposes private error details", async () => {
  let closes = 0;
  const execute = createOwnedControlledExecutor({start: () => ({completion: Promise.reject(new Error("private credentials")),
    stopAndConfirm: async () => {closes++; return stopped;}})});
  await assert.rejects(execute(descriptor, workspace), {message: "CONTROLLED_RENDER_EXECUTOR_FAILED"});
  assert.equal(closes, 1);
});

test("measurement files are verified before start and after confirmed stop, outside cloned workspace", async () => {
  const events: string[] = [];
  const execute = createOwnedControlledExecutor({start: (_descriptor, receivedWorkspace) => {
    assert.deepEqual(structuredClone(receivedWorkspace), workspace);
    events.push("start");
    return {completion: Promise.resolve(result), stopAndConfirm: async () => {events.push("stop"); return stopped;}};
  }});
  assert.equal(await execute(descriptor, workspace, undefined,
    {verifyMeasurementFiles: async () => {events.push("verify");}}), result);
  assert.deepEqual(events, ["verify", "start", "stop", "verify"]);
});

test("file verification failure never starts a process or publishes a stopped candidate", async () => {
  for (const failingCheck of [1, 2]) {
    let checks = 0, starts = 0, stops = 0;
    const execute = createOwnedControlledExecutor({start: () => {
      starts++;
      return {completion: Promise.resolve(result), stopAndConfirm: async () => {stops++; return stopped;}};
    }});
    await assert.rejects(execute(descriptor, workspace, undefined, {verifyMeasurementFiles: async () => {
      if (++checks === failingCheck) throw new Error("CONFORMANCE_FILE_INTEGRITY_MISMATCH");
    }}));
    assert.equal(starts, failingCheck - 1);
    assert.equal(stops, failingCheck - 1);
    assert.equal(execute.isQuarantined(), false);
  }
});

test("pre-abort never acquires ownership or incorrectly reports uncertain termination", async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const execute = createOwnedControlledExecutor({start: () => {calls++; throw new Error("unexpected");}});
  await assert.rejects(execute(descriptor, workspace, controller.signal), {message: "CONTROLLED_RENDER_ABORTED"});
  assert.equal(calls, 0);
});

test("noncooperative completion cannot publish after abort; confirmed stop is still awaited", async () => {
  const controller = new AbortController();
  const completion = deferred<typeof result>(), confirmation = deferred<unknown>(), closing = deferred<void>();
  let closes = 0, settled = false;
  const execute = createOwnedControlledExecutor({start: () => ({completion: completion.promise,
    stopAndConfirm: () => {closes++; closing.resolve(); return confirmation.promise;}})});
  const running = execute(descriptor, workspace, controller.signal);
  const rejection = assert.rejects(running, {message: "CONTROLLED_RENDER_ABORTED"}).then(() => {settled = true;});
  controller.abort(); await closing.promise;
  completion.resolve(result); await Promise.resolve();
  assert.equal(settled, false);
  confirmation.resolve(stopped); await rejection; assert.equal(closes, 1);
});

test("cancel during successful-root cleanup invalidates output", async () => {
  const controller = new AbortController();
  const execute = createOwnedControlledExecutor({start: () => ({completion: Promise.resolve(result),
    stopAndConfirm: async () => {controller.abort(); return stopped;}})});
  await assert.rejects(execute(descriptor, workspace, controller.signal), {message: "CONTROLLED_RENDER_ABORTED"});
});

test("missing, foreign and malformed confirmations require intervention, with no retry", async () => {
  for (const confirmation of [undefined, {status: "RUNNING", executionId}, {...stopped, extra: true},
    {...stopped, executionId: "00000000-0000-4000-8000-000000000002"}]) {
    const execute = createOwnedControlledExecutor({start: () => ({completion: Promise.resolve(result), stopAndConfirm: async () => confirmation})});
    await assert.rejects(execute(descriptor, workspace), {message: CONTROLLED_EXECUTOR_OWNERSHIP_POLICY.terminationUnconfirmedCode});
  }
  assert.deepEqual(classifyControlledRenderWorkerFailure(new Error(CONTROLLED_EXECUTOR_OWNERSHIP_POLICY.terminationUnconfirmedCode)),
    {code: CONTROLLED_EXECUTOR_OWNERSHIP_POLICY.terminationUnconfirmedCode, retryable: false, recoveryRequired: true});
});

test("failed or noncooperative stop is bounded and cannot convert a root result into success", async () => {
  for (const close of [async () => {throw new Error("private driver error");}, () => new Promise<never>(() => {})]) {
    const execute = createOwnedControlledExecutor({stopMilliseconds: 10,
      start: () => ({completion: Promise.resolve(result), stopAndConfirm: close})});
    await assert.rejects(execute(descriptor, workspace), {message: CONTROLLED_EXECUTOR_OWNERSHIP_POLICY.terminationUnconfirmedCode});
  }
});

test("start that throws after possibly spawning is unknown, never silently retried", async () => {
  const execute = createOwnedControlledExecutor({start: () => {throw new Error("spawn uncertainty");}});
  await assert.rejects(execute(descriptor, workspace), {message: CONTROLLED_EXECUTOR_OWNERSHIP_POLICY.terminationUnconfirmedCode});
});

test("shared work deadline aborts noncooperative completion but still confirms stop", async () => {
  let closes = 0;
  const execute = createOwnedControlledExecutor({timeoutMilliseconds: 1_000,
    start: () => ({completion: new Promise<never>(() => {}), stopAndConfirm: async () => {closes++; return stopped;}})});
  await assert.rejects(execute(descriptor, workspace), {message: "CONTROLLED_RENDER_DEADLINE_EXCEEDED"});
  assert.equal(closes, 1);
});

test("unconfirmed termination quarantines this host executor and prevents subsequent starts", async () => {
  let starts = 0;
  const execute = createOwnedControlledExecutor({start: () => {
    starts++;
    return {completion: Promise.resolve(result), stopAndConfirm: async () => undefined};
  }});
  assert.equal(execute.isQuarantined(), false);
  await assert.rejects(execute(descriptor, workspace), /EXECUTOR_TERMINATION_UNCONFIRMED/);
  assert.equal(execute.isQuarantined(), true);
  await assert.rejects(execute(descriptor, workspace), /EXECUTOR_TERMINATION_UNCONFIRMED/);
  assert.equal(starts, 1);
});
