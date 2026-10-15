import assert from "node:assert/strict";
import test from "node:test";
import { runBoundedAudioBatches } from "../audio-batch-runner";

const limits = { maxJobs: 3, maxMilliseconds: 1000 };

test("empty queue exits immediately instead of keeping a runner polling", async () => {
  let calls = 0;
  const summary = await runBoundedAudioBatches({ limits, processBatch: async () => { calls++; return { claimed: 0, failed: 0 }; } });
  assert.deepEqual(summary, { claimed: 0, failed: 0, reason: "QUEUE_EMPTY" });
  assert.equal(calls, 1);
});

test("job cap stops new claims and aggregates failures without abandoning claimed work", async () => {
  let calls = 0;
  const summary = await runBoundedAudioBatches({ limits, processBatch: async (limit) => {
    assert.equal(limit, 1); calls++; return { claimed: 1, failed: calls === 2 ? 1 : 0 };
  } });
  assert.deepEqual(summary, { claimed: 3, failed: 1, reason: "JOB_LIMIT" });
  assert.equal(calls, 3);
});

test("time budget is checked after an in-flight batch finishes", async () => {
  let now = 0;
  const summary = await runBoundedAudioBatches({ limits, now: () => now, processBatch: async () => {
    now = 2000; return { claimed: 1, failed: 0 };
  } });
  assert.deepEqual(summary, { claimed: 1, failed: 0, reason: "TIME_BUDGET" });
});

test("termination signal stops before claiming another lease", async () => {
  let stop = false;
  const summary = await runBoundedAudioBatches({ limits, shouldStop: () => stop, processBatch: async () => {
    stop = true; return { claimed: 1, failed: 0 };
  } });
  assert.deepEqual(summary, { claimed: 1, failed: 0, reason: "STOP_REQUESTED" });
});

test("claim errors fail the run rather than reporting an empty queue", async () => {
  await assert.rejects(runBoundedAudioBatches({ limits, processBatch: async () => { throw new Error("AUDIO_CLAIM_FAILED"); } }), /AUDIO_CLAIM_FAILED/);
});

test("invalid limits cannot claim jobs", async () => {
  for (const maxJobs of [0, -1, 101, NaN])
    await assert.rejects(runBoundedAudioBatches({ limits: { ...limits, maxJobs }, processBatch: async () => { throw new Error("unexpected claim"); } }), /AUDIO_BATCH_LIMITS_INVALID/);
  for (const maxMilliseconds of [0, -1, 30 * 60 * 1000 + 1, Infinity])
    await assert.rejects(runBoundedAudioBatches({ limits: { ...limits, maxMilliseconds }, processBatch: async () => { throw new Error("unexpected claim"); } }), /AUDIO_BATCH_LIMITS_INVALID/);
});
