import assert from "node:assert/strict";
import test from "node:test";
import { createNarrativeDocumentFixture } from "./fixtures/composition-narrative.fixture";
import { deriveNarrativeNavigationOccurrences } from "../composition-narrative-occurrence.service";
import { resolveNarrativeRangePreview, shouldStopNarrativeRangePreview, type NarrativeRangeSelection } from "../composition-narrative-range.service";

function fixture() {
  const document = createNarrativeDocumentFixture();
  const occurrence = deriveNarrativeNavigationOccurrences(document).occurrences[0]!;
  const selection: NarrativeRangeSelection = { documentHash: "a".repeat(64), occurrenceId: occurrence.id, firstSourceIndex: 1, lastSourceIndex: 2 };
  return { document, selection };
}

test("resolves consecutive words from the current document without mutation", () => {
  const { document, selection } = fixture();
  const before = structuredClone(document);
  const resolution = resolveNarrativeRangePreview(document, selection.documentHash, selection);
  assert.equal(resolution.ok, true);
  if (!resolution.ok) return;
  assert.equal(resolution.range.startSeconds, 10);
  assert.equal(resolution.range.endSeconds, 11.5);
  assert.equal(resolution.range.text, "café listo");
  assert.equal(resolution.range.partial, true);
  assert.deepEqual(document, before);
});
test("stale document and empty revision invalidate selection", () => {
  const { document, selection } = fixture();
  assert.deepEqual(resolveNarrativeRangePreview(document, "b".repeat(64), selection), { ok: false, reason: "STALE_DOCUMENT" });
  assert.deepEqual(resolveNarrativeRangePreview(document, "", { ...selection, documentHash: "" }), { ok: false, reason: "STALE_DOCUMENT" });
});
test("removed or replaced occurrence cannot reuse a saved selection", () => {
  const { document, selection } = fixture();
  document.clips = [];
  assert.deepEqual(resolveNarrativeRangePreview(document, selection.documentHash, selection), { ok: false, reason: "MISSING_OCCURRENCE" });
  const replacement = fixture();
  if (replacement.document.clips[0]!.source.type === "PRODUCTION_ASSET") replacement.document.clips[0]!.source.productionAssetId = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(resolveNarrativeRangePreview(replacement.document, selection.documentHash, selection), { ok: false, reason: "MISSING_OCCURRENCE" });
});
test("rejects inverted, fractional, negative, missing and non-finite token bounds", () => {
  const { document, selection } = fixture();
  for (const patch of [{ firstSourceIndex: 2, lastSourceIndex: 1 }, { firstSourceIndex: 1.5 },
    { firstSourceIndex: -1 }, { firstSourceIndex: 0 }, { lastSourceIndex: 99 }, { lastSourceIndex: NaN }]) {
    assert.deepEqual(resolveNarrativeRangePreview(document, selection.documentHash, { ...selection, ...patch }), { ok: false, reason: "INVALID_TOKENS" });
  }
});
test("supports one word and excludes adjacent split clips", () => {
  const { document, selection } = fixture();
  const oneWord = resolveNarrativeRangePreview(document, selection.documentHash, { ...selection, firstSourceIndex: 2 });
  assert.equal(oneWord.ok && oneWord.range.text, "listo");
  document.clips[0]!.durationSeconds = 0.5;
  document.clips.push({ ...structuredClone(document.clips[0]!), id: "right", hfId: "hf-right", startSeconds: 10.5, sourceOffsetSeconds: 1.5, durationSeconds: 1.5 });
  assert.deepEqual(resolveNarrativeRangePreview(document, selection.documentHash, selection), { ok: false, reason: "INVALID_TOKENS" });
});
test("bounds preview length rather than silently clipping", () => {
  const { document, selection } = fixture();
  document.clips[0]!.durationSeconds = 150;
  document.clips[0]!.sourceDurationSeconds = 200;
  document.narrativeScenes![0]!.wordTimestamps = [{ word: "larga", start: 1, end: 130 }];
  assert.deepEqual(resolveNarrativeRangePreview(document, selection.documentHash, { ...selection, firstSourceIndex: 0, lastSourceIndex: 0 }), { ok: false, reason: "RANGE_TOO_LONG" });
});
test("manual interval can add context but remains within its current clip", () => {
  const { document, selection } = fixture();
  const resolution = resolveNarrativeRangePreview(document, selection.documentHash, { ...selection, adjustedStartSeconds: 10.1, adjustedEndSeconds: 12 });
  assert.equal(resolution.ok, true);
  if (resolution.ok) assert.deepEqual([resolution.range.startSeconds, resolution.range.endSeconds], [10.1, 12]);
});
test("manual interval rejects missing, inverted, non-finite or out-of-clip bounds", () => {
  const { document, selection } = fixture();
  for (const patch of [{ adjustedStartSeconds: 10 }, { adjustedEndSeconds: 12 },
    { adjustedStartSeconds: 9, adjustedEndSeconds: 11 }, { adjustedStartSeconds: 10, adjustedEndSeconds: 13 },
    { adjustedStartSeconds: 11, adjustedEndSeconds: 10 }, { adjustedStartSeconds: NaN, adjustedEndSeconds: 11 }]) {
    assert.deepEqual(resolveNarrativeRangePreview(document, selection.documentHash, { ...selection, ...patch }), { ok: false, reason: "INVALID_INTERVAL" });
  }
});
test("stops at exclusive end, outside interval, changed revision or invalid playhead", () => {
  const { document, selection } = fixture();
  const resolution = resolveNarrativeRangePreview(document, selection.documentHash, selection);
  assert.equal(resolution.ok, true);
  if (!resolution.ok) return;
  const range = resolution.range;
  assert.equal(shouldStopNarrativeRangePreview(range, selection.documentHash, range.startSeconds), false);
  assert.equal(shouldStopNarrativeRangePreview(range, selection.documentHash, range.endSeconds - 0.01), false);
  for (const seconds of [range.startSeconds - 0.01, range.endSeconds, range.endSeconds + 1, NaN]) {
    assert.equal(shouldStopNarrativeRangePreview(range, selection.documentHash, seconds), true);
  }
  assert.equal(shouldStopNarrativeRangePreview(range, "changed", range.startSeconds), true);
  assert.equal(shouldStopNarrativeRangePreview(range, null, range.startSeconds), true);
});
