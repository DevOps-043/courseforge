import assert from "node:assert/strict";
import test from "node:test";
import { extractNarrativeCaptionInterval } from "../composition-narrative-caption-extraction";
import { compositionNativeCaptionSourceSchema } from "../composition-text-layer.types";

const source = compositionNativeCaptionSourceSchema.parse({ type: "NATIVE_CAPTIONS", origin: "MANUAL", language: "es", style: { fontSize: 45 }, cues: [
  { id: "manual", startSeconds: 1, endSeconds: 4, text: "Texto corregido manualmente", words: [
    { id: "word-one", startSeconds: 1, endSeconds: 2, text: "Texto" }, { id: "word-two", startSeconds: 2, endSeconds: 4, text: "corregido" }] },
  { id: "later", startSeconds: 5, endSeconds: 6, text: "Después" },
] });
const commandId = "11111111-1111-4111-8111-111111111111";
test("caption interval preserves manual text and style, intersects cues/words and warns about partial content", () => {
  const before = structuredClone(source);
  const result = extractNarrativeCaptionInterval({ source, startSeconds: 1.5, endSeconds: 3, commandId, clipOrdinal: 0 });
  assert.equal(result.source?.origin, "MANUAL"); assert.deepEqual(result.source?.style, source.style);
  assert.equal(result.source?.cues[0]?.text, "Texto corregido manualmente");
  assert.equal(result.source?.cues[0]?.startSeconds, 0); assert.equal(result.source?.cues[0]?.endSeconds, 1.5);
  assert.deepEqual(result.source?.cues[0]?.words?.map(word => [word.startSeconds, word.endSeconds]), [[0, 0.5], [0.5, 1.5]]);
  assert.deepEqual(result.warnings.map(warning => warning.kind), ["CUE_CUT", "WORD_CUT", "WORD_CUT"]);
  assert.deepEqual(source, before);
});
test("exclusive-end cues are excluded and IDs are deterministic but distinct per extracted layer", () => {
  const params = { source, startSeconds: 4, endSeconds: 5, commandId, clipOrdinal: 0 };
  assert.equal(extractNarrativeCaptionInterval(params).source, null);
  const first = extractNarrativeCaptionInterval({ ...params, startSeconds: 1, endSeconds: 4 });
  assert.deepEqual(extractNarrativeCaptionInterval({ ...params, startSeconds: 1, endSeconds: 4 }), first);
  assert.deepEqual(first.warnings, []);
  assert.notEqual(extractNarrativeCaptionInterval({ ...params, startSeconds: 1, endSeconds: 4, clipOrdinal: 1 }).source?.cues[0]?.id, first.source?.cues[0]?.id);
});
test("invalid intervals and identifiers fail instead of returning misleading captions", () => {
  for (const patch of [{ startSeconds: -1 }, { endSeconds: NaN }, { endSeconds: 1 }, { commandId: "invalid" }, { clipOrdinal: 101 }]) {
    assert.throws(() => extractNarrativeCaptionInterval({ source, startSeconds: 1, endSeconds: 4, commandId, clipOrdinal: 0, ...patch }));
  }
});
