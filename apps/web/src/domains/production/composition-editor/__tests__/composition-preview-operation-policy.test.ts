import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCompositionPreviewOperation,
  classifyCompositionPreviewOperations,
  requiresCompositionPreviewReload,
} from "../composition-preview-operation-policy";

test("classifies visual, timeline and structural operations explicitly", () => {
  assert.equal(classifyCompositionPreviewOperation({ type: "clip.layout" }), "LIVE_DOM");
  assert.equal(classifyCompositionPreviewOperation({ type: "clip.trim" }), "LIVE_TIMELINE");
  assert.equal(classifyCompositionPreviewOperation({ type: "animation.insert-path-point" }), "LIVE_TIMELINE");
  assert.equal(classifyCompositionPreviewOperation({ type: "animation.remove-path-point" }), "LIVE_TIMELINE");
  assert.equal(classifyCompositionPreviewOperation({ type: "clip.playback-rate" }), "LIVE_TIMELINE");
  assert.equal(classifyCompositionPreviewOperation({ type: "clip.freeze-tail" }), "LIVE_TIMELINE");
  assert.equal(classifyCompositionPreviewOperation({ type: "clip.color-grading" }), "LIVE_DOM");
  assert.equal(classifyCompositionPreviewOperation({ type: "clip.audio-fades" }), "LIVE_TIMELINE");
  assert.equal(classifyCompositionPreviewOperation({ type: "clip.add" }), "LIVE_TIMELINE");
  assert.equal(classifyCompositionPreviewOperation({ type: "clip.replace-source" }), "LIVE_TIMELINE");
  assert.equal(classifyCompositionPreviewOperation({ type: "document.reconcile" }), "FULL_RELOAD");
  assert.equal(classifyCompositionPreviewOperation({ type: "track.update" }), "LIVE_TIMELINE");
  assert.equal(classifyCompositionPreviewOperation({ type: "future.unknown" }), "FULL_RELOAD");
});

test("requires canonical compilation only for unsupported operations", () => {
  assert.equal(requiresCompositionPreviewReload("LIVE_DOM"), false);
  assert.equal(requiresCompositionPreviewReload("LIVE_TIMELINE"), false);
  assert.equal(requiresCompositionPreviewReload("FULL_RELOAD"), true);
});

test("selects the safest strategy for a mixed patch batch", () => {
  assert.equal(classifyCompositionPreviewOperations([
    { type: "clip.layout" },
    { type: "clip.duration" },
  ]), "LIVE_TIMELINE");
  assert.equal(classifyCompositionPreviewOperations([
    { type: "clip.layout" },
    { type: "document.restore" },
  ]), "FULL_RELOAD");
  assert.equal(classifyCompositionPreviewOperations([]), "FULL_RELOAD");
});
