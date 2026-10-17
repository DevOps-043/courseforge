import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildMediaConformanceCorpusCase, listMediaConformanceCorpusRecipes, MEDIA_CORPUS_REMAINING_REQUIREMENTS } from "../qa/composition-media-conformance-corpus";
import { NATIVE_CONFORMANCE_CORPUS_FPS } from "../qa/composition-native-conformance-corpus";
import { buildCompositionEventCheckpointPlan } from "../composition-conformance-event-checkpoints";
import { buildAudioReferenceMixPlan, mixAudioReferencePcm } from "../qa/composition-audio-reference-mix";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS } from "../composition-preview-compiler.service";

test("media recipes validate all FPS with real pinned bytes and deterministic identities", () => {
  let checked = 0;
  for (const recipe of listMediaConformanceCorpusRecipes()) for (const fps of NATIVE_CONFORMANCE_CORPUS_FPS) {
    const first = buildMediaConformanceCorpusCase(recipe, fps), second = buildMediaConformanceCorpusCase(recipe, fps);
    assert.equal(first.caseSha256, second.caseSha256);
    assert.deepEqual(first.document, second.document);
    assert.equal(first.scope, "DETERMINISTIC_MEDIA_DOCUMENT_RECIPE_NOT_RENDER_EVIDENCE");
    for (const asset of first.assets) {
      assert.equal(createHash("sha256").update(asset.bytes).digest("hex"), asset.checksum);
      if (asset.mimeType === "audio/wav") {
        assert.equal(asset.bytes.toString("ascii", 0, 4), "RIFF");
        assert.equal(asset.bytes.readUInt32LE(24), 8000);
        assert.equal(asset.bytes.readUInt16LE(22), 2);
        assert.equal(asset.bytes.readUInt32LE(40), asset.bytes.length - 44);
      }
    }
    const plan = buildCompositionEventCheckpointPlan(first.document), checkpoints = plan.batches.flat();
    assert.equal(checkpoints[0]!.frameIndex, 0);
    assert.equal(checkpoints.at(-1)!.frameIndex, Math.ceil(first.document.canvas.durationSeconds * fps) - 1);
    if (recipe === "audio-split") {
      assert.equal(first.document.clips.length, 2);
      assert.equal(first.document.clips[0]!.source.type, "PRODUCTION_ASSET");
      assert.deepEqual(first.document.clips[0]!.source, first.document.clips[1]!.source);
    }
    first.assets[0]!.bytes.fill(0);
    assert.equal(buildMediaConformanceCorpusCase(recipe, fps).assets[0]!.checksum, second.assets[0]!.checksum);
    checked++;
  }
  assert.equal(checked, listMediaConformanceCorpusRecipes().length * NATIVE_CONFORMANCE_CORPUS_FPS.length);
});

test("audio gain/fades/ducking/crossfade scenarios produce bounded deterministic source-model mixes, not playback approval", () => {
  for (const recipe of ["audio-gain", "audio-fades", "audio-ducking", "audio-crossfade", "audio-split", "audio-trim"]) {
    const fixture = buildMediaConformanceCorpusCase(recipe, 25), plan = buildAudioReferenceMixPlan(fixture.document);
    const sources = new Map(fixture.assets.map((asset) => [asset.id, asset.bytes.subarray(44)]));
    const first = mixAudioReferencePcm(plan, sources), second = mixAudioReferencePcm(plan, sources);
    assert.ok(first.pcm.equals(second.pcm));
    assert.equal(first.pcm.length, fixture.document.canvas.durationSeconds * 8000 * 8);
    assert.ok(plan.clips.length > 0);
    if (recipe === "audio-gain") assert.ok(plan.clips.some((clip) => Math.abs(clip.volume - 0.24) < 1e-8));
    if (recipe === "audio-fades") assert.ok(plan.clips.some((clip) => clip.points[0]!.volume === 0 && clip.points.at(-1)!.volume === 0));
    if (recipe === "audio-ducking") assert.ok(plan.clips.some((clip) => clip.points.some((point) => point.timeSeconds === 2 && point.volume < 0.25)));
    if (recipe === "audio-crossfade") {
      assert.equal(plan.clips.length, 2);
      assert.equal(new Set(plan.clips.map((clip) => clip.assetId)).size, 2);
      assert.equal(plan.clips[0]!.startSeconds, 0);
      assert.equal(plan.clips[1]!.startSeconds, 3.5);
      assert.equal(plan.clips[0]!.durationSeconds, 4.5);
      assert.equal(plan.clips[1]!.durationSeconds, 4.5);
      assert.ok(plan.clips[0]!.points.some((point) => point.timeSeconds === 4.5 && point.volume === 0));
      assert.ok(plan.clips[1]!.points.some((point) => point.timeSeconds === 3.5 && point.volume === 0));
      const checkpoints = buildCompositionEventCheckpointPlan(fixture.document).batches.flat();
      assert.ok(checkpoints.some((checkpoint) => checkpoint.reasons.some((reason) => reason.includes("fade-out-start"))));
      assert.ok(checkpoints.some((checkpoint) => checkpoint.reasons.some((reason) => reason.includes("fade-in-end"))));
      const voiceOnly = mixAudioReferencePcm(plan, new Map([
        [fixture.assets[0]!.id, sources.get(fixture.assets[0]!.id)!],
        [fixture.assets[1]!.id, Buffer.alloc(sources.get(fixture.assets[1]!.id)!.length)],
      ])).pcm;
      const overlap = first.pcm.subarray(4 * 8000 * 8, 4.1 * 8000 * 8);
      assert.notDeepEqual(overlap, voiceOnly.subarray(4 * 8000 * 8, 4.1 * 8000 * 8));
    }
    if (recipe === "audio-split") {
      assert.equal(plan.clips[1]!.sourceOffsetSeconds, 3);
      const original = sources.get(fixture.assets[0]!.id)!;
      // The mixer interpolates float time offsets: compare sample values at
      // float32 precision, not the representation of near-zero samples.
      for (let offset = 0; offset < first.pcm.length; offset += 4)
        assert.ok(Math.abs(first.pcm.readFloatLE(offset) - original.readFloatLE(offset)) <= 2 ** -23);
    }
    if (recipe === "audio-trim") {
      assert.ok(first.pcm.subarray(0, 8000 * 8).every((byte) => byte === 0));
      assert.equal(first.pcm.readFloatLE(8000 * 8), sources.get(fixture.assets[0]!.id)!.readFloatLE(8000 * 8));
      assert.ok(first.pcm.subarray(5 * 8000 * 8).every((byte) => byte === 0));
    }
  }
});

test("every media recipe compiles in both targets using actual bounded local bytes", async () => {
  for (const recipe of listMediaConformanceCorpusRecipes()) {
    const fixture = buildMediaConformanceCorpusCase(recipe, 25);
    const assetUrls = new Map(fixture.assets.map((asset) => [asset.id, `data:${asset.mimeType};base64,${asset.bytes.toString("base64")}`]));
    for (const target of [COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW, COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER]) {
      const html = await compileCompositionPreview({document: fixture.document, documentHash: fixture.documentHash, assetUrls, target});
      assert.ok(html.includes(fixture.document.clips[0]!.hfId));
    }
  }
});

test("remaining video render coverage stays explicit; unknown inputs fail closed", () => {
  assert.ok(MEDIA_CORPUS_REMAINING_REQUIREMENTS.includes("VIDEO_CROSSFADE_RENDER_MEASUREMENT"));
  assert.ok(MEDIA_CORPUS_REMAINING_REQUIREMENTS.includes("VIDEO_DECODE_SPLIT_TRIM_HANDLES"));
  assert.throws(() => buildMediaConformanceCorpusCase("video-crossfade", 25), /RECIPE_UNKNOWN/);
  assert.throws(() => buildMediaConformanceCorpusCase("audio-gain", 29 as 25), /FPS_INVALID/);
});
