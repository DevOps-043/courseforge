import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import {
  buildCompositionAssetPlacementEditPlan,
  buildCompositionRollEditPlan,
  buildCompositionSlideEditPlan,
  CompositionTimelineEditError,
} from "../composition-timeline-edit.service";
import { applyCompositionEditorPatches, ensureCanvasDurationForClipPatches } from "../editor-patch.service";
import { createTransition, createTransitionDocument } from "./composition-transition-test-fixtures";

function createEditDocument() {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [0, 1, 2].map((index) => ({
      checksum: String(index + 4).repeat(64),
      durationSeconds: 8,
      fileSizeBytes: 8,
      hasAudio: false,
      mimeType: "video/mp4",
      productionAssetId: `20000000-0000-4000-8000-00000000000${index + 1}`,
      publicUrl: null,
      storageBucket: "production-assets",
      storagePath: `production-assets/edit-${index + 1}.mp4`,
      timelineRole: "BROLL" as const,
    })),
    plan: { accentColor: "#38BDF8", durationSeconds: 12, subtitle: "Prueba", title: "Edición" },
  });
  document.clips.forEach((clip, index) => {
    clip.startSeconds = index * 4;
    clip.durationSeconds = 4;
    clip.sourceDurationSeconds = 8;
    clip.sourceOffsetSeconds = index === 0 ? 0 : 1;
  });
  document.canvas.durationSeconds = 12;
  return document;
}

function createInsertedClip(document: ReturnType<typeof createEditDocument>, startSeconds: number, durationSeconds: number) {
  const source = document.clips[0]!;
  return {
    ...structuredClone(source),
    durationSeconds,
    hfId: "inserted-hf",
    id: "inserted-clip",
    label: "Insertado",
    source: { ...source.source, productionAssetId: "20000000-0000-4000-8000-000000000099" },
    sourceDurationSeconds: durationSeconds,
    sourceOffsetSeconds: 0,
    startSeconds,
  };
}

test("INSERT opens a deterministic gap and extends the canvas atomically", () => {
  const document = createEditDocument();
  const clip = createInsertedClip(document, 4, 2);
  const plan = buildCompositionAssetPlacementEditPlan({ clip, document, mode: "INSERT" });
  const edited = applyCompositionEditorPatches(
    document,
    ensureCanvasDurationForClipPatches(document, plan.operations),
  );

  assert.equal(edited.clips.find((candidate) => candidate.id === clip.id)?.startSeconds, 4);
  assert.equal(edited.clips.find((candidate) => candidate.id === document.clips[1]!.id)?.startSeconds, 6);
  assert.equal(edited.clips.find((candidate) => candidate.id === document.clips[2]!.id)?.startSeconds, 10);
  assert.equal(edited.canvas.durationSeconds, 14);
});

test("OVERWRITE preserves both media handles around a middle replacement", () => {
  const document = createEditDocument();
  document.clips = [document.clips[0]!];
  document.clips[0]!.durationSeconds = 8;
  const clip = createInsertedClip(document, 2, 2);
  const plan = buildCompositionAssetPlacementEditPlan({
    clip,
    createDerivedId: (_sourceId, kind) => kind === "clip" ? "overwrite-right" : "overwrite-right-hf",
    document,
    mode: "OVERWRITE",
  });
  const edited = applyCompositionEditorPatches(document, plan.operations);
  const left = edited.clips.find((candidate) => candidate.id === document.clips[0]!.id)!;
  const right = edited.clips.find((candidate) => candidate.id === "overwrite-right")!;

  assert.equal(left.durationSeconds, 2);
  assert.equal(right.startSeconds, 4);
  assert.equal(right.durationSeconds, 4);
  assert.equal(right.sourceOffsetSeconds, 4);
  assert.equal(edited.clips.find((candidate) => candidate.id === clip.id)?.durationSeconds, 2);
});

test("OVERWRITE can atomically replace the only generated clip", () => {
  const document = createEditDocument();
  document.clips = [document.clips[0]!];
  const clip = createInsertedClip(document, 0, 4);
  const plan = buildCompositionAssetPlacementEditPlan({ clip, document, mode: "OVERWRITE" });
  const edited = applyCompositionEditorPatches(document, plan.operations);

  assert.deepEqual(edited.clips.map((candidate) => candidate.id), [clip.id]);
});

test("OVERWRITE removes only transitions whose edited cut becomes invalid", () => {
  const document = createTransitionDocument();
  document.transitions = { items: [createTransition(document)], schemaVersion: 1 };
  const clip = createInsertedClip(document, 3, 2);
  const plan = buildCompositionAssetPlacementEditPlan({ clip, document, mode: "OVERWRITE" });
  const edited = applyCompositionEditorPatches(document, plan.operations);

  assert.deepEqual(edited.transitions?.items, []);
  assert.equal(edited.clips.find((candidate) => candidate.id === document.clips[0]!.id)!.durationSeconds, 3);
  assert.equal(edited.clips.find((candidate) => candidate.id === document.clips[1]!.id)!.startSeconds, 5);
});

test("OVERWRITE preserves an external transition when a middle split keeps its outer edge", () => {
  const document = createTransitionDocument();
  document.transitions = { items: [createTransition(document)], schemaVersion: 1 };
  const clip = createInsertedClip(document, 1, 1);
  const plan = buildCompositionAssetPlacementEditPlan({
    clip,
    createDerivedId: (_sourceId, kind) => kind === "clip" ? "transition-right" : "transition-right-hf",
    document,
    mode: "OVERWRITE",
  });
  const edited = applyCompositionEditorPatches(document, plan.operations);

  assert.equal(edited.transitions?.items.length, 1);
  assert.equal(edited.transitions?.items[0]?.fromClipId, "transition-right");
  assert.equal(edited.transitions?.items[0]?.toClipId, document.clips[1]!.id);
});

test("OVERWRITE atomically replaces a fully covered group across tracks", () => {
  let document = createEditDocument();
  const groupedTrack = {
    ...structuredClone(document.tracks[0]!),
    id: "overwrite-group-track",
    label: "Grupo overwrite",
    order: document.tracks[0]!.order + 1,
  };
  const groupedCompanion = {
    ...structuredClone(document.clips[0]!),
    hfId: "overwrite-group-companion-hf",
    id: "overwrite-group-companion",
    trackId: groupedTrack.id,
  };
  document.tracks.push(groupedTrack);
  document.clips.push(groupedCompanion);
  document = applyCompositionEditorPatches(document, [{
    clipIds: [document.clips[0]!.id, groupedCompanion.id],
    groupId: "overwrite-group",
    type: "group.create",
  }]);
  const clip = createInsertedClip(document, 0, 4);
  const plan = buildCompositionAssetPlacementEditPlan({ clip, document, mode: "OVERWRITE" });
  const edited = applyCompositionEditorPatches(document, plan.operations);

  assert.deepEqual(plan.coordinatedRemovedClipIds, [groupedCompanion.id]);
  assert.equal(edited.clips.some((candidate) => candidate.id === groupedCompanion.id), false);
  assert.equal(edited.clips.some((candidate) => candidate.id === document.clips[0]!.id), false);
  assert.equal(edited.clips.some((candidate) => candidate.id === clip.id), true);
  assert.deepEqual(edited.groups, []);
});

test("OVERWRITE replaces a complete avatar-voice scene but rejects a partial scene", () => {
  const document = createEditDocument();
  document.tracks[0]!.semanticRole = "AVATAR";
  document.clips[0]!.sceneId = "overwrite-scene";
  const voiceTrack = {
    ...structuredClone(document.tracks[0]!),
    id: "overwrite-voice-track",
    kind: "AUDIO" as const,
    label: "Voz overwrite",
    order: document.tracks[0]!.order + 1,
    semanticRole: "VOICE" as const,
  };
  const voiceClip = {
    ...structuredClone(document.clips[0]!),
    hfId: "overwrite-voice-hf",
    id: "overwrite-voice",
    kind: "AUDIO" as const,
    trackId: voiceTrack.id,
  };
  document.tracks.push(voiceTrack);
  document.clips.push(voiceClip);

  const partial = createInsertedClip(document, 1, 2);
  delete partial.sceneId;
  assert.throws(() => buildCompositionAssetPlacementEditPlan({
    clip: partial,
    document,
    mode: "OVERWRITE",
  }), /cubrir completamente el par avatar-voz/);

  const replacement = createInsertedClip(document, 0, 4);
  delete replacement.sceneId;
  const plan = buildCompositionAssetPlacementEditPlan({ clip: replacement, document, mode: "OVERWRITE" });
  const edited = applyCompositionEditorPatches(document, plan.operations);
  assert.deepEqual(plan.coordinatedRemovedClipIds, [voiceClip.id]);
  assert.equal(edited.clips.some((candidate) => candidate.id === voiceClip.id), false);
  assert.equal(edited.clips.some((candidate) => candidate.id === replacement.id), true);
});

test("roll moves one cut by a frame without changing its outer bounds", () => {
  const document = createEditDocument();
  const [fromClip, toClip] = document.clips;
  assert.ok(fromClip && toClip);
  const plan = buildCompositionRollEditPlan({
    deltaFrames: 1,
    document,
    edge: "RIGHT",
    selectedClipId: fromClip.id,
  });
  const edited = applyCompositionEditorPatches(document, plan.operations);
  const nextFrom = edited.clips.find((clip) => clip.id === fromClip.id)!;
  const nextTo = edited.clips.find((clip) => clip.id === toClip.id)!;

  assert.equal(nextFrom.startSeconds, 0);
  assert.equal(nextFrom.durationSeconds, 4 + 1 / document.canvas.fps);
  assert.equal(nextTo.startSeconds, 4 + 1 / document.canvas.fps);
  assert.equal(nextTo.startSeconds + nextTo.durationSeconds, 8);
  assert.equal(nextTo.sourceOffsetSeconds, 1 + 1 / document.canvas.fps);
});

test("slide moves the selected clip while preserving the surrounding outer bounds", () => {
  const document = createEditDocument();
  const [previous, selected, next] = document.clips;
  assert.ok(previous && selected && next);
  const plan = buildCompositionSlideEditPlan({
    deltaFrames: 1,
    document,
    selectedClipId: selected.id,
  });
  const edited = applyCompositionEditorPatches(document, plan.operations);

  assert.equal(edited.clips.find((clip) => clip.id === previous.id)!.durationSeconds, 4 + 1 / document.canvas.fps);
  assert.equal(edited.clips.find((clip) => clip.id === selected.id)!.startSeconds, 4 + 1 / document.canvas.fps);
  const editedNext = edited.clips.find((clip) => clip.id === next.id)!;
  assert.equal(editedNext.startSeconds + editedNext.durationSeconds, 12);
});

test("roll and slide coordinate an aligned logical group across tracks", () => {
  let document = createEditDocument();
  const sourceTrack = document.tracks[0]!;
  const coordinatedTrack = {
    ...structuredClone(sourceTrack),
    id: "coordinated-track",
    label: "Capa coordinada",
    order: sourceTrack.order + 1,
  };
  const coordinatedClips = document.clips.map((clip, index) => ({
    ...structuredClone(clip),
    hfId: `coordinated-hf-${index}`,
    id: `coordinated-clip-${index}`,
    trackId: coordinatedTrack.id,
  }));
  document.tracks.push(coordinatedTrack);
  document.clips.push(...coordinatedClips);
  document = applyCompositionEditorPatches(document, [{
    clipIds: [document.clips[1]!.id, coordinatedClips[1]!.id],
    groupId: "coordinated-group",
    type: "group.create",
  }]);

  const rollPlan = buildCompositionRollEditPlan({
    deltaFrames: 2,
    document,
    edge: "RIGHT",
    selectedClipIds: document.groups![0]!.clipIds,
  });
  assert.equal(rollPlan.operations.length, 4);
  const rolled = applyCompositionEditorPatches(document, rollPlan.operations);
  assert.equal(rolled.clips.find((clip) => clip.id === document.clips[1]!.id)!.durationSeconds, 4 + 2 / document.canvas.fps);
  assert.equal(rolled.clips.find((clip) => clip.id === coordinatedClips[1]!.id)!.durationSeconds, 4 + 2 / document.canvas.fps);

  const slidePlan = buildCompositionSlideEditPlan({
    deltaFrames: -2,
    document,
    selectedClipIds: document.groups![0]!.clipIds,
  });
  assert.equal(slidePlan.operations.length, 6);
  const slid = applyCompositionEditorPatches(document, slidePlan.operations);
  assert.equal(slid.clips.find((clip) => clip.id === document.clips[1]!.id)!.startSeconds, 4 - 2 / document.canvas.fps);
  assert.equal(slid.clips.find((clip) => clip.id === coordinatedClips[1]!.id)!.startSeconds, 4 - 2 / document.canvas.fps);
});

test("roll coordinates a generated avatar and voice pair without double-moving it", () => {
  const document = createEditDocument();
  const avatarTrack = document.tracks[0]!;
  avatarTrack.semanticRole = "AVATAR";
  const voiceTrack = {
    ...structuredClone(avatarTrack),
    id: "voice-track",
    kind: "AUDIO" as const,
    label: "Voz",
    order: avatarTrack.order + 1,
    semanticRole: "VOICE" as const,
  };
  const voiceClips = document.clips.map((clip, index) => ({
    ...structuredClone(clip),
    hfId: `voice-hf-${index}`,
    id: `voice-clip-${index}`,
    kind: "AUDIO" as const,
    sceneId: `scene-${index}`,
    trackId: voiceTrack.id,
  }));
  document.clips.forEach((clip, index) => { clip.sceneId = `scene-${index}`; });
  document.tracks.push(voiceTrack);
  document.clips.push(...voiceClips);

  const plan = buildCompositionRollEditPlan({
    deltaFrames: 1,
    document,
    edge: "RIGHT",
    selectedClipId: document.clips[1]!.id,
  });
  assert.equal(plan.operations.length, 4);
  const edited = applyCompositionEditorPatches(document, plan.operations);
  assert.equal(edited.clips.find((clip) => clip.id === document.clips[1]!.id)!.durationSeconds, 4 + 1 / document.canvas.fps);
  assert.equal(edited.clips.find((clip) => clip.id === voiceClips[1]!.id)!.durationSeconds, 4 + 1 / document.canvas.fps);
  assert.equal(edited.clips.find((clip) => clip.id === voiceClips[2]!.id)!.startSeconds, 8 + 1 / document.canvas.fps);
});

test("advanced edits fail closed for unaligned groups and transitions crossing an insert", () => {
  let grouped = createEditDocument();
  grouped = applyCompositionEditorPatches(grouped, [{
    clipIds: [grouped.clips[0]!.id, grouped.clips[1]!.id],
    groupId: "group-edit",
    type: "group.create",
  }]);
  assert.throws(() => buildCompositionRollEditPlan({
    deltaFrames: 1,
    document: grouped,
    edge: "RIGHT",
    selectedClipId: grouped.clips[0]!.id,
  }), CompositionTimelineEditError);

  const transitionDocument = createTransitionDocument();
  transitionDocument.transitions = { items: [createTransition(transitionDocument)], schemaVersion: 1 };
  const inserted = createInsertedClip(transitionDocument, 4, 1);
  assert.throws(() => buildCompositionAssetPlacementEditPlan({
    clip: inserted,
    document: transitionDocument,
    mode: "INSERT",
  }), /transición/);

  const rollPlan = buildCompositionRollEditPlan({
    deltaFrames: 1,
    document: transitionDocument,
    edge: "RIGHT",
    selectedClipId: transitionDocument.clips[0]!.id,
  });
  const rolled = applyCompositionEditorPatches(transitionDocument, rollPlan.operations);
  assert.equal(rolled.transitions?.items.length, 1);
});
