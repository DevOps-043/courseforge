import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { buildCompositionAutoOrganizePatch } from "../composition-auto-organize.service";
import { COMPOSITION_DOCUMENT_FORMAT, compositionEditorDocumentSchema, LEGACY_COMPOSITION_DOCUMENT_FORMAT } from "../composition-document.types";
import {
  applyCompositionEditorPatches,
  CompositionEditorPatchError,
  ensureCanvasDurationForClipPatches,
} from "../editor-patch.service";
import { compositionEditorPatchRequestSchema } from "../editor-patch.types";

const baseDocument = () => createInitialCompositionDocument({
  animatedDeck: {
    css: ".slide { color: white; }",
    fonts: [],
    height: 1080,
    slides: [{ animationCount: 0, classes: "slide", html: "<section>Slide</section>", index: 0, label: "IntroducciÃ³n" }],
    width: 1920,
  },
  assets: [{
    checksum: "a".repeat(64),
    fileSizeBytes: 42,
    mimeType: "video/mp4",
    productionAssetId: "11111111-1111-4111-8111-111111111111",
    publicUrl: null,
    storageBucket: "production-assets",
    storagePath: "production-assets/avatar.mp4",
  }],
  plan: { accentColor: "#38BDF8", durationSeconds: 30, subtitle: "Prueba", title: "Video de prueba" },
});

test("edita la lÃ­nea de tiempo sin alterar la referencia del asset", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  const edited = applyCompositionEditorPatches(document, [{
    clipId: video.id,
    durationSeconds: 4,
    type: "clip.duration",
  }]);

  const result = edited.clips.find((clip) => clip.id === video.id)!;
  assert.equal(result.durationSeconds, 4);
  assert.equal(result.timingSource, "USER_EDITED");
  assert.deepEqual(result.source, video.source);
});

test("rechaza cambios que exceden el canvas", () => {
  const document = baseDocument();
  const slide = document.clips.find((clip) => clip.kind === "DECK_SLIDE")!;
  assert.throws(
    () => applyCompositionEditorPatches(document, [{ clipId: slide.id, startSeconds: 29, type: "clip.move" }]),
    CompositionEditorPatchError,
  );
});

test("respeta tracks bloqueados", () => {
  const document = baseDocument();
  document.tracks[0].locked = true;
  const slide = document.clips[0];
  assert.throws(
    () => applyCompositionEditorPatches(document, [{ clipId: slide.id, hidden: true, type: "clip.visibility" }]),
    CompositionEditorPatchError,
  );
});

test("actualiza controles de capa y permite volver a desbloquearla", () => {
  const document = baseDocument();
  const track = document.tracks.find((candidate) => candidate.id === "visual")!;
  const updated = applyCompositionEditorPatches(document, [{
    settings: { hidden: true, locked: true, muted: true, volume: 0.35 },
    trackId: track.id,
    type: "track.update",
  }]);
  const stored = updated.tracks.find((candidate) => candidate.id === track.id)!;

  assert.equal(stored.hidden, true);
  assert.equal(stored.locked, true);
  assert.equal(stored.muted, true);
  assert.equal(stored.volume, 0.35);
  const unlocked = applyCompositionEditorPatches(updated, [{ settings: { locked: false }, trackId: track.id, type: "track.update" }]);
  assert.equal(unlocked.tracks.find((candidate) => candidate.id === track.id)?.locked, false);
});

test("actualiza la mezcla automática sin modificar los tracks de audio", () => {
  const document = baseDocument();
  const tracksBefore = structuredClone(document.tracks);
  const updated = applyCompositionEditorPatches(document, [{
    settings: { attackSeconds: 0.1, duckedVolumeRatio: 0.2, enabled: false, releaseSeconds: 0.5 },
    type: "audio-mix.update",
  }]);

  assert.deepEqual(updated.audioMix.ducking, {
    ...document.audioMix.ducking,
    attackSeconds: 0.1,
    duckedVolumeRatio: 0.2,
    enabled: false,
    releaseSeconds: 0.5,
  });
  assert.deepEqual(updated.tracks, tracksBefore);
});

test("agrega y quita un clip del timeline sin borrar el asset de origen", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;

  const withoutVideo = applyCompositionEditorPatches(document, [{
    clipId: video.id,
    type: "clip.remove",
  }]);
  assert.equal(withoutVideo.clips.some((clip) => clip.id === video.id), false);
  assert.equal(withoutVideo.clips.some((clip) => clip.kind === "DECK_SLIDE"), true);

  const restored = applyCompositionEditorPatches(withoutVideo, [{
    clip: video,
    clipId: video.id,
    type: "clip.add",
  }]);
  assert.deepEqual(restored.clips.find((clip) => clip.id === video.id)?.source, video.source);
});

test("acepta reinsertar un asset eliminado incluyendo la definición de su track existente", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  const track = document.tracks.find((candidate) => candidate.id === video.trackId)!;
  const withoutVideo = applyCompositionEditorPatches(document, [{ clipId: video.id, type: "clip.remove" }]);
  const request = compositionEditorPatchRequestSchema.parse({
    operations: [{ clip: video, clipId: video.id, track, type: "clip.add" }],
    source: "USER",
    summary: "Reinsertó el asset eliminado en la línea de tiempo.",
  });
  const restored = applyCompositionEditorPatches(withoutVideo, request.operations);

  assert.equal(restored.clips.filter((clip) => clip.source.type === "PRODUCTION_ASSET").length, 1);
  assert.deepEqual(restored.clips.find((clip) => clip.id === video.id)?.source, video.source);
});

test("aplica una plantilla de tiempo después de ampliar el canvas", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  const edited = applyCompositionEditorPatches(document, [
    { clipId: "canvas", durationSeconds: 45, type: "composition.canvas-duration" },
    { clipId: video.id, durationSeconds: 12, layout: { ...video.layout, x: 24, y: 36 }, startSeconds: 8, type: "clip.template" },
  ]);
  const result = edited.clips.find((clip) => clip.id === video.id)!;
  assert.equal(edited.canvas.durationSeconds, 45);
  assert.equal(result.startSeconds, 8);
  assert.equal(result.durationSeconds, 12);
  assert.equal(result.layout.x, 24);
});

test("amplía el canvas atómicamente cuando un timecode de clip supera la duración actual", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  delete video.sourceDurationSeconds;
  const operations = ensureCanvasDurationForClipPatches(document, [
    { clipId: video.id, durationSeconds: 160, type: "clip.duration" },
    { clipId: video.id, startSeconds: 0, type: "clip.move" },
  ]);
  const edited = applyCompositionEditorPatches(document, operations);

  assert.equal(operations[0]?.type, "composition.canvas-duration");
  assert.equal(edited.canvas.durationSeconds, 160);
  assert.equal(edited.canvas.durationMode, "USER_EDITED");
  assert.equal(edited.clips.find((clip) => clip.id === video.id)?.durationSeconds, 160);
});

test("persiste un recorte atómico con offset de fuente", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  video.sourceDurationSeconds = 20;
  const edited = applyCompositionEditorPatches(document, [{
    clipId: video.id,
    durationSeconds: 4,
    sourceOffsetSeconds: 3,
    startSeconds: 1,
    type: "clip.trim",
  }]);
  const result = edited.clips.find((clip) => clip.id === video.id)!;

  assert.equal(result.startSeconds, 1);
  assert.equal(result.durationSeconds, 4);
  assert.equal(result.sourceOffsetSeconds, 3);
  assert.equal(result.timingSource, "USER_EDITED");
});

test("permite extender un video más allá de su fuente para reproducirlo en loop", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  document.canvas.durationSeconds = 30;
  video.durationSeconds = 8;
  video.sourceDurationSeconds = 8;

  const edited = applyCompositionEditorPatches(document, [{
    clipId: video.id,
    durationSeconds: 24,
    type: "clip.duration",
  }]);

  assert.equal(edited.clips.find((clip) => clip.id === video.id)?.durationSeconds, 24);
  assert.equal(edited.clips.find((clip) => clip.id === video.id)?.sourceDurationSeconds, 8);
});

test("normaliza el offset al recortar un video que ya está en loop", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  document.canvas.durationSeconds = 30;
  video.durationSeconds = 24;
  video.sourceDurationSeconds = 8;

  const edited = applyCompositionEditorPatches(document, [{
    clipId: video.id,
    durationSeconds: 14,
    sourceOffsetSeconds: 10,
    startSeconds: 10,
    type: "clip.trim",
  }]);

  assert.equal(edited.clips.find((clip) => clip.id === video.id)?.sourceOffsetSeconds, 2);
});

test("restaura una versión anterior como un documento nuevo sin mutar su snapshot", () => {
  const original = baseDocument();
  const video = original.clips.find((clip) => clip.kind === "VIDEO")!;
  original.canvas.durationSeconds = 60;
  video.durationSeconds = 30;
  video.sourceDurationSeconds = 30;
  const edited = applyCompositionEditorPatches(original, [{
    clipId: video.id,
    durationSeconds: 4,
    sourceOffsetSeconds: 3,
    startSeconds: 2,
    type: "clip.trim",
  }]);

  const restored = applyCompositionEditorPatches(edited, [{
    document: original,
    type: "document.restore",
  }]);

  assert.deepEqual(restored, original);
  assert.notEqual(restored, original);
  assert.throws(
    () => applyCompositionEditorPatches(edited, [{ document: original, type: "document.restore" }], "AGENT"),
    CompositionEditorPatchError,
  );
});

test("divide un video en dos clips derivados sin duplicar ni modificar el asset fuente", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  document.canvas.durationSeconds = 60;
  video.durationSeconds = 30;
  video.sourceDurationSeconds = 30;

  const edited = applyCompositionEditorPatches(document, [{
    atSeconds: 12,
    clipId: video.id,
    newClipId: "avatar-cut-second",
    newHfId: "avatar-cut-second-hf",
    type: "clip.split",
  }]);

  const first = edited.clips.find((clip) => clip.id === video.id)!;
  const second = edited.clips.find((clip) => clip.id === "avatar-cut-second")!;
  assert.equal(first.durationSeconds, 12);
  assert.equal(first.sourceOffsetSeconds, 0);
  assert.equal(second.startSeconds, 12);
  assert.equal(second.durationSeconds, 18);
  assert.equal(second.sourceOffsetSeconds, 12);
  assert.deepEqual(second.source, first.source);
  assert.equal(second.source.type, "PRODUCTION_ASSET");
  assert.equal(first.source.type, "PRODUCTION_ASSET");
  if (second.source.type === "PRODUCTION_ASSET" && first.source.type === "PRODUCTION_ASSET") {
    assert.equal(second.source.productionAssetId, first.source.productionAssetId);
  }
});

test("normaliza los rangos derivados al frame rate del documento", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  document.canvas.durationSeconds = 10;
  document.canvas.fps = 24;
  video.durationSeconds = 4;
  video.sourceDurationSeconds = 4;

  const edited = applyCompositionEditorPatches(document, [{
    atSeconds: 1.04,
    clipId: video.id,
    newClipId: "avatar-frame-aligned-second",
    newHfId: "avatar-frame-aligned-second-hf",
    type: "clip.split",
  }]);
  const first = edited.clips.find((clip) => clip.id === video.id)!;
  const second = edited.clips.find((clip) => clip.id === "avatar-frame-aligned-second")!;

  assert.equal(first.durationSeconds, 25 / 24);
  assert.equal(second.startSeconds, 25 / 24);
  assert.equal(second.sourceOffsetSeconds, 25 / 24);
  assert.equal(second.durationSeconds, 71 / 24);
});

test("elimina un segmento intermedio y conserva los dos rangos del mismo asset", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  document.canvas.durationSeconds = 60;
  video.durationSeconds = 30;
  video.sourceDurationSeconds = 30;

  const edited = applyCompositionEditorPatches(document, [{
    clipId: video.id,
    endSeconds: 15,
    newClipId: "avatar-after-gap",
    newHfId: "avatar-after-gap-hf",
    ripple: true,
    startSeconds: 10,
    type: "clip.remove-range",
  }]);

  const before = edited.clips.find((clip) => clip.id === video.id)!;
  const after = edited.clips.find((clip) => clip.id === "avatar-after-gap")!;
  assert.equal(before.durationSeconds, 10);
  assert.equal(before.sourceOffsetSeconds, 0);
  assert.equal(after.startSeconds, 10);
  assert.equal(after.durationSeconds, 15);
  assert.equal(after.sourceOffsetSeconds, 15);
  assert.equal(after.source.type, "PRODUCTION_ASSET");
  assert.equal(before.source.type, "PRODUCTION_ASSET");
  if (after.source.type === "PRODUCTION_ASSET" && before.source.type === "PRODUCTION_ASSET") {
    assert.equal(after.source.productionAssetId, before.source.productionAssetId);
  }
});

test("rechaza cortes en los límites y clips con animaciones para no perder estado", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  assert.throws(() => applyCompositionEditorPatches(document, [{
    atSeconds: video.startSeconds,
    clipId: video.id,
    newClipId: "invalid-cut",
    newHfId: "invalid-cut-hf",
    type: "clip.split",
  }]), CompositionEditorPatchError);

  // The factory receives a schema default for motion; replace it before this
  // mutation so this test cannot share a default array with later cases.
  document.motion = { ...document.motion, animations: [] };
  document.motion.animations.push({
    id: "motion-video",
    keyframes: [
      { offset: 0, values: { opacity: 0 } },
      { offset: 1, values: { opacity: 1 } },
    ],
    origin: "PRESET",
    preset: { id: "FADE_IN", version: 1 },
    propertyGroup: "OPACITY",
    target: { clipId: video.id, part: "CONTENT" },
    timing: { anchor: "CLIP_START", durationSeconds: 0.2, offsetSeconds: 0 },
  });
  assert.throws(() => applyCompositionEditorPatches(document, [{
    atSeconds: 2,
    clipId: video.id,
    newClipId: "animated-cut",
    newHfId: "animated-cut-hf",
    type: "clip.split",
  }]), CompositionEditorPatchError);
});

test("acumula ediciones sucesivas sin reiniciar propiedades previamente guardadas", () => {
  const document = baseDocument();
  document.canvas.durationSeconds = 30;
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  const slide = document.clips.find((clip) => clip.kind === "DECK_SLIDE")!;

  const firstVersion = applyCompositionEditorPatches(document, [
    { clipId: video.id, durationSeconds: 7.5, type: "clip.duration" },
    { clipId: video.id, startSeconds: 3.25, type: "clip.move" },
    {
      clipId: video.id,
      layout: { height: 540, opacity: 0.72, rotation: 13, width: 960, x: 417, y: 208, zIndex: 12 },
      type: "clip.layout",
    },
    { clipId: video.id, hidden: true, type: "clip.visibility" },
  ]);
  const secondVersion = applyCompositionEditorPatches(firstVersion, [
    { clipId: slide.id, layout: { x: 24, y: 36 }, type: "clip.layout" },
  ]);
  const stored = secondVersion.clips.find((clip) => clip.id === video.id)!;

  assert.equal(stored.startSeconds, 3.25);
  assert.equal(stored.durationSeconds, 7.5);
  assert.equal(stored.timingSource, "USER_EDITED");
  assert.equal(stored.hidden, true);
  assert.deepEqual(stored.layout, {
    height: 540,
    opacity: 0.72,
    rotation: 13,
    width: 960,
    x: 417,
    y: 208,
    zIndex: 12,
  });
});

test("actualiza documentos V1 a V2 sin perder su estado existente", () => {
  const original = baseDocument();
  const legacy = structuredClone(original) as unknown as Record<string, unknown>;
  legacy.format = LEGACY_COMPOSITION_DOCUMENT_FORMAT;
  delete legacy.motion;
  const parsed = compositionEditorDocumentSchema.parse(legacy);
  assert.deepEqual(parsed.motion.animations, []);

  const clip = parsed.clips[0]!;
  const updated = applyCompositionEditorPatches(parsed, [{ clipId: clip.id, hidden: true, type: "clip.visibility" }]);
  assert.equal(updated.format, COMPOSITION_DOCUMENT_FORMAT);
  assert.equal(updated.clips.find((candidate) => candidate.id === clip.id)?.hidden, true);
});

test("añade motion sin modificar layout ni timing y lo elimina en cascada con el clip", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  const layoutBefore = structuredClone(video.layout);
  const timingBefore = { durationSeconds: video.durationSeconds, startSeconds: video.startSeconds };
  const animated = applyCompositionEditorPatches(document, [{
    animationId: "motion-fade-in-test",
    clipId: video.id,
    durationSeconds: 0.7,
    presetId: "FADE_IN",
    type: "animation.add-preset",
  }]);
  const stored = animated.clips.find((clip) => clip.id === video.id)!;
  assert.deepEqual(stored.layout, layoutBefore);
  assert.deepEqual({ durationSeconds: stored.durationSeconds, startSeconds: stored.startSeconds }, timingBefore);
  assert.equal(animated.motion.animations[0]?.target.clipId, video.id);

  const removed = applyCompositionEditorPatches(animated, [{ clipId: video.id, type: "clip.remove" }]);
  assert.equal(removed.motion.animations.length, 0);
});

test("el cálculo automático conserva layout, visibilidad y tiempos manuales", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  video.layout = { ...video.layout, x: 417, y: 208, width: 900 };
  video.hidden = true;
  video.startSeconds = 2;
  video.durationSeconds = 4;
  video.timingSource = "USER_EDITED";
  const layoutBefore = structuredClone(video.layout);
  const { operations } = buildCompositionAutoOrganizePatch({
    assets: [{ durationSeconds: 8, id: "11111111-1111-4111-8111-111111111111", label: "Avatar", timelineRole: "VISUAL" }],
    document,
  });
  const updated = applyCompositionEditorPatches(document, operations);
  const stored = updated.clips.find((clip) => clip.id === video.id)!;
  assert.deepEqual(stored.layout, layoutBefore);
  assert.equal(stored.hidden, true);
  assert.equal(stored.startSeconds, 2);
  assert.equal(stored.durationSeconds, 4);
});
