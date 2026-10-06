import assert from "node:assert/strict";
import test from "node:test";
import {prepareControlledSdkText} from "./controlled-sdk-text.mjs";

function fixture() {
  const points = [{frameIndex: 0, timeSeconds: 0}, {frameIndex: 25, timeSeconds: 1}];
  const calls = []; let changed = false, failedRepeat = false, closed = false;
  const collector = {close() {closed = true;}, async capture(point) {calls.push(["forward", point.frameIndex]);},
    async verifyRepeat(point) {if (failedRepeat) throw new Error("private failure"); calls.push(["reverse", point.frameIndex]);},
    async finish(text) {return {scope: "synthetic test only", checkpointCount: text.checkpoints.length};}};
  const input = {client: {}, document: {}, fonts: [], origin: "http://127.0.0.1:1234", verifyFiles: async () => {},
    contract: {checkpoints: points, textParity: {policy: "synthetic"}}, api: {
      TEXT_PARITY_REPEATABILITY: "EXACT_TEXT_GEOMETRY_FORWARD_REVERSE_V1",
      async startControlledFontCapture() {calls.push(["subscribe"]); return collector;},
      async verifyConformanceFontLoading(_client, _fonts, load) {assert.equal(load, true); calls.push(["load"]);},
      async captureTextParityCheckpoint(_client, _document, timeSeconds) {
        return {frameIndex: timeSeconds * 25, timeSeconds, width: changed ? 101 : 100};
      },
    }};
  return {input, calls, collector, closed: () => closed, changeGeometry() {changed = true;}, failRepeat() {failedRepeat = true;}};
}

test("SDK text observer requires actual forward/reverse capture order and verifies glyphs in both sweeps", async () => {
  const state = fixture(), capture = await prepareControlledSdkText(state.input);
  assert.deepEqual(state.calls, [["subscribe"]]);
  await assert.rejects(capture.observeCapture(0, 0), /SEQUENCE_INVALID/);
  await capture.loadDeclaredFonts();
  await assert.rejects(capture.loadDeclaredFonts(), /SEQUENCE_INVALID/);
  await assert.rejects(capture.finish(), /SEQUENCE_INCOMPLETE/);
  for (const [frame, time] of [[0, 0], [25, 1], [25, 1], [0, 0]]) await capture.observeCapture(frame, time);
  const evidence = await capture.finish();
  assert.equal(evidence.textEvidence.checkpoints.length, 2);
  assert.equal(evidence.textEvidence.repeatability, "EXACT_TEXT_GEOMETRY_FORWARD_REVERSE_V1");
  assert.deepEqual(state.calls.slice(1), [["load"], ["forward", 0], ["forward", 25], ["reverse", 25], ["reverse", 0]]);
  assert.equal(state.closed(), true);
  await assert.rejects(capture.observeCapture(0, 0), /SEQUENCE_INVALID/);
});

test("wrong frame/time, changed reverse geometry and failed reverse glyph verification close without emitting evidence", async () => {
  for (const kind of ["frame", "time", "geometry", "glyph"]) {
    const state = fixture(), capture = await prepareControlledSdkText(state.input);
    await capture.loadDeclaredFonts();
    if (kind === "frame" || kind === "time") await assert.rejects(capture.observeCapture(kind === "frame" ? 25 : 0,
      kind === "time" ? 1 : 0), /SEQUENCE_INVALID/);
    else {
      await capture.observeCapture(0, 0); await capture.observeCapture(25, 1);
      if (kind === "geometry") state.changeGeometry(); else state.failRepeat();
      await assert.rejects(capture.observeCapture(25, 1), error => error.message === "CONTROLLED_RENDER_TEXT_CAPTURE_FAILED");
    }
    assert.equal(state.closed(), true); await assert.rejects(capture.finish(), /SEQUENCE_INCOMPLETE/);
  }
});

test("declared font load failure closes the observer before any frame observation", async () => {
  const state = fixture();
  state.input.api.verifyConformanceFontLoading = async () => {throw new Error("private/font/url");};
  const capture = await prepareControlledSdkText(state.input);
  await assert.rejects(capture.loadDeclaredFonts(), error => error.message === "CONTROLLED_RENDER_TEXT_FONT_LOADING_FAILED");
  assert.equal(state.closed(), true);
  await assert.rejects(capture.observeCapture(0, 0), /SEQUENCE_INVALID/);
});
test("pre-aborted adapters never subscribe or load fonts", async () => {
  const state = fixture(), abort = new AbortController(); abort.abort("private reason");
  await assert.rejects(prepareControlledSdkText({...state.input, signal: abort.signal}), /^Error: CONTROLLED_RENDER_TEXT_CANCELLED$/);
  assert.deepEqual(state.calls, []);
});
test("late abort at acquisition, loading, geometry or finish cannot emit evidence and closes ownership", async () => {
  for (const stage of ["acquire", "load", "geometry", "finish"]) {
    const state = fixture(), abort = new AbortController();
    if (stage === "acquire") {
      const start = state.input.api.startControlledFontCapture;
      state.input.api.startControlledFontCapture = async () => {const result = await start(); abort.abort("private"); return result;};
      await assert.rejects(prepareControlledSdkText({...state.input, signal: abort.signal}), /TEXT_CANCELLED/);
    } else {
      const capture = await prepareControlledSdkText({...state.input, signal: abort.signal});
      if (stage === "load") {
        state.input.api.verifyConformanceFontLoading = async () => {abort.abort("private");};
        await assert.rejects(capture.loadDeclaredFonts(), /TEXT_CANCELLED/);
      } else {
        await capture.loadDeclaredFonts();
        if (stage === "geometry") {
          const observe = state.input.api.captureTextParityCheckpoint;
          state.input.api.captureTextParityCheckpoint = async (...args) => {const result = await observe(...args); abort.abort("private"); return result;};
          await assert.rejects(capture.observeCapture(0, 0), /TEXT_CANCELLED/);
          assert.equal(state.calls.some(call => call[0] === "forward"), false);
        } else {
          for (const [frame, time] of [[0, 0], [25, 1], [25, 1], [0, 0]]) await capture.observeCapture(frame, time);
          state.collector.finish = async () => {abort.abort("private"); return {};};
          await assert.rejects(capture.finish(), /TEXT_CANCELLED/);
        }
      }
    }
    assert.equal(state.closed(), true, stage);
  }
});
