import assert from "node:assert/strict";
import test from "node:test";
import { CompositionSaveQueue } from "../composition-save-queue";
import { COMPOSITION_PREVIEW_SAVE_QUEUE_CONFIG } from "../composition-preview-sync.config";

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
