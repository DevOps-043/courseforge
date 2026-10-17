import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import {
  buildCompositionSelectionAlignmentPlan,
  buildCompositionSelectionDistributionPlan,
  CompositionSelectionLayoutError,
} from "../composition-selection-layout.service";
import { applyCompositionEditorPatches } from "../editor-patch.service";

function createLayoutDocument() {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [0, 1, 2].map((index) => ({
      checksum: String(index + 1).repeat(64),
      durationSeconds: 4,
      fileSizeBytes: 4,
      hasAudio: false,
      mimeType: "video/mp4",
      productionAssetId: `10000000-0000-4000-8000-00000000000${index + 1}`,
      publicUrl: null,
      storageBucket: "production-assets",
      storagePath: `production-assets/layout-${index + 1}.mp4`,
      timelineRole: "BROLL" as const,
    })),
    plan: { accentColor: "#38BDF8", durationSeconds: 12, subtitle: "Prueba", title: "Layout" },
  });
  document.clips[0]!.layout = { ...document.clips[0]!.layout, height: 100, width: 100, x: 100, y: 120 };
  document.clips[1]!.layout = { ...document.clips[1]!.layout, height: 120, width: 200, x: 420, y: 360 };
  document.clips[2]!.layout = { ...document.clips[2]!.layout, height: 80, width: 80, x: 900, y: 640 };
  return document;
}

test("aligns visual objects to canvas and selection bounds deterministically", () => {
  const document = createLayoutDocument();
  const [first, second] = document.clips;
  assert.ok(first && second);
  const canvasPlan = buildCompositionSelectionAlignmentPlan({
    alignment: "HORIZONTAL_CENTER",
    clipIds: [first.id],
    document,
    target: "CANVAS",
  });
  const centered = applyCompositionEditorPatches(document, canvasPlan.operations);
  assert.equal(centered.clips[0]!.layout.x, (document.canvas.width - first.layout.width) / 2);

  const selectionPlan = buildCompositionSelectionAlignmentPlan({
    alignment: "BOTTOM",
    clipIds: [first.id, second.id],
    document,
    target: "SELECTION",
  });
  const aligned = applyCompositionEditorPatches(document, selectionPlan.operations);
  assert.equal(aligned.clips[0]!.layout.y + aligned.clips[0]!.layout.height, 480);
  assert.equal(aligned.clips[1]!.layout.y + aligned.clips[1]!.layout.height, 480);
});

test("distributes objects with equal edge spacing and fixed outer bounds", () => {
  const document = createLayoutDocument();
  const plan = buildCompositionSelectionDistributionPlan({
    axis: "HORIZONTAL",
    clipIds: document.clips.map((clip) => clip.id),
    document,
  });
  const distributed = applyCompositionEditorPatches(document, plan.operations);
  const [first, second, third] = distributed.clips;
  assert.ok(first && second && third);
  const firstGap = second.layout.x - (first.layout.x + first.layout.width);
  const secondGap = third.layout.x - (second.layout.x + second.layout.width);
  assert.equal(first.layout.x, 100);
  assert.equal(third.layout.x + third.layout.width, 980);
  assert.equal(firstGap, secondGap);
});

test("fails closed for insufficient objects, locked tracks and partial visual groups", () => {
  const document = createLayoutDocument();
  assert.throws(() => buildCompositionSelectionDistributionPlan({
    axis: "VERTICAL",
    clipIds: document.clips.slice(0, 2).map((clip) => clip.id),
    document,
  }), CompositionSelectionLayoutError);

  const locked = createLayoutDocument();
  const lockedClip = locked.clips[0]!;
  locked.tracks.find((track) => track.id === lockedClip.trackId)!.locked = true;
  assert.throws(() => buildCompositionSelectionAlignmentPlan({
    alignment: "LEFT",
    clipIds: [lockedClip.id],
    document: locked,
    target: "CANVAS",
  }), /Desbloquea la pista/);

  const grouped = createLayoutDocument();
  grouped.groups = [{ clipIds: [grouped.clips[0]!.id, grouped.clips[1]!.id], id: "visual-group", label: "Visuales", order: 0 }];
  assert.throws(() => buildCompositionSelectionAlignmentPlan({
    alignment: "RIGHT",
    clipIds: [grouped.clips[0]!.id],
    document: grouped,
    target: "CANVAS",
  }), /todos los elementos visuales del grupo/);
});
