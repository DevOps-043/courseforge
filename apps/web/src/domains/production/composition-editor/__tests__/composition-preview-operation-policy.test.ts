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
  assert.equal(classifyCompositionPreviewOperation({ type: "clip.add" }), "FULL_RELOAD");
  assert.equal(classifyCompositionPreviewOperation({ type: "document.reconcile" }), "FULL_RELOAD");
  assert.equal(classifyCompositionPreviewOperation({ type: "track.update" }), "FULL_RELOAD");
  assert.equal(classifyCompositionPreviewOperation({ type: "future.unknown" }), "FULL_RELOAD");
});

test("requires a compiled preview refresh for timeline and structural changes", () => {
  assert.equal(requiresCompositionPreviewReload("LIVE_DOM"), false);
  assert.equal(requiresCompositionPreviewReload("LIVE_TIMELINE"), true);
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
