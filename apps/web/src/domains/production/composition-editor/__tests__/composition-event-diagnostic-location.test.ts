import assert from "node:assert/strict";
import test from "node:test";
import { prepareEventDiagnosticLocations, eventDiagnosticLocationSchema, eventDiagnosticClipHash, EVENT_DIAGNOSTIC_MAX_CLIP_REFERENCES } from "../qa/composition-event-diagnostic-location";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT } from "../composition-document.types";
import { buildVideoConformanceCorpusCase, listVideoConformanceCorpusRecipes } from "../qa/composition-video-conformance-corpus";
import { buildCompositionTransitionRuntime } from "../composition-transition-runtime";

function fixture() {
  const document = createInitialCompositionDocument({sourceInsertionMode: "MANUAL", animatedDeck: null, assets: [],
    plan: {title: "Diagnostic", subtitle: "Controlled", accentColor: "#38BDF8", durationSeconds: 10}});
  const {clip, track} = createCompositionNativeOverlay({document, id: "private-clip", kind: "TEXT", playheadSeconds: 1});
  if (track) document.tracks.push(track);
  clip.startSeconds = 1; clip.durationSeconds = 2; document.clips.push(clip);
  document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT; document.canvas.durationSeconds = 10;
  return document;
}
test("location uses exact frame time and half-open windows, without storing identifiers or text", () => {
  const document = fixture(), locate = prepareEventDiagnosticLocations(document), fps = document.canvas.fps;
  assert.deepEqual(locate(fps - 1).activeClipSha256, []);
  assert.deepEqual(locate(fps).activeClipSha256, [eventDiagnosticClipHash(document.clips[0]!.id)]);
  assert.deepEqual(locate(fps * 3).activeClipSha256, []);
  assert.equal(locate(fps + 1).timeSeconds, Number(((fps + 1) / fps).toFixed(6)));
  assert.equal(JSON.stringify(locate(fps)).includes("private-clip"), false);
  const before = locate(fps); document.clips[0]!.startSeconds = 5; document.canvas.fps = 60;
  assert.deepEqual(locate(fps), before);
  for (const frame of [-1, 0.5, NaN, Infinity, fps * 10]) assert.throws(() => locate(frame), /FRAME_INVALID/);
});
test("all transition alignments identify both runtime handles, not only nominal clip intervals", () => {
  for (const recipe of listVideoConformanceCorpusRecipes().filter((recipe) => recipe.startsWith("video-crossfade-"))) {
    const document = buildVideoConformanceCorpusCase(recipe, {id: "27000000-0000-4000-8000-000000000004", checksum: "a".repeat(64),
      sizeBytes: 1024, durationSeconds: 10, fps: 25, width: 1920, height: 1080, hasAudio: true, mimeType: "video/mp4"}).document;
    const runtime = buildCompositionTransitionRuntime(document), transition = runtime.items[0]!;
    const frame = Math.round((transition.startSeconds + transition.durationSeconds / 2) * document.canvas.fps);
    const location = prepareEventDiagnosticLocations(document)(frame);
    assert.equal(location.activeClipSha256.length, 2);
    assert.deepEqual(new Set(location.activeClipSha256), new Set(document.clips.map((clip) => eventDiagnosticClipHash(clip.id))));
  }
});
test("bounded references disclose omitted clips and never serialize private identifiers", () => {
  const document = fixture(), original = document.clips[0]!;
  document.clips = Array.from({length: EVENT_DIAGNOSTIC_MAX_CLIP_REFERENCES + 1}, (_, index) => {
    const clip = structuredClone(original); clip.id = `secret-clip-${index}`;
    clip.hfId = clip.id;
    return clip;
  });
  const location = prepareEventDiagnosticLocations(document)(document.canvas.fps);
  assert.equal(location.activeClipSha256.length, EVENT_DIAGNOSTIC_MAX_CLIP_REFERENCES);
  assert.equal(location.omittedClipCount, 1);
  assert.equal(JSON.stringify(location).includes("secret"), false);
  assert.equal(eventDiagnosticLocationSchema.safeParse({...location, timeSeconds: 2}).success, false);
  assert.equal(eventDiagnosticLocationSchema.safeParse({...location, activeClipSha256: [location.activeClipSha256[0]]}).success, false);
});
