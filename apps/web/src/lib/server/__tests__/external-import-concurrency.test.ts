import assert from "node:assert/strict";
import test from "node:test";
import {
  BoundedConcurrencyLimiter,
  ExternalImportCapacityError,
} from "../external-import-concurrency";

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

test("external import capacity never exceeds its active or queued bounds", async () => {
  const limiter = new BoundedConcurrencyLimiter(2, 2, 1_000);
  const releases: Array<() => void> = [];
  let active = 0;
  let peak = 0;
  const task = () => limiter.run(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => releases.push(resolve));
    active -= 1;
  });

  const operations = [task(), task(), task(), task()];
  await nextTurn();
  assert.deepEqual(limiter.snapshot(), { active: 2, queued: 2 });
  releases.splice(0).forEach((release) => release());
  await nextTurn();
  assert.deepEqual(limiter.snapshot(), { active: 2, queued: 0 });
  releases.splice(0).forEach((release) => release());
  await Promise.all(operations);
  assert.equal(peak, 2);
  assert.deepEqual(limiter.snapshot(), { active: 0, queued: 0 });
});

test("external import capacity rejects work beyond the queue budget", async () => {
  const limiter = new BoundedConcurrencyLimiter(1, 1, 1_000);
  let releaseFirst: (() => void) | undefined;
  const first = limiter.run(() => new Promise<void>((resolve) => { releaseFirst = resolve; }));
  const second = limiter.run(async () => "second");

  await assert.rejects(
    limiter.run(async () => "overflow"),
    (error) => error instanceof ExternalImportCapacityError && error.reason === "queue_full",
  );
  releaseFirst?.();
  assert.equal(await second, "second");
  await first;
});

test("external import capacity times out queued work and releases failed slots", async () => {
  const limiter = new BoundedConcurrencyLimiter(1, 1, 5);
  let releaseFirst: (() => void) | undefined;
  const first = limiter.run(() => new Promise<void>((resolve) => { releaseFirst = resolve; }));
  await assert.rejects(
    limiter.run(async () => "late"),
    (error) => error instanceof ExternalImportCapacityError && error.reason === "wait_timeout",
  );
  releaseFirst?.();
  await first;

  await assert.rejects(limiter.run(async () => { throw new Error("provider failed"); }), /provider failed/);
  assert.equal(await limiter.run(async () => "recovered"), "recovered");
});

test("external import capacity removes cancelled callers from the queue", async () => {
  const limiter = new BoundedConcurrencyLimiter(1, 1, 1_000);
  let releaseFirst: (() => void) | undefined;
  const first = limiter.run(() => new Promise<void>((resolve) => { releaseFirst = resolve; }));
  const controller = new AbortController();
  const queued = limiter.run(async () => "cancelled", controller.signal);
  controller.abort(new Error("caller cancelled"));
  await assert.rejects(queued, /caller cancelled/);
  assert.deepEqual(limiter.snapshot(), { active: 1, queued: 0 });
  releaseFirst?.();
  await first;
});
