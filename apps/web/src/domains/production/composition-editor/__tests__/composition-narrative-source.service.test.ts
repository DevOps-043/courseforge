import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCompositionNarrativeScenes,
  buildSceneVisualCatalog,
  narrativeFingerprint,
  validateSceneVisualPlans,
} from "../composition-narrative-source.service";

const deck = {
  css: "", fonts: [], height: 1080, width: 1920,
  slides: [{ animationCount: 0, classes: "slide", html: "<h1>Análisis de datos</h1>", index: 0, label: "Análisis" }],
};

test("builds a stable slide catalog and carries reviewed narration timestamps", () => {
  const catalog = buildSceneVisualCatalog(deck)!;
  const script = "Analiza los datos de ventas.";
  const scriptHash = narrativeFingerprint(script);
  const scenes = buildCompositionNarrativeScenes({
    avatar_generation_mode: "scene_clips",
    avatar_clips: [{ id: "scene-1", order: 1, script_text: script, status: "COMPLETED", voice_status: "COMPLETED",
      visual_plan: { deckRevision: catalog.deckRevision, scriptHash, slides: [{ key: catalog.slides[0]!.key, label: "Análisis", weight: 1 }] } }],
    voice_clips: [{ id: "voice-1", clip_id: "scene-1", order: 1, script_hash: scriptHash, status: "COMPLETED",
      word_timestamps: [{ word: "Analiza", start: 0.1, end: 0.5 }] }],
  }, catalog);
  assert.equal(scenes[0]?.needsReview, false);
  assert.deepEqual(scenes[0]?.wordTimestamps, [{ word: "Analiza", start: 0.1, end: 0.5 }]);
  assert.equal(catalog.slides[0]?.text, "Análisis de datos");
});

test("marks changed scripts and decks for review without losing the authored plan", () => {
  const catalog = buildSceneVisualCatalog(deck)!;
  const scenes = buildCompositionNarrativeScenes({
    avatar_generation_mode: "scene_clips",
    avatar_clips: [{ id: "scene-1", order: 1, script_text: "Guion nuevo", status: "STALE",
      visual_plan: { deckRevision: "f".repeat(64), scriptHash: narrativeFingerprint("Guion anterior"), slides: [] } }],
  }, catalog);
  assert.equal(scenes[0]?.needsReview, true);
  assert.equal(scenes[0]?.visualPlan?.deckRevision, "f".repeat(64));
});

test("rejects unknown references in the active deck", () => {
  const catalog = buildSceneVisualCatalog(deck)!;
  assert.throws(() => validateSceneVisualPlans([{
    id: "scene-1", order: 1, script_text: "Guion", status: "DRAFT",
    visual_plan: { deckRevision: catalog.deckRevision, scriptHash: narrativeFingerprint("Guion"),
      slides: [{ key: "0".repeat(64), label: "Desconocida", weight: 1 }] },
  }], catalog), /presentación cambió/);
});

test("stamps the approval with the saved script instead of trusting the client hash", () => {
  const catalog = buildSceneVisualCatalog(deck)!;
  const [validated] = validateSceneVisualPlans([{
    id: "scene-1", order: 1, script_text: "Guion guardado", status: "DRAFT",
    visual_plan: { deckRevision: catalog.deckRevision, scriptHash: narrativeFingerprint("Otro guion"), slides: [] },
  }], catalog);
  assert.equal(validated?.visual_plan?.scriptHash, narrativeFingerprint("Guion guardado"));
});
