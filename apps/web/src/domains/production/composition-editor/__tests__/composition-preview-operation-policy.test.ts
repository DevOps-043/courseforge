import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCompositionPreviewOperation,
  classifyCompositionPreviewOperations,
} from "../composition-preview-operation-policy";

test("classifies visual, timeline and structural operations explicitly", () => {
  assert.equal(classifyCompositionPreviewOperation({ type: "clip.layout" }), "LIVE_DOM");
  assert.equal(classifyCompositionPreviewOperation({ type: "clip.trim" }), "LIVE_TIMELINE");
  assert.equal(classifyCompositionPreviewOperation({ type: "clip.add" }), "FULL_RELOAD");
  assert.equal(classifyCompositionPreviewOperation({ type: "track.update" }), "FULL_RELOAD");
  assert.equal(classifyCompositionPreviewOperation({ type: "future.unknown" }), "FULL_RELOAD");
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
