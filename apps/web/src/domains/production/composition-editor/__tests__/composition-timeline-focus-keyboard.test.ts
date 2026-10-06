import assert from "node:assert/strict";
import test from "node:test";
import { resolveCompositionTimelineFocusKey, resolveCompositionTimelineFocusIndex, resolveCompositionTimelineCursorKey } from "../composition-timeline-focus-keyboard";
import { resolveCompositionTimelineKeyboardCommand } from "../composition-timeline-interaction.service";

const base = { key: "ArrowLeft", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false };
test("plain clip arrows move, focus navigation never requests mutation", () => {
  for (const [key, action] of [["ArrowLeft", "MOVE_LEFT"], ["ArrowRight", "MOVE_RIGHT"], ["ArrowUp", "PREVIOUS"], ["ArrowDown", "NEXT"], ["Home", "FIRST"], ["End", "LAST"], ["Escape", "CLEAR"]]) {
    assert.equal(resolveCompositionTimelineFocusKey({ ...base, key }), action);
  }
});
test("Alt arrows reach the existing slide/roll dispatcher instead of local move", () => {
  const chord = { ...base, altKey: true };
  assert.equal(resolveCompositionTimelineFocusKey(chord), null);
  assert.deepEqual(resolveCompositionTimelineKeyboardCommand({ ...chord, hasSelection: true, frameStep: 10, mode: "SLIDE" }), { deltaFrames: -10, type: "SLIDE" });
});
test("IME and native modified arrows do not edit; Ctrl/Cmd Space toggles selection", () => {
  assert.equal(resolveCompositionTimelineFocusKey({ ...base, isComposing: true }), null);
  assert.equal(resolveCompositionTimelineFocusKey({ ...base, ctrlKey: true }), null);
  assert.equal(resolveCompositionTimelineFocusKey({ ...base, metaKey: true }), null);
  assert.equal(resolveCompositionTimelineFocusKey({ ...base, shiftKey: true }), "MOVE_LEFT");
  assert.equal(resolveCompositionTimelineFocusKey({ ...base, key: " ", ctrlKey: true }), "TOGGLE");
  assert.equal(resolveCompositionTimelineFocusKey({ ...base, key: " ", metaKey: true }), "TOGGLE");
});
test("focus stays within eligible clips and handles empty/removed nodes", () => {
  assert.equal(resolveCompositionTimelineFocusIndex(3, 0, "PREVIOUS"), 0);
  assert.equal(resolveCompositionTimelineFocusIndex(3, 2, "NEXT"), 2);
  assert.equal(resolveCompositionTimelineFocusIndex(3, 1, "FIRST"), 0);
  assert.equal(resolveCompositionTimelineFocusIndex(3, 1, "LAST"), 2);
  assert.equal(resolveCompositionTimelineFocusIndex(3, 1, "NEXT"), 2);
  assert.equal(resolveCompositionTimelineFocusIndex(0, 0, "FIRST"), null);
  assert.equal(resolveCompositionTimelineFocusIndex(3, -1, "NEXT"), null);
});

test("cursor keyboard supports endpoints/frame steps without clip editing chords", () => {
  assert.equal(resolveCompositionTimelineCursorKey(base), "BACKWARD");
  assert.equal(resolveCompositionTimelineCursorKey({ ...base, key: "ArrowRight" }), "FORWARD");
  assert.equal(resolveCompositionTimelineCursorKey({ ...base, key: "Home" }), "START");
  assert.equal(resolveCompositionTimelineCursorKey({ ...base, key: "End" }), "END");
  for (const modifier of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { isComposing: true }]) {
    assert.equal(resolveCompositionTimelineCursorKey({ ...base, ...modifier }), null);
  }
  assert.equal(resolveCompositionTimelineCursorKey({ ...base, key: "Tab" }), null);
});
