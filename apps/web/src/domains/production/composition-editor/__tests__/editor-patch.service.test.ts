import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import {
  applyCompositionEditorPatches,
  CompositionEditorPatchError,
  ensureCanvasDurationForClipPatches,
} from "../editor-patch.service";

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
