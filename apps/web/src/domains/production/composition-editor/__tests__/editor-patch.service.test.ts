import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { applyCompositionEditorPatches, CompositionEditorPatchError } from "../editor-patch.service";

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
