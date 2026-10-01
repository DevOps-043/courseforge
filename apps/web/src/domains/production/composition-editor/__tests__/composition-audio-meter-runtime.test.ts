import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { COMPOSITION_AUDIO_METER_CONFIG, measureAudioMeterSamples, renderCompositionAudioMeterRuntime } from "../composition-audio-meter-runtime";
import { parseCompositionPreviewIframeMessage } from "../composition-preview-protocol";

test("measures sampled peak, RMS, silence and clipping without conflating dBFS with true peak", () => {
  const measured = measureAudioMeterSamples([0.5, -0.5]);
  assert.ok(Math.abs(measured.peakDbfs! + 6.0206) < 0.0001);
  assert.equal(measured.rmsDbfs, measured.peakDbfs);
  assert.equal(measured.clipping, false);
  assert.equal(measureAudioMeterSamples([1, -1]).clipping, true);
  assert.ok(measureAudioMeterSamples([1.5]).peakDbfs! > 0);
  assert.deepEqual(measureAudioMeterSamples([0, 0]), { peakDbfs: null, rmsDbfs: null, clipping: false });
  assert.throws(() => measureAudioMeterSamples([Number.NaN]), /AUDIO_METER_SAMPLE_INVALID/);
});

function runtimeFixture(options: { enabled?: boolean; crossOrigin?: string; sourceCount?: number; suspended?: boolean; deferredResume?: boolean; failSourceAt?: number } = {}) {
  const messages: unknown[] = [];
  const timers = new Map<number, () => void>();
  const listeners = new Map<string, () => void>();
  let now = 0;
  let peak = 1.1;
  let attached = 0;
  let created = 0;
  let closed = false;
  let releaseResume: (() => void) | undefined;
  const resumeGate = options.deferredResume ? new Promise<void>((resolve) => { releaseResume = resolve; }) : Promise.resolve();
  class FakeAudioContext {
    state = options.suspended ? "suspended" : "running";
    destination = {};
    constructor() { created += 1; }
    async resume() { await resumeGate; /* A blocked browser stays suspended until an actual user gesture. */ }
    async close() { closed = true; }
    createGain() { return { connect() {}, disconnect() {}, channelCount: 0, channelCountMode: "" }; }
    createChannelSplitter() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { fftSize: 0, connect() {}, disconnect() {}, getFloatTimeDomainData(buffer: Float32Array) { buffer.fill(peak); } }; }
    createMediaElementSource() {
      if (options.failSourceAt === attached + 1) throw new Error("Source graph failed");
      attached += 1;
      return { connect() {}, disconnect() {} };
    }
  }
  const runtime = runInNewContext(`${renderCompositionAudioMeterRuntime(options.enabled ?? true)}; audioMeters`, {
    postParentMessage: (message: unknown) => messages.push(message),
    performance: { now: () => now },
    audioUnlock: { dataset: {} },
    document: { querySelectorAll: () => Array.from({ length: options.sourceCount ?? 2 }, () => ({ crossOrigin: options.crossOrigin ?? "anonymous" })) },
    window: {
      AudioContext: FakeAudioContext,
      setInterval(callback: () => void, interval: number) { assert.equal(interval, COMPOSITION_AUDIO_METER_CONFIG.intervalMs); timers.set(1, callback); return 1; },
      clearInterval(id: number) { timers.delete(id); },
      addEventListener(name: string, callback: () => void) { listeners.set(name, callback); },
    },
  }) as { pause: () => void; reset: () => void; resume: () => Promise<boolean> };
  return { runtime, messages, timers, listeners, releaseResume: () => releaseResume?.(), get attached() { return attached; }, get created() { return created; }, get closed() { return closed; }, advance(milliseconds: number, amplitude: number) { now += milliseconds; peak = amplitude; timers.get(1)?.(); } };
}

test("a pause during asynchronous audio activation prevents a late graph from starting", async () => {
  const fixture = runtimeFixture({ deferredResume: true });
  const pending = fixture.runtime.resume();
  fixture.runtime.pause();
  fixture.releaseResume();
  assert.equal(await pending, false);
  assert.equal(fixture.attached, 0);
  assert.equal(fixture.timers.size, 0);
  assert.equal(await fixture.runtime.resume(), true);
  assert.equal(fixture.attached, 2);
});

test("a partially attached graph remains unavailable rather than presenting an incomplete mix", async () => {
  const fixture = runtimeFixture({ failSourceAt: 2 });
  assert.equal(await fixture.runtime.resume(), false);
  assert.equal(fixture.attached, 1);
  assert.equal(await fixture.runtime.resume(), false);
  assert.equal(fixture.timers.size, 0);
  const message = parseCompositionPreviewIframeMessage(fixture.messages.at(-1));
  assert.equal(message?.type, "courseforge-composition-audio-meter");
  if (message?.type !== "courseforge-composition-audio-meter") throw new Error("Missing meter failure");
  assert.equal(message.state, "UNAVAILABLE");
  assert.equal(message.channels.length, 0);
});

test("the emitted runtime keeps one stereo graph, holds clipping, pauses and disposes", async () => {
  const fixture = runtimeFixture();
  assert.equal(await fixture.runtime.resume(), true);
  assert.equal(fixture.attached, 2);
  assert.equal(fixture.timers.size, 1);
  let message = parseCompositionPreviewIframeMessage(fixture.messages.at(-1));
  assert.equal(message?.type, "courseforge-composition-audio-meter");
  if (message?.type !== "courseforge-composition-audio-meter") throw new Error("Missing meter message");
  assert.equal(message.channels.length, 2);
  assert.equal(message.channels[0].clipping, true);
  fixture.advance(500, 0.1);
  message = parseCompositionPreviewIframeMessage(fixture.messages.at(-1));
  if (message?.type !== "courseforge-composition-audio-meter") throw new Error("Missing meter message");
  assert.equal(message.channels[0].clipping, true);
  fixture.runtime.reset();
  fixture.advance(100, 0.1);
  message = parseCompositionPreviewIframeMessage(fixture.messages.at(-1));
  if (message?.type !== "courseforge-composition-audio-meter") throw new Error("Missing meter message");
  assert.equal(message.channels[0].clipping, false);
  fixture.runtime.pause();
  assert.equal(fixture.timers.size, 0);
  await fixture.runtime.resume();
  assert.equal(fixture.attached, 2);
  assert.equal(fixture.created, 1);
  fixture.listeners.get("pagehide")?.();
  assert.equal(fixture.closed, true);
  assert.equal(fixture.timers.size, 0);
});

test("unsafe, excessive, blocked and disabled inputs never reroute media", async () => {
  for (const options of [{ crossOrigin: "" }, { sourceCount: 33 }, { suspended: true }, { enabled: false }, { sourceCount: 0 }]) {
    const fixture = runtimeFixture(options);
    assert.equal(await fixture.runtime.resume(), false);
    assert.equal(fixture.attached, 0);
    assert.equal(fixture.timers.size, 0);
    if (options.enabled === false) assert.equal(fixture.created, 0);
  }
});

test("meter protocol rejects incomplete stereo data, unsafe levels and unexpected payload fields", () => {
  const message = { type: "courseforge-composition-audio-meter", state: "ACTIVE", reason: null, channels: [{ peakDbfs: -6, rmsDbfs: -12, clipping: false }, { peakDbfs: -6, rmsDbfs: -12, clipping: false }] };
  assert.ok(parseCompositionPreviewIframeMessage(message));
  assert.equal(parseCompositionPreviewIframeMessage({ ...message, channels: message.channels.slice(0, 1) }), null);
  assert.equal(parseCompositionPreviewIframeMessage({ ...message, channels: [{ ...message.channels[0], peakDbfs: Number.POSITIVE_INFINITY }, message.channels[1]] }), null);
  assert.equal(parseCompositionPreviewIframeMessage({ ...message, samples: [1, 2, 3] }), null);
  assert.equal(parseCompositionPreviewIframeMessage({ ...message, state: "PAUSED" }), null);
});
