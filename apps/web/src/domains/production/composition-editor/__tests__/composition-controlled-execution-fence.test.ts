import assert from "node:assert/strict";
import test from "node:test";
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {CompositionControlledExecutionFenceStore} from "../qa/composition-controlled-execution-fence";
import {createOwnedControlledExecutor} from "../qa/composition-controlled-owned-executor";
import {classifyControlledRenderWorkerFailure} from "../qa/composition-controlled-render-worker-contract";
import type {ControlledMaterializedExecutor} from "../qa/composition-materialized-supervisor-renderer";

const uuid = "00000000-0000-4000-8000-000000000001";
const descriptor = {organizationId: uuid, revisionId: uuid, executionId: uuid,
  documentHash: "a".repeat(64), projectHash: "b".repeat(64)} as Parameters<ControlledMaterializedExecutor>[0];
const workspace = {} as Parameters<ControlledMaterializedExecutor>[1];
const output = {videoPath: "owned output"} as Awaited<ReturnType<ControlledMaterializedExecutor>>;
async function fixture() {
  const parent = resolve("apps/web/.tmp"); await mkdir(parent, {recursive: true});
  const directory = await mkdtemp(join(parent, "execution-fence-"));
  return {directory, store: new CompositionControlledExecutionFenceStore(directory, "worker-one"),
    path: join(directory, "worker-one.pending.json"), cleanup: () => rm(directory, {recursive: true, force: true})};
}

test("exclusive fence survives a fresh store instance and never expires or overwrites on retry", async () => {
  const f = await fixture();
  try {
    const lease = await f.store.acquire(descriptor), before = await readFile(f.path, "utf8");
    const restarted = new CompositionControlledExecutionFenceStore(f.directory, "worker-one");
    await assert.rejects(restarted.acquire({...descriptor, executionId: "00000000-0000-4000-8000-000000000002"}), /FENCE_PENDING/);
    assert.equal(await readFile(f.path, "utf8"), before);
    await f.store.releaseConfirmed(lease);
    assert.deepEqual(await readdir(f.directory), []);
    const next = await restarted.acquire(descriptor); assert.notEqual(next.nonce, lease.nonce);
    await restarted.releaseConfirmed(next);
  } finally {await f.cleanup();}
});

test("concurrent admissions have exactly one winner, scoped by stable host identity", async () => {
  const f = await fixture();
  try {
    const second = new CompositionControlledExecutionFenceStore(f.directory, "worker-one");
    const results = await Promise.allSettled([f.store.acquire(descriptor), second.acquire(descriptor)]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const winner = results.find(result => result.status === "fulfilled");
    assert.ok(winner?.status === "fulfilled"); await f.store.releaseConfirmed(winner.value);
  } finally {await f.cleanup();}
});

test("foreign lease or changed record cannot delete an existing fence", async () => {
  const f = await fixture();
  try {
    const lease = await f.store.acquire(descriptor);
    await assert.rejects(f.store.releaseConfirmed({...lease, nonce: "00000000-0000-4000-8000-000000000002"}), /RELEASE_UNCONFIRMED/);
    assert.equal(JSON.parse(await readFile(f.path, "utf8")).nonce, lease.nonce);
    await writeFile(f.path, "corrupt unknown owner");
    await assert.rejects(f.store.releaseConfirmed(lease), /RELEASE_UNCONFIRMED/);
    assert.equal(await readFile(f.path, "utf8"), "corrupt unknown owner");
    await assert.rejects(f.store.acquire(descriptor), /FENCE_PENDING/);
  } finally {await f.cleanup();}
});

test("lifecycle creates fence before start and releases only after matching stop", async () => {
  const f = await fixture();
  try {
    let starts = 0;
    const execute = createOwnedControlledExecutor({fence: f.store, start: () => {
      starts++;
      return {completion: Promise.resolve(output), stopAndConfirm: async () => {
        assert.equal(JSON.parse(await readFile(f.path, "utf8")).executionId, uuid);
        return {status: "STOPPED", executionId: uuid};
      }};
    }});
    assert.equal(await execute(descriptor, workspace), output);
    assert.deepEqual(await readdir(f.directory), []); assert.equal(starts, 1);
  } finally {await f.cleanup();}
});

test("uncertain stop blocks fresh lifecycle after restart before any start", async () => {
  const f = await fixture();
  try {
    const first = createOwnedControlledExecutor({fence: f.store,
      start: () => ({completion: Promise.resolve(output), stopAndConfirm: async () => undefined})});
    await assert.rejects(first(descriptor, workspace), /TERMINATION_UNCONFIRMED/);
    const retained = await readFile(f.path, "utf8");
    let starts = 0;
    const restarted = createOwnedControlledExecutor({fence: new CompositionControlledExecutionFenceStore(f.directory, "worker-one"),
      start: () => {starts++; throw new Error("unexpected");}});
    await assert.rejects(restarted(descriptor, workspace), /FENCE_PENDING/);
    assert.equal(starts, 0); assert.equal(restarted.isQuarantined(), true);
    assert.equal(await readFile(f.path, "utf8"), retained);
    assert.deepEqual(classifyControlledRenderWorkerFailure(new Error("CONTROLLED_RENDER_EXECUTION_FENCE_PENDING")),
      {code: "CONTROLLED_RENDER_EXECUTION_FENCE_PENDING", retryable: false, recoveryRequired: true});
  } finally {await f.cleanup();}
});

test("cancellation during acquisition releases only its own fence without starting a process", async () => {
  const f = await fixture();
  try {
    const controller = new AbortController(); let starts = 0;
    const execute = createOwnedControlledExecutor({fence: {
      acquire: async request => {const lease = await f.store.acquire(request); controller.abort(); return lease;},
      releaseConfirmed: lease => f.store.releaseConfirmed(lease)},
      start: () => {starts++; throw new Error("unexpected");}});
    await assert.rejects(execute(descriptor, workspace, controller.signal), /CONTROLLED_RENDER_ABORTED/);
    assert.equal(starts, 0); assert.deepEqual(await readdir(f.directory), []);
  } finally {await f.cleanup();}
});

test("release failure after confirmed stop retains tracking, rejects output and quarantines executor", async () => {
  const f = await fixture();
  try {
    const execute = createOwnedControlledExecutor({fence: {acquire: request => f.store.acquire(request),
      releaseConfirmed: async () => {throw new Error("private OS details");}},
      start: () => ({completion: Promise.resolve(output), stopAndConfirm: async () => ({status: "STOPPED", executionId: uuid})})});
    await assert.rejects(execute(descriptor, workspace), /EXECUTION_FENCE_RELEASE_UNCONFIRMED/);
    assert.equal(execute.isQuarantined(), true);
    assert.equal((await readdir(f.directory)).length, 1);
  } finally {await f.cleanup();}
});
