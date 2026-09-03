import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import type { CompositionEditorPatchOperation } from "../editor-patch.types";
import { buildCompositionPreviewVisualPatch } from "../composition-preview-visual-patch";

function createBrollDocument() {
  return createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{
      checksum: "7".repeat(64),
      durationSeconds: 8,
      fileSizeBytes: 4,
      hasAudio: true,
      mimeType: "video/mp4",
      productionAssetId: "00000000-0000-4000-8000-000000000041",
      publicUrl: null,
      storageBucket: "production-assets",
      storagePath: "production-assets/broll.mp4",
      timelineRole: "BROLL",
    }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Patch visual" },
  });
}

test("builds resolved geometry and crop state from the optimistic document", () => {
  const document = createBrollDocument();
  const clip = document.clips.find((candidate) => candidate.kind === "VIDEO")!;
  const operations: CompositionEditorPatchOperation[] = [{
    clipId: clip.id,
    layout: { height: 540, width: 960, x: 120, y: 80 },
    type: "clip.layout",
  }];
  const optimisticDocument = applyCompositionEditorPatches(document, operations, "USER");
  const patch = buildCompositionPreviewVisualPatch({ document: optimisticDocument, operations });

  assert.deepEqual(patch, { changes: [{
    cropInsets: { bottom: 0, left: 0, right: 0, top: 0 },
    hfId: clip.hfId,
    layout: { height: 540, rotation: 0, width: 960, x: 120, y: 80, zIndex: clip.layout.zIndex },
  }] });
});

test("resolves media fit, visibility and effective B-roll volume", () => {
  const document = createBrollDocument();
  const clip = document.clips.find((candidate) => candidate.kind === "VIDEO")!;
  const operations: CompositionEditorPatchOperation[] = [
    { clipId: clip.id, mediaFit: "CONTAIN", type: "clip.media-fit" },
    { clipId: clip.id, hidden: true, type: "clip.visibility" },
    { clipId: clip.id, type: "clip.volume", volume: 0.4 },
  ];
  const optimisticDocument = applyCompositionEditorPatches(document, operations, "USER");
  assert.deepEqual(buildCompositionPreviewVisualPatch({ document: optimisticDocument, operations }), {
    changes: [{ aspectAnchor: "CENTER", hfId: clip.hfId, hidden: true, mediaFit: "CONTAIN", volume: 0.4 }],
  });
});

test("fails closed for opacity and non-visual batches", () => {
  const document = createBrollDocument();
  const clip = document.clips.find((candidate) => candidate.kind === "VIDEO")!;
  const opacityOperation: CompositionEditorPatchOperation = { clipId: clip.id, layout: { opacity: 0.5 }, type: "clip.layout" };
  const optimisticDocument = applyCompositionEditorPatches(document, [opacityOperation], "USER");
  assert.equal(buildCompositionPreviewVisualPatch({ document: optimisticDocument, operations: [opacityOperation] }), null);
  assert.equal(buildCompositionPreviewVisualPatch({
    document,
    operations: [{ clipId: clip.id, startSeconds: 1, type: "clip.move" }],
  }), null);
});

test("sends the complete motion state for live animation edits", () => {
  const document = createBrollDocument();
  const clip = document.clips[0]!;
  const operations: CompositionEditorPatchOperation[] = [{
    animationId: "motion-live-fade", clipId: clip.id, durationSeconds: 0.8,
    presetId: "FADE_IN", type: "animation.add-preset",
  }];
  const optimistic = applyCompositionEditorPatches(document, operations, "USER");
  const patch = buildCompositionPreviewVisualPatch({ document: optimistic, operations });
  assert.equal(patch?.changes.length, 0);
  assert.equal(patch?.motion?.[0]?.id, "motion-live-fade");
  assert.equal(patch?.motion?.[0]?.targetId, `${clip.id}-motion`);
});
