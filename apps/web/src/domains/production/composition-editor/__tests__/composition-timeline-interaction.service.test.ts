import assert from "node:assert/strict";
import test from "node:test";
import {
  clampCompositionTimelineFrameStep,
  resolveCompositionTimelineKeyboardCommand,
  resolveCompositionTimelinePointerGesture,
} from "../composition-timeline-interaction.service";

test("Alt converts direct timeline gestures to slide and roll", () => {
  assert.equal(resolveCompositionTimelinePointerGesture("move", true), "slide");
  assert.equal(resolveCompositionTimelinePointerGesture("trim-start", true), "roll-left");
  assert.equal(resolveCompositionTimelinePointerGesture("trim-end", true), "roll-right");
  assert.equal(resolveCompositionTimelinePointerGesture("trim-start", false), "trim-start");
});

test("Alt plus arrows resolves the configured frame-accurate command", () => {
  assert.deepEqual(resolveCompositionTimelineKeyboardCommand({
    altKey: true,
    ctrlKey: false,
    frameStep: 12,
    hasSelection: true,
    key: "ArrowLeft",
    metaKey: false,
    mode: "SLIDE",
  }), { deltaFrames: -12, type: "SLIDE" });
  assert.deepEqual(resolveCompositionTimelineKeyboardCommand({
    altKey: true,
    ctrlKey: false,
    frameStep: 3,
    hasSelection: true,
    key: "ArrowRight",
    metaKey: false,
    mode: "ROLL_RIGHT",
  }), { deltaFrames: 3, edge: "RIGHT", type: "ROLL" });
});

test("keyboard editing ignores unsafe chords and clamps the configured step", () => {
  assert.equal(resolveCompositionTimelineKeyboardCommand({
    altKey: true,
    ctrlKey: true,
    frameStep: 5,
    hasSelection: true,
    key: "ArrowRight",
    metaKey: false,
    mode: "ROLL_LEFT",
  }), null);
  assert.equal(resolveCompositionTimelineKeyboardCommand({
    altKey: true,
    ctrlKey: false,
    frameStep: 5,
    hasSelection: false,
    key: "ArrowRight",
    metaKey: false,
    mode: "ROLL_LEFT",
  }), null);
  assert.equal(clampCompositionTimelineFrameStep(Number.NaN), 1);
  assert.equal(clampCompositionTimelineFrameStep(0), 1);
  assert.equal(clampCompositionTimelineFrameStep(450), 300);
  assert.equal(clampCompositionTimelineFrameStep(2.6), 3);
});
