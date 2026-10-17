import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS } from "../composition-preview-compiler.service";
import { buildNativeConformanceCorpusCase, listNativeConformanceCorpusRecipes, NATIVE_CONFORMANCE_CORPUS_FPS,
  NATIVE_CORPUS_REMAINING_REQUIREMENTS } from "../qa/composition-native-conformance-corpus";
import { COMPOSITION_MOTION_PRESETS } from "../composition-motion-preset.service";
import { COMPOSITION_TRANSITION_TYPES, COMPOSITION_TRANSITION_ALIGNMENTS, COMPOSITION_TRANSITION_DIRECTIONS } from "../composition-transition.types";
import { resolveCompositionTransitionEligibility } from "../composition-transition.service";
import { buildCompositionEventCheckpointPlan } from "../composition-conformance-event-checkpoints";
import { compositionEditorDocumentSchema } from "../composition-document.types";

test("versioned native recipes include every motion preset and every transition/alignment/direction", () => {
  const recipes = listNativeConformanceCorpusRecipes();
  assert.equal(new Set(recipes.map((recipe) => recipe.id)).size, recipes.length);
  for (const preset of COMPOSITION_MOTION_PRESETS) for (const variant of ["DEFAULT", "EXTREME"])
    assert.ok(recipes.some((recipe) => recipe.category === "MOTION" && recipe.presetId === preset.id && recipe.variant === variant));
  for (const type of COMPOSITION_TRANSITION_TYPES) for (const alignment of COMPOSITION_TRANSITION_ALIGNMENTS) {
    const directions = type === "PUSH" || type === "SOFT_WIPE" ? COMPOSITION_TRANSITION_DIRECTIONS : [undefined];
    for (const direction of directions) assert.ok(recipes.some((recipe) => recipe.category === "TRANSITION"
      && recipe.transitionType === type && recipe.alignment === alignment && recipe.direction === direction));
  }
  assert.ok(NATIVE_CORPUS_REMAINING_REQUIREMENTS.includes("AUDIO_EDITORIAL"));
  assert.ok(NATIVE_CORPUS_REMAINING_REQUIREMENTS.includes("DECK_HTML_TEXT"));
});

test("every recipe at every approved FPS is valid, reproducible, isolated and has complete event checkpoints", () => {
  let checked = 0;
  for (const recipe of listNativeConformanceCorpusRecipes()) for (const fps of NATIVE_CONFORMANCE_CORPUS_FPS) {
    const first = buildNativeConformanceCorpusCase(recipe.id, fps), second = buildNativeConformanceCorpusCase(recipe.id, fps);
    assert.equal(first.scope, "DETERMINISTIC_NATIVE_DOCUMENT_RECIPE_NOT_RENDER_EVIDENCE");
    assert.equal(first.caseSha256, second.caseSha256);
    assert.deepEqual(first.document, second.document);
    assert.ok(compositionEditorDocumentSchema.safeParse(first.document).success);
    const plan = buildCompositionEventCheckpointPlan(first.document);
    const checkpoints = plan.batches.flat();
    assert.equal(checkpoints[0]!.frameIndex, 0);
    assert.equal(checkpoints.at(-1)!.frameIndex, fps * first.document.canvas.durationSeconds - 1);
    assert.equal(checkpoints.length, plan.checkpointCount);
    assert.ok(plan.batches.every((batch) => batch.length <= 48));
    if (recipe.category === "TRANSITION") {
      const transition = first.document.transitions!.items[0]!;
      const eligibility = resolveCompositionTransitionEligibility({document: first.document, transition});
      assert.equal(eligibility.available, true, `${recipe.id}: ${JSON.stringify(eligibility.issues)}`);
      assert.ok(checkpoints.some((checkpoint) => checkpoint.reasons.includes(`at:transition-midpoint:${transition.id}`)));
    }
    if (recipe.category === "CAPTIONS" && recipe.variant === "MULTI_BATCH") assert.ok(plan.batches.length > 1);
    first.document.clips[0]!.label = "mutated";
    assert.equal(buildNativeConformanceCorpusCase(recipe.id, fps).caseSha256, second.caseSha256);
    checked++;
  }
  assert.equal(checked, listNativeConformanceCorpusRecipes().length * NATIVE_CONFORMANCE_CORPUS_FPS.length);
});

test("unknown recipe/FPS cannot silently substitute a passing smoke fixture", () => {
  assert.throws(() => buildNativeConformanceCorpusCase("unknown", 25), /RECIPE_UNKNOWN/);
  assert.throws(() => buildNativeConformanceCorpusCase("captions-srt", 29 as 25), /FPS_INVALID/);
  assert.notEqual(buildNativeConformanceCorpusCase("captions-srt", 25).caseSha256,
    buildNativeConformanceCorpusCase("captions-srt", 30).caseSha256);
});

test("each recipe compiles into both real compiler targets with hash-pinned local assets, without rendering", async () => {
  for (const recipe of listNativeConformanceCorpusRecipes()) {
    const fixture = buildNativeConformanceCorpusCase(recipe.id, 25);
    const assetUrls = new Map(fixture.assets.map((asset) => {
      assert.equal(createHash("sha256").update(asset.content).digest("hex"), asset.checksum);
      return [asset.id, `data:${asset.mimeType};charset=utf-8,${encodeURIComponent(asset.content)}`];
    }));
    for (const target of [COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW, COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER]) {
      const html = await compileCompositionPreview({document: fixture.document, documentHash: fixture.documentHash, assetUrls, target});
      assert.ok(html.includes("corpus-primary"), `${recipe.id}: missing ${target} source`);
    }
  }
});
