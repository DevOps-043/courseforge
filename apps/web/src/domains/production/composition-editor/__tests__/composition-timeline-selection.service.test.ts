import assert from "node:assert/strict";
import test from "node:test";
import { resolveCompositionTimelineSelectionSync } from "../composition-timeline-selection.service";

const clips = [{ hfId: "hf-1", id: "clip-1" }];

test("does not emit a state update when the timeline selection is already empty", () => {
  assert.deepEqual(resolveCompositionTimelineSelectionSync({
    clips,
    selectedClipIds: new Set(),
    selectedGroupId: null,
    selectedHfId: null,
  }), {
    nextClipIds: null,
    shouldClearGroup: false,
  });
});

test("clears stale timeline and group selection when the preview has no selection", () => {
  assert.deepEqual(resolveCompositionTimelineSelectionSync({
    clips,
    selectedClipIds: new Set(["clip-1"]),
    selectedGroupId: "group-1",
    selectedHfId: null,
  }), {
    nextClipIds: [],
    shouldClearGroup: true,
  });
});

test("selects the matching timeline clip only when synchronization is required", () => {
  assert.deepEqual(resolveCompositionTimelineSelectionSync({
    clips,
    selectedClipIds: new Set(),
    selectedGroupId: null,
    selectedHfId: "hf-1",
  }), {
    nextClipIds: ["clip-1"],
    shouldClearGroup: false,
  });

  assert.deepEqual(resolveCompositionTimelineSelectionSync({
    clips,
    selectedClipIds: new Set(["clip-1"]),
    selectedGroupId: null,
    selectedHfId: "hf-1",
  }), {
    nextClipIds: null,
    shouldClearGroup: false,
  });
});

test("ignores a preview selection that is not present in the current document", () => {
  assert.deepEqual(resolveCompositionTimelineSelectionSync({
    clips,
    selectedClipIds: new Set(),
    selectedGroupId: null,
    selectedHfId: "hf-stale",
  }), {
    nextClipIds: null,
    shouldClearGroup: false,
  });
});
