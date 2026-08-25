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
import {
  buildCompositionAnimationTimelineEdit,
  buildCompositionAnimationTimelineSnapEdit,
  planCompositionPresetInsertion,
  resolveCompositionAnimationWindow,
} from "../composition-motion-scheduling.service";

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

test("aplica un recorte visual no destructivo y conserva timing, layout y fuente", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  const edited = applyCompositionEditorPatches(document, [{
    clipId: video.id,
    crop: { top: 12, right: 24, bottom: 36, left: 48 },
    type: "clip.crop",
  }]);
  const result = edited.clips.find((clip) => clip.id === video.id)!;

  assert.deepEqual(result.crop, { top: 12, right: 24, bottom: 36, left: 48 });
  assert.equal(result.durationSeconds, video.durationSeconds);
  assert.deepEqual(result.layout, video.layout);
  assert.deepEqual(result.source, video.source);
});

test("aplica el mismo recorte visual no destructivo a una diapositiva HTML", () => {
  const document = baseDocument();
  const slide = document.clips.find((clip) => clip.kind === "DECK_SLIDE")!;
  const edited = applyCompositionEditorPatches(document, [{
    clipId: slide.id,
    crop: { top: 18, right: 36, bottom: 54, left: 72 },
    type: "clip.crop",
  }]);
  const result = edited.clips.find((clip) => clip.id === slide.id)!;

  assert.deepEqual(result.crop, { top: 18, right: 36, bottom: 54, left: 72 });
  assert.equal(result.durationSeconds, slide.durationSeconds);
  assert.deepEqual(result.layout, slide.layout);
  assert.deepEqual(result.source, slide.source);
});

test("limita los insets para conservar al menos un píxel visible", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  const edited = applyCompositionEditorPatches(document, [{
    clipId: video.id,
    crop: { top: video.layout.height, right: video.layout.width, bottom: video.layout.height, left: video.layout.width },
    type: "clip.crop",
  }]);

  assert.deepEqual(edited.clips.find((clip) => clip.id === video.id)?.crop, {
    bottom: 0,
    left: video.layout.width - 1,
    right: 0,
    top: video.layout.height - 1,
  });
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

test("persiste el volumen individual de B-roll sin alterar el master del track", () => {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{
      checksum: "b".repeat(64),
      durationSeconds: 8,
      fileSizeBytes: 42,
      hasAudio: true,
      mimeType: "video/mp4",
      productionAssetId: "22222222-2222-4222-8222-222222222222",
      publicUrl: null,
      storageBucket: "production-assets",
      storagePath: "production-assets/broll.mp4",
      timelineRole: "BROLL",
    }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "B-roll" },
  });
  const broll = document.clips.find((clip) => clip.trackId === "broll")!;
  const tracksBefore = structuredClone(document.tracks);

  const edited = applyCompositionEditorPatches(document, [{
    clipId: broll.id,
    type: "clip.volume",
    volume: 0.42,
  }]);

  assert.equal(edited.clips.find((clip) => clip.id === broll.id)?.volume, 0.42);
  assert.deepEqual(edited.tracks, tracksBefore);
  assert.deepEqual(edited.clips.find((clip) => clip.id === broll.id)?.source, broll.source);
});

test("acepta volumen individual de avatar cuando la fuente confirma audio", () => {
  const avatarDocument = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{
      checksum: "c".repeat(64),
      durationSeconds: 20,
      fileSizeBytes: 42,
      hasAudio: true,
      mimeType: "video/mp4",
      productionAssetId: "33333333-3333-4333-8333-333333333333",
      publicUrl: null,
      storageBucket: "production-assets",
      storagePath: "production-assets/avatar-with-audio.mp4",
      timelineRole: "AVATAR",
    }],
    plan: { accentColor: "#38BDF8", durationSeconds: 20, subtitle: "Prueba", title: "Avatar" },
  });
  const avatar = avatarDocument.clips[0]!;
  const edited = applyCompositionEditorPatches(avatarDocument, [{ clipId: avatar.id, type: "clip.volume", volume: 0.5 }]);

  assert.equal(edited.clips[0]?.volume, 0.5);
  assert.equal(edited.tracks.find((track) => track.id === "avatar")?.volume, 1);
});

test("rechaza volumen individual sin audio confirmado y valores fuera de rango", () => {
  const document = baseDocument();
  const avatar = document.clips.find((clip) => clip.kind === "VIDEO")!;

  assert.throws(
    () => applyCompositionEditorPatches(document, [{ clipId: avatar.id, type: "clip.volume", volume: 0.5 }]),
    CompositionEditorPatchError,
  );
  assert.equal(compositionEditorPatchRequestSchema.safeParse({
    operations: [{ clipId: avatar.id, type: "clip.volume", volume: 1.01 }],
    source: "USER",
    summary: "Volumen inválido.",
  }).success, false);
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

test("extiende una diapositiva desde el borde izquierdo sin recortar su fuente HTML", () => {
  const document = baseDocument();
  const slide = document.clips.find((clip) => clip.kind === "DECK_SLIDE")!;
  document.canvas.durationSeconds = 30;
  slide.startSeconds = 10;
  slide.durationSeconds = 5;
  const sourceBefore = structuredClone(slide.source);

  const edited = applyCompositionEditorPatches(document, [{
    clipId: slide.id,
    durationSeconds: 9,
    sourceOffsetSeconds: 0,
    startSeconds: 6,
    type: "clip.trim",
  }]);
  const result = edited.clips.find((clip) => clip.id === slide.id)!;

  assert.equal(result.startSeconds, 6);
  assert.equal(result.durationSeconds, 9);
  assert.equal(result.startSeconds + result.durationSeconds, 15);
  assert.equal(result.sourceOffsetSeconds, 0);
  assert.deepEqual(result.source, sourceBefore);
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

test("permite eliminar un intervalo desde el inicio del clip", () => {
  const document = baseDocument();
  document.canvas.durationSeconds = 60;
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  video.durationSeconds = 30;
  video.sourceDurationSeconds = 30;
  const edited = applyCompositionEditorPatches(document, [{
    clipId: video.id,
    endSeconds: video.startSeconds + 5,
    ripple: true,
    startSeconds: video.startSeconds,
    type: "clip.remove-range",
  }]);
  const result = edited.clips.find((clip) => clip.id === video.id)!;

  assert.equal(result.startSeconds, video.startSeconds);
  assert.equal(result.durationSeconds, 25);
  assert.equal(result.sourceOffsetSeconds, 5);
});

test("permite eliminar un intervalo hasta el final del clip", () => {
  const document = baseDocument();
  document.canvas.durationSeconds = 60;
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  video.durationSeconds = 30;
  video.sourceDurationSeconds = 30;
  const edited = applyCompositionEditorPatches(document, [{
    clipId: video.id,
    endSeconds: video.startSeconds + video.durationSeconds,
    ripple: true,
    startSeconds: video.startSeconds + 25,
    type: "clip.remove-range",
  }]);
  const result = edited.clips.find((clip) => clip.id === video.id)!;

  assert.equal(result.durationSeconds, 25);
  assert.equal(result.sourceOffsetSeconds, 0);
});

test("mantiene el error cuando el intervalo realmente queda fuera del clip", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  assert.throws(() => applyCompositionEditorPatches(document, [{
    clipId: video.id,
    endSeconds: video.startSeconds + video.durationSeconds + 1,
    ripple: true,
    startSeconds: video.startSeconds + 1,
    type: "clip.remove-range",
  }]), CompositionEditorPatchError);
});

test("reinicia un asset, consolida sus fragmentos y elimina recortes y animaciones", () => {
  const document = baseDocument();
  document.canvas.durationSeconds = 60;
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  video.durationSeconds = 30;
  video.sourceDurationSeconds = 30;
  const originalStartSeconds = video.startSeconds;
  const split = applyCompositionEditorPatches(document, [{
    atSeconds: video.startSeconds + 10,
    clipId: video.id,
    newClipId: "video-reset-right",
    newHfId: "video-reset-right-hf",
    type: "clip.split",
  }]);
  const edited = applyCompositionEditorPatches(split, [
    { animationId: "motion-reset-left", clipId: video.id, durationSeconds: 0.5, presetId: "FADE_IN", type: "animation.add-preset" },
    { animationId: "motion-reset-right", clipId: "video-reset-right", durationSeconds: 0.5, presetId: "FADE_OUT", type: "animation.add-preset" },
    { clipId: "video-reset-right", crop: { focusX: 0.5, focusY: 0.5, zoom: 2 }, type: "clip.crop" },
    { clipId: "video-reset-right", layout: { height: 300, width: 400, x: 25, y: 40 }, type: "clip.layout" },
  ]);
  const reset = applyCompositionEditorPatches(edited, [{
    clipId: "video-reset-right",
    type: "clip.reset-asset",
  }]);
  const restored = reset.clips.find((clip) => clip.id === "video-reset-right")!;
  const sourceAssetId = restored.source.type === "PRODUCTION_ASSET" ? restored.source.productionAssetId : null;
  const sourceClips = reset.clips.filter((clip) => clip.source.type === "PRODUCTION_ASSET" && clip.source.productionAssetId === sourceAssetId);

  assert.equal(sourceClips.length, 1);
  assert.equal(restored.startSeconds, originalStartSeconds);
  assert.equal(restored.durationSeconds, 30);
  assert.equal(restored.sourceOffsetSeconds, 0);
  assert.equal(restored.crop, undefined);
  assert.equal(restored.mediaFit, "COVER");
  assert.deepEqual(restored.layout, { height: 1080, opacity: 1, rotation: 0, width: 1920, x: 0, y: 0, zIndex: 0 });
  assert.equal(reset.motion.animations.some((animation) => animation.target.clipId === video.id || animation.target.clipId === "video-reset-right"), false);
});

test("permite mostrar completa una fuente visual sin confundir fit con crop", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  video.crop = { bottom: 20, left: 10, right: 10, top: 20 };
  const fitted = applyCompositionEditorPatches(document, [
    { clipId: video.id, mediaFit: "CONTAIN", type: "clip.media-fit" },
    { clipId: video.id, crop: null, type: "clip.crop" },
  ]);
  const result = fitted.clips.find((clip) => clip.id === video.id)!;

  assert.equal(result.mediaFit, "CONTAIN");
  assert.equal(result.crop, undefined);
});

test("impide que el agente reinicie un asset sin confirmación del usuario", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  assert.throws(() => applyCompositionEditorPatches(document, [{
    clipId: video.id,
    type: "clip.reset-asset",
  }], "AGENT"), CompositionEditorPatchError);
});

test("reiniciar también recupera el inicio eliminado por un trim de timeline", () => {
  const document = baseDocument();
  document.canvas.durationSeconds = 60;
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  video.durationSeconds = 30;
  video.sourceDurationSeconds = 30;
  const originalStartSeconds = video.startSeconds;
  const trimmed = applyCompositionEditorPatches(document, [{
    clipId: video.id,
    durationSeconds: 25,
    sourceOffsetSeconds: 5,
    startSeconds: originalStartSeconds + 5,
    type: "clip.trim",
  }]);
  const reset = applyCompositionEditorPatches(trimmed, [{ clipId: video.id, type: "clip.reset-asset" }]);
  const restored = reset.clips.find((clip) => clip.id === video.id)!;

  assert.equal(restored.startSeconds, originalStartSeconds);
  assert.equal(restored.durationSeconds, 30);
  assert.equal(restored.sourceOffsetSeconds, 0);
});

test("rechaza cortes en los límites y migra animaciones que no atraviesan el corte", () => {
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
  document.motion.animations.push({
    id: "motion-video-exit",
    keyframes: [
      { offset: 0, values: { opacity: 1 } },
      { offset: 1, values: { opacity: 0 } },
    ],
    origin: "PRESET",
    preset: { id: "FADE_OUT", version: 1 },
    propertyGroup: "OPACITY",
    target: { clipId: video.id, part: "CONTENT" },
    timing: { anchor: "CLIP_END", durationSeconds: 0.2, offsetSeconds: 0 },
  });
  const edited = applyCompositionEditorPatches(document, [{
    atSeconds: 2,
    clipId: video.id,
    newClipId: "animated-cut",
    newHfId: "animated-cut-hf",
    type: "clip.split",
  }]);

  const entry = edited.motion.animations.find((animation) => animation.id === "motion-video")!;
  const exit = edited.motion.animations.find((animation) => animation.id === "motion-video-exit")!;
  assert.equal(entry.target.clipId, video.id);
  assert.equal(exit.target.clipId, "animated-cut");
  assert.deepEqual(resolveCompositionAnimationWindow(entry, 2), { duration: 0.2, end: 0.2, start: 0 });
  assert.deepEqual(resolveCompositionAnimationWindow(exit, 28), { duration: 0.2, end: 28, start: 27.8 });
});

test("rechaza únicamente el corte que atraviesa una animación", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  document.motion = { ...document.motion, animations: [{
    id: "motion-crossing-cut",
    keyframes: [
      { offset: 0, values: { scale: 1 } },
      { offset: 1, values: { scale: 1.2 } },
    ],
    origin: "USER",
    propertyGroup: "SCALE",
    target: { clipId: video.id, part: "CONTENT" },
    timing: { anchor: "CLIP_START", durationSeconds: 1, offsetSeconds: 1.5 },
  }] };

  assert.throws(() => applyCompositionEditorPatches(document, [{
    atSeconds: 2,
    clipId: video.id,
    newClipId: "crossing-cut",
    newHfId: "crossing-cut-hf",
    type: "clip.split",
  }]), /El corte atraviesa la animación motion-crossing-cut/);
});

test("redistribuye animaciones al eliminar un intervalo entre ellas", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  document.canvas.durationSeconds = 60;
  video.durationSeconds = 30;
  video.sourceDurationSeconds = 30;
  document.motion = { ...document.motion, animations: [] };
  const animated = applyCompositionEditorPatches(document, [
    { animationId: "motion-before-gap", clipId: video.id, durationSeconds: 0.5, presetId: "FADE_IN", type: "animation.add-preset" },
    { animationId: "motion-after-gap", clipId: video.id, durationSeconds: 0.5, presetId: "FADE_OUT", type: "animation.add-preset" },
  ]);
  const edited = applyCompositionEditorPatches(animated, [{
    clipId: video.id,
    endSeconds: 15,
    newClipId: "animated-after-gap",
    newHfId: "animated-after-gap-hf",
    ripple: true,
    startSeconds: 10,
    type: "clip.remove-range",
  }]);

  const before = edited.motion.animations.find((animation) => animation.id === "motion-before-gap")!;
  const after = edited.motion.animations.find((animation) => animation.id === "motion-after-gap")!;
  assert.equal(before.target.clipId, video.id);
  assert.equal(after.target.clipId, "animated-after-gap");
  assert.deepEqual(resolveCompositionAnimationWindow(before, 10), { duration: 0.5, end: 0.5, start: 0 });
  assert.deepEqual(resolveCompositionAnimationWindow(after, 15), { duration: 0.5, end: 15, start: 14.5 });
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
      layout: { height: 540, opacity: 0.72, rotation: 13, width: 960, x: 417, y: 208, zIndex: 10 },
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
    zIndex: 10,
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
  assert.equal(updated.motion.schemaVersion, 2);
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

test("crea y reconfigura animaciones ambientales con cadencia finita", () => {
  const document = baseDocument();
  document.canvas.durationSeconds = 60;
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  video.durationSeconds = 12;
  const animated = applyCompositionEditorPatches(document, [{
    animationId: "motion-pulse-test",
    clipId: video.id,
    durationSeconds: 6,
    presetId: "PULSE",
    type: "animation.add-preset",
  }]);
  const initial = animated.motion.animations.find((animation) => animation.id === "motion-pulse-test")!;

  assert.equal(initial.timing.anchor, "CLIP_START");
  assert.equal(initial.timing.durationSeconds, 6);
  assert.deepEqual(initial.loop, { mode: "FINITE", cycleDurationSeconds: 1.5 });
  assert.equal(initial.keyframes.length, 3);

  const configured = applyCompositionEditorPatches(animated, [{
    animationId: initial.id,
    cycleDurationSeconds: 2,
    cycles: 4,
    durationSeconds: 8,
    intensity: 1.5,
    offsetSeconds: 1.5,
    type: "animation.configure-preset",
  }]);
  const result = configured.motion.animations.find((animation) => animation.id === initial.id)!;

  assert.equal(result.origin, "USER");
  assert.equal(result.timing.durationSeconds, 8);
  assert.equal(result.timing.offsetSeconds, 1.5);
  assert.deepEqual(result.loop, { mode: "FINITE", cycleDurationSeconds: 2 });
  assert.equal(result.preset?.parameters?.intensity, 1.5);
  assert.equal(result.keyframes.length, 3);
});

test("crea ocultación intermedia instantánea y con desvanecimiento reversible", () => {
  const document = baseDocument();
  document.canvas.durationSeconds = 60;
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  video.durationSeconds = 12;

  const hidden = applyCompositionEditorPatches(document, [{
    animationId: "motion-hide-test",
    clipId: video.id,
    durationSeconds: 4,
    offsetSeconds: 2,
    presetId: "HIDE",
    type: "animation.add-preset",
  }]);
  const hideAnimation = hidden.motion.animations.find((animation) => animation.id === "motion-hide-test")!;

  assert.equal(hideAnimation.timing.anchor, "CLIP_START");
  assert.equal(hideAnimation.propertyGroup, "OPACITY");
  assert.deepEqual(hideAnimation.keyframes, [
    { offset: 0, values: { opacity: 0 } },
    { ease: "steps(1)", offset: 1, values: { opacity: 1 } },
  ]);

  const faded = applyCompositionEditorPatches(document, [{
    animationId: "motion-fade-hide-test",
    clipId: video.id,
    durationSeconds: 5,
    offsetSeconds: 3,
    presetId: "FADE_HIDE",
    type: "animation.add-preset",
  }]);
  const fadeAnimation = faded.motion.animations.find((animation) => animation.id === "motion-fade-hide-test")!;

  assert.deepEqual(fadeAnimation.keyframes, [
    { offset: 0, values: { opacity: 1 } },
    { ease: "power2.in", offset: 0.2, values: { opacity: 0 } },
    { ease: "none", offset: 0.8, values: { opacity: 0 } },
    { ease: "power2.out", offset: 1, values: { opacity: 1 } },
  ]);
});

test("ancla los presets de salida al final y conserva sus límites de fase", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  const animated = applyCompositionEditorPatches(document, [{
    animationId: "motion-slide-out-test",
    clipId: video.id,
    durationSeconds: 5,
    presetId: "SLIDE_OUT_RIGHT",
    type: "animation.add-preset",
  }]);
  const exit = animated.motion.animations.find((animation) => animation.id === "motion-slide-out-test")!;

  assert.equal(exit.propertyGroup, "POSITION");
  assert.equal(exit.timing.anchor, "CLIP_END");
  assert.equal(exit.timing.durationSeconds, 2);
  assert.throws(() => applyCompositionEditorPatches(animated, [{
    animationId: exit.id,
    timing: { anchor: "CLIP_START" },
    type: "animation.update-timing",
  }]), CompositionEditorPatchError);
  assert.throws(() => applyCompositionEditorPatches(animated, [{
    animationId: exit.id,
    timing: { durationSeconds: 2.1 },
    type: "animation.update-timing",
  }]), CompositionEditorPatchError);
});

test("planifica entrada, reproducción y salida sin solapar el mismo grupo de propiedades", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  const presets = ["SLIDE_IN_LEFT", "FLOAT", "SLIDE_OUT_RIGHT"] as const;
  let animated = document;

  for (const presetId of presets) {
    const plan = planCompositionPresetInsertion({
      animations: animated.motion.animations,
      clipDurationSeconds: video.durationSeconds,
      clipId: video.id,
      presetId,
    });
    assert.equal(plan.available, true);
    animated = applyCompositionEditorPatches(animated, [{
      animationId: `motion-${presetId.toLowerCase().replaceAll("_", "-")}-planned`,
      clipId: video.id,
      durationSeconds: plan.durationSeconds,
      offsetSeconds: plan.offsetSeconds,
      presetId,
      type: "animation.add-preset",
    }]);
  }

  const windows = animated.motion.animations
    .filter((animation) => animation.target.clipId === video.id && animation.propertyGroup === "POSITION")
    .map((animation) => resolveCompositionAnimationWindow(animation, video.durationSeconds))
    .sort((left, right) => left.start - right.start);
  assert.equal(windows.length, 3);
  assert.ok(windows[0]!.end <= windows[1]!.start + 0.001);
  assert.ok(windows[1]!.end <= windows[2]!.start + 0.001);
  assert.equal(windows[0]!.start, 0);
  assert.equal(windows[2]!.end, video.durationSeconds);
});

test("marca un preset como no disponible cuando su propiedad ocupa todo el clip", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  video.durationSeconds = 0.7;
  const animated = applyCompositionEditorPatches(document, [{
    animationId: "motion-opacity-full-clip",
    clipId: video.id,
    durationSeconds: 0.7,
    presetId: "FADE_IN",
    type: "animation.add-preset",
  }]);
  const plan = planCompositionPresetInsertion({
    animations: animated.motion.animations,
    clipDurationSeconds: video.durationSeconds,
    clipId: video.id,
    presetId: "FADE_OUT",
  });

  assert.equal(plan.available, false);
  assert.match(plan.reason || "", /opacidad/);
});

test("mueve una salida por frames conservando su anclaje al final", () => {
  const timing = buildCompositionAnimationTimelineEdit({
    animation: { timing: { anchor: "CLIP_END", durationSeconds: 0.7, offsetSeconds: 0 } },
    clipDurationSeconds: 5,
    deltaSeconds: -1,
    fps: 30,
    kind: "MOVE",
    maximumDurationSeconds: 2,
    snapEnabled: true,
  });

  assert.deepEqual(timing, {
    anchor: "CLIP_END",
    durationSeconds: 0.7,
    offsetSeconds: 1,
  });
});

test("aplica snap magnético a animaciones Durante y respeta el interruptor global", () => {
  const document = baseDocument();
  document.canvas.durationSeconds = 60;
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  video.durationSeconds = 12;
  const animated = applyCompositionEditorPatches(document, [
    { animationId: "motion-entry-snap-target", clipId: video.id, durationSeconds: 1, offsetSeconds: 0, presetId: "FADE_IN", type: "animation.add-preset" },
    { animationId: "motion-during-snap", clipId: video.id, durationSeconds: 2, offsetSeconds: 2, presetId: "HIDE", type: "animation.add-preset" },
  ]);
  const during = animated.motion.animations.find((animation) => animation.id === "motion-during-snap")!;
  const common = {
    animation: during,
    animations: animated.motion.animations,
    clips: animated.clips,
    clipDurationSeconds: video.durationSeconds,
    clipStartSeconds: video.startSeconds,
    fps: document.canvas.fps,
    kind: "MOVE" as const,
    maximumDurationSeconds: video.durationSeconds,
    playheadSeconds: video.startSeconds + 8,
    snapToleranceSeconds: 0.1,
  };

  const snappedAfterEntry = buildCompositionAnimationTimelineSnapEdit({
    ...common,
    deltaSeconds: -0.92,
    snapEnabled: true,
  });
  assert.equal(snappedAfterEntry.timing.offsetSeconds, 1);
  assert.equal(snappedAfterEntry.snapMatch?.source, "ANIMATION_END");
  assert.equal(snappedAfterEntry.snapMatch?.animationId, "motion-entry-snap-target");

  const snappedToClipEnd = buildCompositionAnimationTimelineSnapEdit({
    ...common,
    deltaSeconds: 7.96,
    snapEnabled: true,
  });
  assert.equal(snappedToClipEnd.timing.offsetSeconds, 10);
  assert.equal(snappedToClipEnd.snapMatch?.source, "CLIP_END");
  assert.equal(snappedToClipEnd.snapMatch?.movingEdge, "END");

  const slide = animated.clips.find((clip) => clip.kind === "DECK_SLIDE")!;
  slide.startSeconds = video.startSeconds + 6;
  slide.durationSeconds = 2;
  const snappedToAssetStart = buildCompositionAnimationTimelineSnapEdit({
    ...common,
    clips: animated.clips,
    deltaSeconds: 1.96,
    snapEnabled: true,
  });
  assert.equal(snappedToAssetStart.timing.offsetSeconds, 4);
  assert.equal(snappedToAssetStart.snapMatch?.source, "CLIP_START");
  assert.equal(snappedToAssetStart.snapMatch?.clipId, slide.id);
  assert.equal(snappedToAssetStart.snapMatch?.clipLabel, slide.label);

  const resizedToPlayhead = buildCompositionAnimationTimelineSnapEdit({
    ...common,
    deltaSeconds: 0.96,
    kind: "RESIZE_END",
    playheadSeconds: video.startSeconds + 5,
    snapEnabled: true,
  });
  assert.equal(resizedToPlayhead.timing.durationSeconds, 3);
  assert.equal(resizedToPlayhead.snapMatch?.source, "PLAYHEAD");
  assert.equal(resizedToPlayhead.snapMatch?.movingEdge, "END");

  const withoutSnap = buildCompositionAnimationTimelineSnapEdit({
    ...common,
    deltaSeconds: -0.92,
    snapEnabled: false,
  });
  assert.equal(withoutSnap.timing.offsetSeconds, 1.08);
  assert.equal(withoutSnap.snapMatch, null);
});

test("redimensiona una banda dentro del máximo del preset y hace snap al playhead", () => {
  const resized = buildCompositionAnimationTimelineEdit({
    animation: { timing: { anchor: "CLIP_START", durationSeconds: 1, offsetSeconds: 1 } },
    clipDurationSeconds: 5,
    deltaSeconds: 10,
    fps: 30,
    kind: "RESIZE_END",
    maximumDurationSeconds: 2,
    snapEnabled: true,
  });
  const snapped = buildCompositionAnimationTimelineEdit({
    animation: { timing: { anchor: "CLIP_START", durationSeconds: 1, offsetSeconds: 1 } },
    clipDurationSeconds: 5,
    deltaSeconds: 0.96,
    fps: 30,
    kind: "MOVE",
    maximumDurationSeconds: 2,
    snapEnabled: true,
    snapTargetSeconds: 3,
    snapToleranceSeconds: 0.1,
  });

  assert.deepEqual(resized, {
    anchor: "CLIP_START",
    durationSeconds: 2,
    offsetSeconds: 1,
  });
  assert.deepEqual(snapped, {
    anchor: "CLIP_START",
    durationSeconds: 1,
    offsetSeconds: 2,
  });
});

test("marca como manual una animación ajustada desde la timeline", () => {
  const document = baseDocument();
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  const animated = applyCompositionEditorPatches(document, [{
    animationId: "motion-manual-timing",
    clipId: video.id,
    durationSeconds: 0.7,
    presetId: "FADE_IN",
    type: "animation.add-preset",
  }]);
  const updated = applyCompositionEditorPatches(animated, [{
    animationId: "motion-manual-timing",
    timing: { offsetSeconds: 0.5 },
    type: "animation.update-timing",
  }]);

  assert.equal(updated.motion.animations[0]?.origin, "USER");
  assert.equal(updated.motion.animations[0]?.timing.offsetSeconds, 0.5);
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
