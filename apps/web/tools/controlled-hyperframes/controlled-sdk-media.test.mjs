import assert from "node:assert/strict";
import test from "node:test";
import {prepareControlledSdkMedia} from "./controlled-sdk-media.mjs";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {dirname, resolve} from "node:path";

function fixture(overrides = {}) {
  const video = {id: "video", src: "assets/source.mp4", start: 0, end: 8, mediaStart: 1};
  const audio = {...video, id: "video-audio", type: "video", volume: 0.8};
  const engine = {parseVideoElements: () => [video], parseAudioElements: () => [audio],
    extractAllVideoFrames: async () => ({success: true, errors: [], totalFramesExtracted: 200,
      extracted: [{videoId: "video", totalFrames: 200, metadata: {width: 1920, height: 1080}}]}),
    createFrameLookupTable: () => ({}), createVideoFrameInjector: () => async () => {},
    processCompositionAudio: async (tracks) => {
      assert.equal(tracks[0].volumeKeyframes.length, 200);
      assert.deepEqual(tracks[0].volumeKeyframes[20], {time: 0.8, volume: 0.5});
      return {success: true, tracksProcessed: 1};
    }, ...overrides};
  return {engine, html: "authored fixture", projectDirectory: "/synthetic", workDirectory: "/synthetic/work",
    fps: 25, durationSeconds: 8, expectedVideoCount: 1, expectedAudioCount: 1};
}

test("SDK media requires exact manifests and refuses non-local sources before extraction", async () => {
  await assert.rejects(prepareControlledSdkMedia({...fixture(), expectedVideoCount: 2}), /MANIFEST_MISMATCH/);
  await assert.rejects(prepareControlledSdkMedia(fixture({parseVideoElements: () => [
    {id: "video", src: "https://example.invalid/source.mp4", start: 0, end: 8, mediaStart: 1}]})), /SOURCE_INVALID/);
  await assert.rejects(prepareControlledSdkMedia(fixture({extractAllVideoFrames: async () => ({success: true,
    errors: [{kind: "source_missing"}], extracted: []})})), /EXTRACTION_SOURCE_MISSING/);
});
test("SDK extraction and mixing receive the same cancellation signal and remaining budget", async () => {
  const external = new AbortController(); let remaining = 2000, extracted = false, mixed = false;
  const base = fixture();
  const input = {...fixture({extractAllVideoFrames: async (...args) => {
    assert.equal(args[3], external.signal); assert.equal(args[4].ffmpegProcessTimeout, 2000); extracted = true;
    return base.engine.extractAllVideoFrames(...args);
  }, processCompositionAudio: async (...args) => {
    assert.equal(args[5], external.signal); assert.equal(args[6].ffmpegProcessTimeout, 250); mixed = true;
    return base.engine.processCompositionAudio(...args);
  }}), signal: external.signal, remainingMilliseconds: () => remaining};
  const media = await prepareControlledSdkMedia(input);
  for (let index = 0; index < 200; index++) await media.beforeCapture({evaluate: async () => [{id: "video-audio", volume: 0.5}]}, index / 25);
  remaining = 250; await media.mix(); assert.equal(extracted, true); assert.equal(mixed, true);
  external.abort(); await assert.rejects(media.mix(), /ABORTED/);
  await assert.rejects(media.beforeCapture({evaluate: async () => {assert.fail("must not evaluate");}}, 0), /ABORTED/);
});
test("SDK media rejects exhausted budgets and abort before extraction", async () => {
  for (const remaining of [0, NaN, 0.5]) await assert.rejects(prepareControlledSdkMedia({...fixture(),
    remainingMilliseconds: () => remaining}), /BUDGET_INVALID/);
  const external = new AbortController(); external.abort();
  await assert.rejects(prepareControlledSdkMedia({...fixture({extractAllVideoFrames: async () => {assert.fail("must not extract");}}),
    signal: external.signal}), /ABORTED/);
});

test("SDK media refuses incomplete or out-of-order capture and preserves observed volume samples", async () => {
  const media = await prepareControlledSdkMedia(fixture());
  await assert.rejects(media.mix(), /SEQUENCE_INCOMPLETE/);
  const page = {evaluate: async () => [{id: "video-audio", volume: 0.5}]};
  await assert.rejects(media.beforeCapture(page, 0.04), /SEQUENCE_INVALID/);
  for (let index = 0; index < 200; index++) await media.beforeCapture(page, index / 25);
  const mixed = await media.mix();
  assert.equal(mixed.sampledFrames, 200); assert.equal(mixed.tracksProcessed, 1);
  assert.match(mixed.envelopeSha256, /^[a-f0-9]{64}$/);
  await assert.rejects(media.beforeCapture(page, 8), /SEQUENCE_INVALID/);
});

test("SDK media rejects missing audio targets and dropped tracks rather than accepting a silent result", async () => {
  const media = await prepareControlledSdkMedia(fixture({processCompositionAudio: async () => ({success: true, tracksProcessed: 0})}));
  await assert.rejects(media.beforeCapture({evaluate: async () => [{id: "video-audio", volume: null}]}, 0), /VOLUME_INVALID/);
  for (let index = 0; index < 200; index++) await media.beforeCapture({evaluate: async () => [{id: "video-audio", volume: 0.8}]}, index / 25);
  await assert.rejects(media.mix(), /AUDIO_MIX_FAILED/);
});

test("reverse seeks are opt-in after full capture and do not rewrite the audio envelope", async () => {
  const media = await prepareControlledSdkMedia(fixture());
  assert.throws(() => media.beginRepeatability(), /SEQUENCE_INCOMPLETE/);
  const forward = {evaluate: async () => [{id: "video-audio", volume: 0.5}]};
  for (let frame = 0; frame < 200; frame++) await media.beforeCapture(forward, frame / 25);
  media.beginRepeatability();
  assert.throws(() => media.beginRepeatability(), /SEQUENCE_INCOMPLETE/);
  const reverse = {evaluate: async () => [{id: "video-audio", volume: 0.1}]};
  for (const time of [8, 7.96, 3, 0]) await media.beforeCapture(reverse, time);
  for (const time of [NaN, -1, 8.04, 0.001]) await assert.rejects(media.beforeCapture(reverse, time), /SEQUENCE_INVALID/);
  const result = await media.mix();
  assert.equal(result.sampledFrames, 200);
});

test("real compiler emits finite audio windows understood by the public SDK for every video recipe", async () => {
  const web = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const require = createRequire(`${web}/package.json`);
  const domain = `${web}/.tmp/hyperframes-tests/domains/production/composition-editor`;
  const {buildVideoConformanceCorpusCase, listVideoConformanceCorpusRecipes} = require(`${domain}/qa/composition-video-conformance-corpus.js`);
  const {compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS} = require(`${domain}/composition-preview-compiler.service.js`);
  const engine = await import("@hyperframes/engine");
  for (const fps of [24, 25, 30, 60]) for (const recipeId of listVideoConformanceCorpusRecipes()) {
    const fixture = buildVideoConformanceCorpusCase(recipeId, {id: "27000000-0000-4000-8000-000000000004",
      checksum: "a".repeat(64), sizeBytes: 100, durationSeconds: 10, fps, width: 1920, height: 1080, hasAudio: true, mimeType: "video/mp4"});
    const html = await compileCompositionPreview({document: fixture.document, target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER,
      assetUrls: new Map([[fixture.source.id, "assets/source.mp4"]])});
    const audio = engine.parseAudioElements(html);
    assert.equal(audio.length, fixture.document.clips.length);
    for (const track of audio) {
      assert.ok(Number.isFinite(track.end) && track.end > track.start, `${recipeId}:${track.id}`);
      assert.equal(track.src, "assets/source.mp4");
    }
    // Exercise the complete adapter with real parser output; no browser/decoder calls in this contract test.
    const videos = engine.parseVideoElements(html);
    let extractedOptions, mixedTracks;
    const media = await prepareControlledSdkMedia({engine: {...engine,
      extractAllVideoFrames: async (_videos, _project, options) => {
        extractedOptions = options;
        return {success: true, errors: [], totalFramesExtracted: 8 * fps,
          extracted: videos.map(video => ({videoId: video.id, totalFrames: Math.ceil((video.end - video.start) * fps),
            metadata: {width: 1920, height: 1080}}))};
      },
      createFrameLookupTable: () => ({}), createVideoFrameInjector: () => async () => {},
      processCompositionAudio: async (tracks) => {
        mixedTracks = tracks; return {success: true, tracksProcessed: tracks.length};
      }}, html, fps, durationSeconds: 8, expectedVideoCount: videos.length, expectedAudioCount: audio.length,
      projectDirectory: "/synthetic", workDirectory: "/synthetic/work"});
    assert.equal(extractedOptions.timelineEnd, 8);
    assert.deepEqual(media.videoIds, videos.map(video => video.id));
    const page = {evaluate: async () => audio.map(track => ({id: track.id, volume: 0.8}))};
    for (let frame = 0; frame < 8 * fps; frame++) await media.beforeCapture(page, frame / fps);
    const mixed = await media.mix();
    assert.equal(mixed.sampledFrames, 8 * fps);
    assert.equal(mixed.tracksProcessed, audio.length);
    assert.ok(mixedTracks.every(track => track.volumeKeyframes.length === 8 * fps), recipeId);
  }
});
