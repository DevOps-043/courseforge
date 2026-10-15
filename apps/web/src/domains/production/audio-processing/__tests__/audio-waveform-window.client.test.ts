import assert from "node:assert/strict";
import test from "node:test";
import { readWaveformWindow } from "../audio-waveform-window.client";

test("limits parallel window reads and cancels a queued request before network access", async () => {
  const originalFetch = globalThis.fetch;
  const complete: (() => void)[] = [];
  let active = 0, maximum = 0, requests = 0;
  globalThis.fetch = (async () => {
    active++; requests++; maximum = Math.max(maximum, active);
    return new Promise<Response>((resolve) => complete.push(() => {
      active--; resolve(Response.json({ data: { checksum: "a".repeat(64), bucketSizeSamples: 1,
        durationSeconds: 1, sampleRateHz: 1, min: [-1], max: [1] } }));
    }));
  }) as typeof fetch;
  try {
    const controllers = Array.from({ length: 5 }, () => new AbortController());
    const promises = controllers.map((controller, index) => readWaveformWindow({
      componentId: "component-pool-test", assetId: `asset-${index}`, checksum: "a".repeat(64),
      start: 0, end: 1, width: 100, signal: controller.signal,
    }));
    const results = Promise.allSettled(promises);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(requests, 3); controllers[3].abort();
    while (complete.length) {
      complete.shift()!(); await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const settled = await results;
    assert.equal(maximum, 3); assert.equal(requests, 4);
    assert.equal(settled[3].status, "rejected");
    assert.equal(settled.filter((result) => result.status === "fulfilled").length, 4);
  } finally { globalThis.fetch = originalFetch; }
});
