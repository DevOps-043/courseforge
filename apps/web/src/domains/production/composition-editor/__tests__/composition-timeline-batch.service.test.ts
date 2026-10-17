import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import {
  buildCompositionDeleteSelectionPlan,
  buildCompositionDuplicateSelectionPlan,
  CompositionTimelineBatchError,
} from "../composition-timeline-batch.service";
import { applyCompositionEditorPatches, ensureCanvasDurationForClipPatches } from "../editor-patch.service";
import { compositionEditorPatchRequestSchema } from "../editor-patch.types";

function createBatchDocument() {
  return createInitialCompositionDocument({
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
      storagePath: `production-assets/batch-${index + 1}.mp4`,
      timelineRole: "BROLL" as const,
    })),
    plan: { accentColor: "#38BDF8", durationSeconds: 12, subtitle: "Prueba", title: "Batch" },
  });
}

test("duplicates a selection atomically with motion and group topology", () => {
  let document = createBatchDocument();
  const [first, second] = document.clips;
  assert.ok(first && second);
  document = applyCompositionEditorPatches(document, [
    { animationId: "animation-source", clipId: first.id, durationSeconds: 0.5, offsetSeconds: 0, presetId: "FADE_IN", type: "animation.add-preset" },
    { clipIds: [first.id, second.id], groupId: "group-source", label: "Bloque", type: "group.create" },
  ]);
  let sequence = 0;
  const plan = buildCompositionDuplicateSelectionPlan({
    clipIds: [first.id, second.id],
    createId: (kind) => `${kind}-copy-${++sequence}`,
    document,
  });
  const operations = ensureCanvasDurationForClipPatches(document, plan.operations);
  const duplicated = applyCompositionEditorPatches(document, operations);

  assert.equal(plan.duplicateClipIds.length, 2);
  assert.equal(duplicated.clips.length, 5);
  assert.equal(duplicated.motion.animations.length, 2);
  assert.equal(duplicated.motion.animations[1]?.target.clipId, plan.duplicateClipIds[0]);
  assert.deepEqual(duplicated.groups?.at(-1)?.clipIds, plan.duplicateClipIds);
  const duplicateStarts = plan.duplicateClipIds.map((clipId) => duplicated.clips.find((clip) => clip.id === clipId)!.startSeconds);
  assert.deepEqual(duplicateStarts, [8, 12]);
  assert.equal(duplicated.clips.find((clip) => clip.id === document.clips[2]!.id)?.startSeconds, 16);
  assert.equal(duplicated.canvas.durationSeconds, 20);
});

test("pastes a copied selection at the playhead and opens a safe gap", () => {
  const document = createBatchDocument();
  const [first, , third] = document.clips;
  assert.ok(first && third);
  let sequence = 0;
  const plan = buildCompositionDuplicateSelectionPlan({
    clipIds: [first.id],
    createId: (kind) => `${kind}-paste-${++sequence}`,
    destinationStartSeconds: 8,
    document,
  });
  const pasted = applyCompositionEditorPatches(
    document,
    ensureCanvasDurationForClipPatches(document, plan.operations),
  );

  assert.equal(pasted.clips.find((clip) => clip.id === plan.duplicateClipIds[0])?.startSeconds, 8);
  assert.equal(pasted.clips.find((clip) => clip.id === third.id)?.startSeconds, 12);
  assert.equal(pasted.canvas.durationSeconds, 16);
});

test("fails closed when the paste playhead crosses an existing clip", () => {
  const document = createBatchDocument();
  assert.throws(() => buildCompositionDuplicateSelectionPlan({
    clipIds: [document.clips[0]!.id],
    destinationStartSeconds: 2,
    document,
  }), /atraviesa ese punto/);
});

test("ripple delete closes only safe gaps and keeps following clips frame-aligned", () => {
  const document = createBatchDocument();
  const [first, second, third] = document.clips;
  assert.ok(first && second && third);
  const plan = buildCompositionDeleteSelectionPlan({
    clipIds: [second.id],
    document,
    ripple: true,
  });
  const edited = applyCompositionEditorPatches(document, plan.operations);

  assert.equal(edited.clips.some((clip) => clip.id === second.id), false);
  assert.equal(edited.clips.find((clip) => clip.id === first.id)?.startSeconds, 0);
  assert.equal(edited.clips.find((clip) => clip.id === third.id)?.startSeconds, 4);
});

test("fails closed for overlapping survivors and locked tracks", () => {
  const overlapping = createBatchDocument();
  const [first, second] = overlapping.clips;
  assert.ok(first && second);
  second.startSeconds = 2;
  assert.throws(() => buildCompositionDeleteSelectionPlan({
    clipIds: [first.id],
    document: overlapping,
    ripple: true,
  }), CompositionTimelineBatchError);

  const locked = createBatchDocument();
  const lockedClip = locked.clips[0]!;
  locked.tracks.find((track) => track.id === lockedClip.trackId)!.locked = true;
  assert.throws(() => buildCompositionDuplicateSelectionPlan({
    clipIds: [lockedClip.id],
    document: locked,
  }), /Desbloquea la pista/);
});

test("the server operation rejects incomplete animation identity maps", () => {
  let document = createBatchDocument();
  const first = document.clips[0]!;
  document = applyCompositionEditorPatches(document, [{
    animationId: "animation-required",
    clipId: first.id,
    durationSeconds: 0.5,
    offsetSeconds: 0,
    presetId: "FADE_IN",
    type: "animation.add-preset",
  }]);

  assert.throws(() => applyCompositionEditorPatches(document, [{
    animationIds: [],
    clipId: first.id,
    newClipId: "clip-invalid-copy",
    newHfId: "hf-invalid-copy",
    startSeconds: 4,
    type: "clip.duplicate",
  }]), /exactamente una identidad/);

  const validRequest = compositionEditorPatchRequestSchema.safeParse({
    operations: [{
      animationIds: [{ newAnimationId: "animation-copy", sourceAnimationId: "animation-required" }],
      clipId: first.id,
      newClipId: "clip-valid-copy",
      newHfId: "hf-valid-copy",
      startSeconds: 4,
      type: "clip.duplicate",
    }],
    source: "USER",
    summary: "Duplicó un clip con su animación.",
  });
  assert.equal(validRequest.success, true);
  assert.throws(() => applyCompositionEditorPatches(document, validRequest.data!.operations, "AGENT"), /acción explícita/);
});
