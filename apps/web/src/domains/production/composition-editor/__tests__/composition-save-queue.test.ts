import assert from "node:assert/strict";
import test from "node:test";
import { CompositionSaveQueue } from "../composition-save-queue";
import { COMPOSITION_PREVIEW_SAVE_QUEUE_CONFIG } from "../composition-preview-sync.config";

test("external idle reservation rejects saves and nested reservations until release", async () => {
  const queue = new CompositionSaveQueue<number>(async () => true);
  let release!: () => void;
  const reserved = queue.runExclusiveWhenIdle(() => new Promise<void>(resolve => { release = resolve; }));
  assert.equal(queue.snapshot().status, "RUNNING");
  assert.equal(await queue.enqueue(1), false);
  await assert.rejects(queue.runExclusiveWhenIdle(async () => {}), /BUSY/);
  let idle = false; const waiter = queue.whenIdle().then(() => { idle = true; });
  await Promise.resolve(); assert.equal(idle, false);
  release(); await Promise.all([reserved, waiter]);
  assert.equal(idle, true); assert.equal(await queue.enqueue(2), true);
});

test("external reservation rejects an active queue and releases after thrown workflow", async () => {
  let release!: (value: boolean) => void;
  const queue = new CompositionSaveQueue<number>(() => new Promise(resolve => { release = resolve; }));
  const saving = queue.enqueue(1);
  await assert.rejects(queue.runExclusiveWhenIdle(async () => {}), /BUSY/);
  release(true); await saving;
  await assert.rejects(queue.runExclusiveWhenIdle(async () => { throw new Error("workflow"); }), /workflow/);
  assert.equal(queue.snapshot().status, "IDLE"); await queue.whenIdle();
});

test("executes saves serially in insertion order", async () => {
  const executed: number[] = [];
  let active = 0;
  let maximumActive = 0;
  const queue = new CompositionSaveQueue<number>(async (command) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise<void>((resolve) => setImmediate(resolve));
    executed.push(command);
    active -= 1;
    return true;
  });

  const results = await Promise.all([queue.enqueue(1), queue.enqueue(2), queue.enqueue(3)]);
  assert.deepEqual(results, [true, true, true]);
  assert.deepEqual(executed, [1, 2, 3]);
  assert.equal(maximumActive, 1);
  assert.deepEqual(queue.snapshot(), { pendingCount: 0, status: "IDLE" });
});

test("notifies waiters only after the active command and queued tail settle", async () => {
  const releases: Array<() => void> = [];
  const queue = new CompositionSaveQueue<number>(
    async () => new Promise<boolean>((resolve) => releases.push(() => resolve(true))),
  );
  const first = queue.enqueue(1);
  const second = queue.enqueue(2);
  let becameIdle = false;
  const idle = queue.whenIdle().then(() => { becameIdle = true; });

  while (releases.length === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  releases.shift()!();
  await first;
  assert.equal(becameIdle, false);

  while (releases.length === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  releases.shift()!();
  await Promise.all([second, idle]);
  assert.equal(becameIdle, true);
});

test("fails closed and does not execute the queued tail after an error", async () => {
  const executed: number[] = [];
  const queue = new CompositionSaveQueue<number>(async (command) => {
    executed.push(command);
    await new Promise<void>((resolve) => setImmediate(resolve));
    return false;
  });

  const results = await Promise.all([queue.enqueue(1), queue.enqueue(2), queue.enqueue(3)]);
  assert.deepEqual(results, [false, false, false]);
  assert.deepEqual(executed, [1]);
});

test("rejects bounded overflow explicitly", async () => {
  const releases: Array<() => void> = [];
  let overflowCount = 0;
  const queue = new CompositionSaveQueue<number>(
    async () => new Promise<boolean>((resolve) => { releases.push(() => resolve(true)); }),
    undefined,
    () => { overflowCount += 1; },
  );
  const running = queue.enqueue(0);
  const pending = Array.from(
    { length: COMPOSITION_PREVIEW_SAVE_QUEUE_CONFIG.maxPendingCommands },
    (_, index) => queue.enqueue(index + 1),
  );
  assert.equal(await queue.enqueue(999), false);
  assert.equal(overflowCount, 1);
  // Resolve every serial command without leaving asynchronous work behind.
  for (let index = 0; index <= pending.length; index += 1) {
    while (releases.length === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    releases.shift()!();
  }
  await Promise.all([running, ...pending]);
});
