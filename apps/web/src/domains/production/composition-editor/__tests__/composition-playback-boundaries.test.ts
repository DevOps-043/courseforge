import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createMediaBoundaryTracker, evaluateMediaBoundaries, mediaBoundaryPlanHash } from "../qa/composition-playback-boundaries";
import { playbackBoundaryFixture } from "./composition-playback-test-fixtures";
import { playbackCaptureInstallExpression } from "../qa/composition-playback-capture-runtime";
import { COMPOSITION_PREVIEW_PROTOCOL_VERSION } from "../composition-preview-protocol";

const rate = 48000;
const quantum = 128 * 1000 / rate;
const tolerance = 1000 / 30;
const evaluate = (witness: unknown, origin = 0, count = 1) => evaluateMediaBoundaries(witness, origin, rate, quantum, tolerance, count);

test("native origin is subtracted without moving the evidence or correcting lag", () => {
  const result = evaluate(playbackBoundaryFixture(2, "voice", 4800), 4800);
  assert.equal(result.status, "PASS"); assert.equal(result.checkedClipCount, 1);
  assert.equal(result.maximumBoundaryErrorUpperBoundMilliseconds, quantum);
});

test("missing per-clip stop is INCOMPLETE despite large aggregate event counts", () => {
  const first = playbackBoundaryFixture(2); const second = playbackBoundaryFixture(2, "second").media[0]!;
  const witness = {...first, media: [...first.media, {...second, stopFrame: null, playingEvents: 1000}]};
  witness.planHash = mediaBoundaryPlanHash(witness.media.map((row) => row.window));
  assert.equal(evaluate(witness, 0, 2).status, "INCOMPLETE");
  assert.equal(evaluate(witness, 0, 2).checkedClipCount, 1);
});

test("source exhaustion respects offset while looping video audio requires full window", () => {
  const witness = playbackBoundaryFixture(2); const row = witness.media[0]!;
  row.window.sourceOffsetSeconds = 0.5; row.sourceDurationSeconds = 1; row.stopFrame = rate / 2;
  witness.planHash = mediaBoundaryPlanHash([row.window]); assert.equal(evaluate(witness).status, "PASS");
  row.window.loop = true; witness.planHash = mediaBoundaryPlanHash([row.window]);
  assert.equal(evaluate(witness).status, "FAIL"); row.stopFrame = 2 * rate;
  assert.equal(evaluate(witness).status, "PASS");
});

test("one-frame boundary uses observed quantum to distinguish uncertainty from failure", () => {
  const witness = playbackBoundaryFixture(2); const row = witness.media[0]!;
  row.firstPlayingFrame = 1500; assert.equal(evaluate(witness).status, "INCOMPLETE");
  row.firstPlayingFrame = 1800; assert.equal(evaluate(witness).status, "FAIL");
  row.firstPlayingFrame = 1200; assert.equal(evaluate(witness).status, "PASS");
});

test("early stops or replay cannot be hidden by later events", () => {
  const witness = playbackBoundaryFixture(2); const row = witness.media[0]!;
  row.unexpectedStops = 1; assert.equal(evaluate(witness).status, "FAIL");
  row.unexpectedStops = 0; row.firstPlayingFrame = 200; row.stopFrame = 100;
  assert.equal(evaluate(witness).status, "FAIL");
});

test("missing legacy witness is readable but not boundary PASS", () => {
  assert.equal(evaluate(undefined).status, "INCOMPLETE");
  const witness = playbackBoundaryFixture(2); witness.media[0]!.sourceDurationSeconds = 0;
  assert.equal(evaluate(witness).status, "INCOMPLETE");
  witness.media[0]!.window.loop = true; witness.planHash = mediaBoundaryPlanHash([witness.media[0]!.window]);
  assert.equal(evaluate(witness).status, "INCOMPLETE");
});

test("plan hash, exact clip coverage and duplicate identities are enforced", () => {
  const witness = playbackBoundaryFixture(2); witness.planHash = "a".repeat(64);
  assert.equal(evaluate(witness).status, "FAIL");
  assert.equal(evaluate(playbackBoundaryFixture(2), 0, 2).status, "FAIL");
  assert.throws(() => mediaBoundaryPlanHash([witness.media[0]!.window, witness.media[0]!.window]));
});

test("invalid measurement parameters cannot pass through NaN arithmetic", () => {
  for (const sampleRate of [0, NaN, Infinity, -1]) {
    assert.equal(evaluateMediaBoundaries(playbackBoundaryFixture(2), 0, sampleRate, quantum, tolerance, 1).status, "FAIL");
  }
  assert.equal(evaluateMediaBoundaries(playbackBoundaryFixture(2), 0, rate, NaN, tolerance, 1).status, "FAIL");
});

test("injected reducer is self-contained, ignores pre-arm events and retains first stop", () => {
  const window = playbackBoundaryFixture(2).media[0]!.window;
  const tracker = runInNewContext(`(${createMediaBoundaryTracker.toString()})(windows)`, {windows: [window]}) as ReturnType<typeof createMediaBoundaryTracker>;
  tracker.observe("voice", "playing", 0, 2); assert.equal(tracker.snapshot()[0]!.playingEvents, 0);
  tracker.arm(); tracker.observe("unknown", "playing", 0, 2); tracker.observe("voice", "playing", 0, 2);
  tracker.observe("voice", "pause", rate, 2); tracker.observe("voice", "playing", rate + 128, 2);
  tracker.observe("voice", "ended", 2 * rate, 2);
  const row = tracker.snapshot()[0]!;
  assert.equal(row.stopFrame, rate); assert.equal(row.unexpectedStops, 1); assert.equal(row.stopEvents, 2);
});

function controlledBrowser(datasetStart = "0", extraMedia = false) {
  class Target {
    listeners = new Map<string, Set<(event: any) => void>>();
    addEventListener(name: string, listener: (event: any) => void) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name)!.add(listener);
    }
    removeEventListener(name: string, listener: (event: any) => void) {this.listeners.get(name)?.delete(listener);}
    emit(name: string, event: unknown = {}) {this.listeners.get(name)?.forEach((listener) => listener(event));}
  }
  const media = Object.assign(new Target(), {id: "voice", dataset: {start: datasetStart, duration: "2", sourceOffset: "0"},
    loop: false, paused: false, muted: false, volume: 1, duration: 2, currentTime: 0});
  const extra = Object.assign(new Target(), {...media, id: "unexpected", listeners: new Map()});
  const browserWindow = Object.assign(new Target(), {postMessage() {}, __courseforgePlaybackCapture: undefined as any});
  let clock: AudioContextFake;
  class AudioContextFake {
    sampleRate = rate; currentTime = 0.05; state = "running"; destination = {};
    audioWorklet = {async addModule() {}};
    constructor() {clock = this;}
    async suspend() {} async resume() {} async close() {this.state = "closed";}
    createMediaElementSource() {return {connect() {}, disconnect() {}};}
  }
  class WorkletFake {port = {postMessage() {}, onmessage: undefined}; connect() {} disconnect() {}}
  const install = () => runInNewContext(playbackCaptureInstallExpression("http://127.0.0.1/conformance-audio-worklet.js", 2,
    [playbackBoundaryFixture(2).media[0]!.window]), {window: browserWindow, document: {querySelectorAll: () => extraMedia ? [media, extra] : [media]},
      AudioContext: AudioContextFake, AudioWorkletNode: WorkletFake});
  const message = (type: string, payload: object) => browserWindow.emit("message", {source: browserWindow,
    data: {protocolVersion: COMPOSITION_PREVIEW_PROTOCOL_VERSION, type: `courseforge-composition-${type}`, ...payload}});
  return {install, media, extra, browserWindow, message, setClock: (seconds: number) => {clock!.currentTime = seconds;}};
}

test("installed runtime emits window-bound native events and removes listeners on stop", async () => {
  const browser = controlledBrowser(); await browser.install();
  const capture = browser.browserWindow.__courseforgePlaybackCapture;
  await capture.start(); browser.message("playback", {playing: true}); browser.media.emit("playing");
  browser.setClock(2.05); browser.message("time", {seconds: 2}); browser.media.emit("pause");
  browser.message("playback", {playing: false});
  const result = capture.pull(); assert.equal(result.done, true);
  assert.equal(evaluate(result.boundaries, result.originFrame).status, "PASS");
  await capture.stop(); assert.equal(browser.media.listeners.get("playing")!.size, 0);
});

test("installed runtime rejects non-finite DOM timing before opening audio graph", async () => {
  for (const start of ["NaN", "Infinity", "1"]) await assert.rejects(controlledBrowser(start).install(), /BOUNDARY_PLAN_MISMATCH/);
});

test("unplanned audible playback aborts instead of escaping per-clip coverage", async () => {
  const browser = controlledBrowser("0", true); await browser.install();
  const capture = browser.browserWindow.__courseforgePlaybackCapture; await capture.start();
  browser.extra.emit("playing"); assert.equal(capture.pull().error, "AUDIO_PLAYBACK_UNEXPECTED_MEDIA");
  await capture.stop();
});
