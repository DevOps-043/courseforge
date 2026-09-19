import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import type { CompositionSceneSummary } from "../composition-scene.service";
import {
  buildCompositionTranscriptCaptionCues,
  createCompositionTranscriptCaptionPlan,
} from "../composition-transcript-caption.service";
import { applyCompositionEditorPatches } from "../editor-patch.service";

function scene(words: CompositionSceneSummary["wordCues"]): CompositionSceneSummary {
  return {
    clipHfIds: ["voice-1"], durationSeconds: 8, id: "scene-1", label: "Escena 1",
    primaryHfId: "voice-1", roles: ["VOICE"], startSeconds: 0, wordCues: words,
  };
}

function document() {
  return createInitialCompositionDocument({
    animatedDeck: {
      css: "",
      fonts: [],
      height: 1080,
      slides: [
        { animationCount: 0, classes: "slide", html: "<section>1</section>", index: 0, label: "1" },
        { animationCount: 0, classes: "slide", html: "<section>2</section>", index: 1, label: "2" },
      ],
      width: 1920,
    },
    assets: [],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Transcript" },
  });
}

test("groups transcript words on punctuation, pauses and the five-word readability limit", () => {
  const cues = buildCompositionTranscriptCaptionCues({
    durationSeconds: 8,
    scenes: [scene([
      { word: "Hola", start: 0, end: 0.3 },
      { word: "mundo.", start: 0.35, end: 0.8 },
      { word: "Este", start: 1.2, end: 1.5 },
      { word: "es", start: 1.51, end: 1.7 },
      { word: "un", start: 1.71, end: 1.9 },
      { word: "caption", start: 1.91, end: 2.2 },
      { word: "claro", start: 2.21, end: 2.5 },
      { word: "final", start: 2.51, end: 2.9 },
    ])],
  });

  assert.deepEqual(cues.map((cue) => cue.text), ["Hola mundo.", "Este es un caption claro", "final"]);
  assert.deepEqual(cues.map((cue) => [cue.startSeconds, cue.endSeconds]), [[0, 0.8], [1.2, 2.5], [2.51, 2.9]]);
  assert.deepEqual(cues[0]?.words?.map((word) => word.text), ["Hola", "mundo."]);
});

test("filters noise and rejects transcripts dominated by music tokens", () => {
  assert.deepEqual(buildCompositionTranscriptCaptionCues({
    durationSeconds: 2,
    scenes: [scene([
      { word: "♪", start: 0, end: 0.2 },
      { word: "Hola", start: 0.3, end: 0.8 },
      { word: "uh", start: 0.81, end: 0.85 },
      { word: "bien", start: 1, end: 1.4 },
      { word: "venido", start: 1.41, end: 1.8 },
    ])],
  }).map((cue) => cue.text), ["Hola", "bien venido"]);
  assert.throws(() => buildCompositionTranscriptCaptionCues({
    durationSeconds: 2,
    scenes: [scene([
      { word: "♪", start: 0, end: 0.2 },
      { word: "♫", start: 0.3, end: 0.5 },
      { word: "Hola", start: 0.6, end: 1 },
    ])],
  }), /demasiado ruido o música/);
});

test("creates a full-canvas native caption layer and updates it idempotently", () => {
  const initial = document();
  const scenes = [scene([{ word: "Hola", start: 0.2, end: 0.8 }])];
  const createdPlan = createCompositionTranscriptCaptionPlan({ document: initial, id: "captions-generated", scenes });
  const created = applyCompositionEditorPatches(initial, createdPlan.operations);
  const layer = created.clips.find((clip) => clip.hfId === createdPlan.hfId);

  assert.equal(createdPlan.mode, "CREATE");
  assert.equal(layer?.durationSeconds, 10);
  assert.equal(layer?.source.type, "NATIVE_CAPTIONS");
  if (layer?.source.type === "NATIVE_CAPTIONS") assert.equal(layer.source.origin, "TRANSCRIPT");

  const updatedPlan = createCompositionTranscriptCaptionPlan({
    document: created,
    id: "unused-id",
    scenes: [scene([{ word: "Actualizado", start: 1, end: 1.8 }])],
  });
  const updated = applyCompositionEditorPatches(created, updatedPlan.operations);
  const updatedLayer = updated.clips.find((clip) => clip.hfId === createdPlan.hfId);
  assert.equal(updatedPlan.mode, "UPDATE");
  assert.equal(updated.clips.filter((clip) => clip.source.type === "NATIVE_CAPTIONS").length, 1);
  if (updatedLayer?.source.type === "NATIVE_CAPTIONS") assert.equal(updatedLayer.source.cues[0]?.text, "Actualizado");
});

test("does not overwrite a manual caption layer", () => {
  const initial = document();
  const { clip, track } = createCompositionNativeOverlay({
    document: initial, id: "manual-caption", kind: "CAPTION", playheadSeconds: 0,
  });
  const withManual = applyCompositionEditorPatches(initial, [{
    clip, clipId: clip.id, ...(track ? { track } : {}), type: "clip.add",
  }]);
  assert.throws(() => createCompositionTranscriptCaptionPlan({
    document: withManual,
    id: "generated-caption",
    scenes: [scene([{ word: "Hola", start: 0, end: 0.5 }])],
  }), /capa manual o importada/);
});
