import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { buildDeckConformanceCorpusCase, DECK_CONFORMANCE_CORPUS_RECIPES } from "../qa/composition-deck-conformance-corpus";
import { NATIVE_CONFORMANCE_CORPUS_FPS } from "../qa/composition-native-conformance-corpus";
import { buildCompositionEventCheckpointPlan } from "../composition-conformance-event-checkpoints";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS } from "../composition-preview-compiler.service";

test("all 20 deck recipes bind authored expectations to deterministic, isolated documents", () => {
  for (const recipe of DECK_CONFORMANCE_CORPUS_RECIPES) for (const fps of NATIVE_CONFORMANCE_CORPUS_FPS) {
    const first = buildDeckConformanceCorpusCase(recipe, fps), second = buildDeckConformanceCorpusCase(recipe, fps);
    assert.equal(first.caseSha256, second.caseSha256);
    assert.equal(first.expectationLedger.documentHash, first.documentHash);
    assert.equal(first.expectationLedgerSha256, createHash("sha256").update(JSON.stringify(first.expectationLedger)).digest("hex"));
    assert.equal(first.document.deckStyles!.fontUrls.length, 0);
    assert.ok(first.document.clips.every((clip) => clip.source.type === "DECK_SLIDE"));
    const checkpoints = buildCompositionEventCheckpointPlan(first.document).batches.flat();
    assert.equal(checkpoints[0]!.frameIndex, 0);
    assert.equal(checkpoints.at(-1)!.frameIndex, 8 * fps - 1);
    first.expectationLedger.entries[0]!.expectedText = "mutated";
    first.document.clips[0]!.label = "mutated";
    assert.deepEqual(buildDeckConformanceCorpusCase(recipe, fps), second);
  }
});

test("cut ledger uses half-open clip windows and checkpoint coverage includes both sides", () => {
  const fixture = buildDeckConformanceCorpusCase("deck-cut", 25);
  assert.deepEqual(fixture.expectationLedger.entries.map(({startSeconds, endSeconds}) => [startSeconds, endSeconds]), [[0, 4], [4, 8]]);
  const frames = buildCompositionEventCheckpointPlan(fixture.document).batches.flat().map((checkpoint) => checkpoint.frameIndex);
  for (const index of [99, 100, 101]) assert.ok(frames.includes(index));
});

test("deck RTL, wrapping and transforms are authored explicitly, not inferred from a screenshot", () => {
  assert.equal(buildDeckConformanceCorpusCase("deck-rtl", 25).expectationLedger.entries[0]!.direction, "rtl");
  assert.match(buildDeckConformanceCorpusCase("deck-wrap", 25).document.deckStyles!.css, /width:440px/);
  const transformed = buildDeckConformanceCorpusCase("deck-transform", 25);
  assert.equal(transformed.document.clips[0]!.layout.rotation, 17);
  assert.equal(transformed.document.clips[0]!.layout.opacity, 0.6);
});

test("unknown deck recipe and FPS fail instead of silently selecting a simpler fixture", () => {
  assert.throws(() => buildDeckConformanceCorpusCase("unknown", 25), /RECIPE_UNKNOWN/);
  assert.throws(() => buildDeckConformanceCorpusCase("deck-basic", 29 as 25), /FPS_INVALID/);
  assert.notEqual(buildDeckConformanceCorpusCase("deck-basic", 25).caseSha256, buildDeckConformanceCorpusCase("deck-basic", 30).caseSha256);
});

test("each deck recipe preserves authored text and IDs through both compiler targets", async () => {
  for (const recipe of DECK_CONFORMANCE_CORPUS_RECIPES) {
    const fixture = buildDeckConformanceCorpusCase(recipe, 25);
    for (const target of [COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW, COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER]) {
      const html = await compileCompositionPreview({document: fixture.document, documentHash: fixture.documentHash, assetUrls: new Map(), target});
      for (const expected of fixture.expectationLedger.entries) {
        assert.ok(html.includes(expected.elementId), `${recipe}: ${target} ID`);
        assert.ok(html.includes(expected.expectedText), `${recipe}: ${target} text`);
      }
    }
  }
});
