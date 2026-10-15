import assert from "node:assert/strict";
import test from "node:test";
import { createTransitionDocument } from "./composition-transition-test-fixtures";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { compositionEditorDocumentSchema, NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT } from "../composition-document.types";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS } from "../composition-preview-compiler.service";

function fixture(kind: "TEXT" | "CAPTION") {
  const document = createTransitionDocument();
  const { clip, track } = createCompositionNativeOverlay({ document, id: "overlay", kind, playheadSeconds: 1 });
  if (track) document.tracks.push(track);
  document.clips.push(clip);
  document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  if (clip.source.type === "NATIVE_CAPTIONS") {
    clip.source.cues = [{ id: "cue", text: "Hola mundo", startSeconds: 0, endSeconds: 5,
      words: [{ id: "hola", text: "Hola", startSeconds: 0, endSeconds: 2.5 },
        { id: "mundo", text: "mundo", startSeconds: 2.5, endSeconds: 5 }] }];
  }
  return { document, clip };
}

for (const kind of ["TEXT", "CAPTION"] as const) {
  test(`splits ${kind} into independently editable fragments preserving presentation`, () => {
    const { document, clip } = fixture(kind);
    const original = structuredClone(document);
    const result = applyCompositionEditorPatches(document, [{ type: "clip.split", clipId: clip.id,
      atSeconds: 3, newClipId: "right", newHfId: "right" }]);
    const left = result.clips.find((item) => item.id === clip.id)!;
    const right = result.clips.find((item) => item.id === "right")!;
    assert.deepEqual([left.startSeconds, left.durationSeconds, right.startSeconds, right.durationSeconds], [1, 2, 3, 3]);
    assert.deepEqual(right.layout, clip.layout);
    assert.equal(right.trackId, clip.trackId);
    assert.equal(right.sourceOffsetSeconds, undefined);
    if (left.source.type === "NATIVE_CAPTIONS" && right.source.type === "NATIVE_CAPTIONS") {
      assert.equal(left.source.cues[0]!.endSeconds, 2);
      assert.deepEqual(right.source.cues[0]!.words!.map((word) => [word.startSeconds, word.endSeconds]), [[0, 0.5], [0.5, 3]]);
      assert.equal(right.source.cues[0]!.text, "Hola mundo");
    } else {
      assert.deepEqual(right.source, clip.source);
    }
    assert.deepEqual(document, original);
    assert.ok(compositionEditorDocumentSchema.safeParse(result).success);
    const edited = applyCompositionEditorPatches(result, [{ type: "clip.text-style", clipId: "right", style: { color: "#ff0000" } }]);
    const editedRight = edited.clips.find((item) => item.id === "right")!;
    assert.ok(editedRight.source.type === "NATIVE_TEXT" || editedRight.source.type === "NATIVE_CAPTIONS");
    assert.equal(editedRight.source.style.color, "#ff0000");
    assert.deepEqual(edited.clips.find((item) => item.id === clip.id)!.source, left.source);
  });
}

for (const ripple of [false, true]) {
  for (const [startSeconds, endSeconds] of [[1, 3], [3, 4], [4, 6]]) {
    test(`removes caption interval ${startSeconds}-${endSeconds}, ripple=${ripple}`, () => {
      const { document, clip } = fixture("CAPTION");
      const result = applyCompositionEditorPatches(document, [{ type: "clip.remove-range", clipId: clip.id,
        startSeconds, endSeconds, ripple, newClipId: "right", newHfId: "right" }]);
      assert.ok(compositionEditorDocumentSchema.safeParse(result).success);
      const retained = result.clips.filter((item) => item.kind === "CAPTION");
      assert.equal(retained.reduce((sum, item) => sum + item.durationSeconds, 0), 5 - (endSeconds - startSeconds));
      for (const fragment of retained) {
        assert.equal(fragment.sourceOffsetSeconds, undefined);
        if (fragment.source.type !== "NATIVE_CAPTIONS") throw new Error("Expected caption");
        assert.equal(fragment.source.cues[0]!.startSeconds, 0);
        assert.equal(fragment.source.cues[0]!.endSeconds, fragment.durationSeconds);
      }
      if (startSeconds === 3) assert.equal(retained.find((item) => item.id === "right")!.startSeconds, ripple ? 3 : 4);
    });
  }
}

test("splits across silent gaps without inventing captions and supports repeated cuts", () => {
  const { document, clip } = fixture("CAPTION");
  if (clip.source.type !== "NATIVE_CAPTIONS") throw new Error("Expected caption");
  clip.source.cues = [{ id: "late", text: "Después", startSeconds: 3, endSeconds: 5 }];
  const split = applyCompositionEditorPatches(document, [{ type: "clip.split", clipId: clip.id,
    atSeconds: 3, newClipId: "right", newHfId: "right" }]);
  const left = split.clips.find((item) => item.id === clip.id)!;
  assert.equal(left.source.type === "NATIVE_CAPTIONS" && left.source.cues.length, 0);
  const repeated = applyCompositionEditorPatches(split, [{ type: "clip.split", clipId: "right",
    atSeconds: 5, newClipId: "last", newHfId: "last" }]);
  assert.ok(compositionEditorDocumentSchema.safeParse(repeated).success);
});

test("native cuts respect locked tracks and reject boundary cuts atomically", () => {
  const { document, clip } = fixture("TEXT");
  const operation = { type: "clip.split" as const, clipId: clip.id, atSeconds: 3, newClipId: "right", newHfId: "right" };
  assert.throws(() => applyCompositionEditorPatches(document, [{ ...operation, atSeconds: 1 }]), /frame/);
  document.tracks.find((track) => track.id === clip.trackId)!.locked = true;
  assert.throws(() => applyCompositionEditorPatches(document, [operation]), /bloqueado/);
});

test("preview and export compile identical caption timing after a split", async () => {
  const { document, clip } = fixture("CAPTION");
  const split = applyCompositionEditorPatches(document, [{ type: "clip.split", clipId: clip.id,
    atSeconds: 3, newClipId: "right", newHfId: "right" }]);
  const assetUrls = new Map(split.clips.flatMap((item) => item.source.type === "PRODUCTION_ASSET"
    ? [[item.source.productionAssetId, "https://assets.test/video.mp4"] as const] : []));
  const preview = await compileCompositionPreview({ document: split, assetUrls });
  const render = await compileCompositionPreview({ document: split, assetUrls, target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER });
  const metadata = (html: string) => JSON.parse(html.match(/const clips = (\[[^\n]+\]);/)![1]!) as Array<{id: string; captionCues: Array<{start: number; end: number}>}>;
  assert.deepEqual(metadata(preview), metadata(render));
  assert.deepEqual(metadata(preview).find((item) => item.id === "right")!.captionCues.map(({ start, end }) => [start, end]), [[3, 6]]);
});
