import assert from "node:assert/strict";
import test from "node:test";
import { buildMediaConformanceCorpusCase } from "../qa/composition-media-conformance-corpus";
import { NATIVE_CONFORMANCE_CORPUS_FPS } from "../qa/composition-native-conformance-corpus";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS } from "../composition-preview-compiler.service";
import { buildAudioReferenceMixPlan } from "../qa/composition-audio-reference-mix";

const recipes = ["narrative-voice-extraction", "narrative-audiovisual-captions"] as const;
test("extraction corpus retains source, appends source-aligned copy and preserves manual captions", () => {
  for (const recipe of recipes) {
    const fixture = buildMediaConformanceCorpusCase(recipe, 25);
    const original = fixture.document.clips.find(clip => clip.sceneId === "corpus-narrative-scene")!;
    const copies = fixture.document.clips.filter(clip => clip.id.startsWith("voice-extract-") || clip.id.startsWith("fragment-"));
    assert.equal(original.startSeconds, 1); assert.equal(original.durationSeconds, 4); assert.equal(original.sourceOffsetSeconds, 1);
    assert.equal(fixture.document.canvas.durationSeconds, 9);
    const voiceCopy = copies.find(clip => clip.kind === "AUDIO")!;
    assert.equal(voiceCopy.startSeconds, 8); assert.equal(voiceCopy.durationSeconds, 1); assert.equal(voiceCopy.sourceOffsetSeconds, 2);
    assert.deepEqual(voiceCopy.source, original.source); assert.equal(voiceCopy.sceneId, undefined);
    assert.equal(copies.length, recipe === "narrative-voice-extraction" ? 1 : 3);
    if (recipe === "narrative-audiovisual-captions") {
      const caption = copies.find(clip => clip.source.type === "NATIVE_CAPTIONS")!;
      assert.ok(caption.source.type === "NATIVE_CAPTIONS");
      assert.equal(caption.source.cues[0]!.text, "Manual caption preserved");
      assert.equal(caption.source.cues[0]!.startSeconds, 0); assert.equal(caption.source.cues[0]!.endSeconds, 1);
      assert.equal(caption.source.cues[0]!.words![0]!.startSeconds, 0);
      assert.equal(caption.source.cues[0]!.words![0]!.endSeconds, 0.5);
    }
    const mix = buildAudioReferenceMixPlan(fixture.document);
    assert.ok(mix.clips.some(clip => clip.startSeconds === 8 && clip.sourceOffsetSeconds === 2 && clip.durationSeconds === 1));
  }
});
test("existing compiler accepts extraction cases in preview/render targets across all corpus FPS", async () => {
  for (const recipe of recipes) for (const fps of NATIVE_CONFORMANCE_CORPUS_FPS) {
    const fixture = buildMediaConformanceCorpusCase(recipe, fps);
    const assetUrls = new Map(fixture.assets.map(asset => [asset.id, `data:${asset.mimeType};base64,${asset.bytes.toString("base64")}`]));
    for (const target of Object.values(COMPOSITION_COMPILATION_TARGETS)) {
      const html = await compileCompositionPreview({ document: fixture.document, documentHash: fixture.documentHash, assetUrls, target });
      for (const clip of fixture.document.clips) assert.ok(html.includes(clip.hfId));
    }
    assert.equal(fixture.scope, "DETERMINISTIC_MEDIA_DOCUMENT_RECIPE_NOT_RENDER_EVIDENCE");
  }
});
