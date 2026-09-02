import assert from "node:assert/strict";
import test from "node:test";
import type { CompositionEditorDocument } from "../composition-document.types";
import { deriveCompositionScenes } from "../composition-scene.service";

const layout = { height: 1080, opacity: 1, rotation: 0, width: 1920, x: 0, y: 0, zIndex: 0 };
const document = {
  audioMix: { ducking: { attackSeconds: 0.2, duckedVolumeRatio: 0.35, enabled: true, releaseSeconds: 0.35, targetRole: "MUSIC", triggerRoles: ["VOICE", "AVATAR"] } },
  canvas: { durationSeconds: 10, fps: 30, height: 1080, width: 1920 },
  clips: [
    { durationSeconds: 5, hidden: false, hfId: "slide-1", id: "slide-1", kind: "DECK_SLIDE", label: "Slide 1", layout, source: { classes: "slide active", html: "<h1>Uno</h1>", slideIndex: 0, type: "DECK_SLIDE" }, startSeconds: 0, timingSource: "ESTIMATED", trackId: "deck" },
    { durationSeconds: 5, hidden: false, hfId: "slide-2", id: "slide-2", kind: "DECK_SLIDE", label: "Slide 2", layout, source: { classes: "slide active", html: "<h1>Dos</h1>", slideIndex: 1, type: "DECK_SLIDE" }, startSeconds: 5, timingSource: "ESTIMATED", trackId: "deck" },
    { durationSeconds: 5, hidden: false, hfId: "voice-1", id: "voice-1", kind: "AUDIO", label: "Voz 1", layout, source: { hasAudio: true, productionAssetId: "11111111-1111-4111-8111-111111111111", type: "PRODUCTION_ASSET" }, startSeconds: 0, timingSource: "ESTIMATED", trackId: "voice" },
  ],
  deckStyles: { css: "", fontUrls: [] },
  format: "courseforge-composition-v2",
  motion: { animations: [], schemaVersion: 2 },
  tracks: [
    { id: "deck", kind: "DECK", label: "Slides", locked: false, order: 0, semanticRole: "DECK" },
    { id: "voice", kind: "AUDIO", label: "Voz", locked: false, order: 1, semanticRole: "VOICE" },
  ],
  variables: { accent: "#ff0000", subtitle: "", title: "Curso" },
} as CompositionEditorDocument;

test("derives one editable scene per slide and includes overlapping assets", () => {
  const scenes = deriveCompositionScenes(document);
  assert.equal(scenes.length, 2);
  assert.deepEqual(scenes[0].clipHfIds, ["slide-1", "voice-1"]);
  assert.deepEqual(scenes[0].roles, ["DECK", "VOICE"]);
  assert.equal(scenes[1].startSeconds, 5);
});

test("uses narrative scenes, exposes script cues and reports visual correspondence", () => {
  const narrative = structuredClone(document);
  narrative.clips[0]!.sceneId = "narrative-1";
  narrative.clips[2]!.sceneId = "narrative-1";
  narrative.clips[0]!.source = { ...narrative.clips[0]!.source, slideKey: "a".repeat(64) } as typeof narrative.clips[0]["source"];
  narrative.narrativeScenes = [{
    id: "narrative-1", order: 1, label: "Idea principal", scriptText: "Explica el concepto principal.",
    scriptHash: "b".repeat(64), needsReview: false,
    wordTimestamps: [{ word: "Explica", start: 0.2, end: 0.7 }],
    visualPlan: { deckRevision: "c".repeat(64), scriptHash: "b".repeat(64), slides: [{ key: "a".repeat(64), label: "Slide 1", weight: 1 }] },
  }];
  const scenes = deriveCompositionScenes(narrative);
  assert.equal(scenes.length, 1);
  assert.equal(scenes[0]?.scriptText, "Explica el concepto principal.");
  assert.deepEqual(scenes[0]?.wordCues, [{ word: "Explica", start: 0.2, end: 0.7 }]);
  assert.equal(scenes[0]?.visualsMatch, true);
  if (narrative.clips[0]!.source.type === "DECK_SLIDE") narrative.clips[0]!.source.slideKey = "d".repeat(64);
  assert.equal(deriveCompositionScenes(narrative)[0]?.visualsMatch, false);
});
