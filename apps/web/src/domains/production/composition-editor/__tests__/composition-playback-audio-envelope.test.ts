import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { buildCompositionVolumeAutomations } from "../composition-audio-mix.service";
import { buildCompositionPlaybackVolumeAutomations, resolvePlaybackVolume } from "../composition-playback-audio-envelope";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS } from "../composition-preview-compiler.service";
import { buildAudioReferenceMixPlan, mixAudioReferencePcm } from "../qa/composition-audio-reference-mix";

const assetId = "70000000-0000-4000-8000-000000000001";
function fixture() {
  const document = createInitialCompositionDocument({ animatedDeck: null, assets: [{ productionAssetId: assetId,
    checksum: "a".repeat(64), fileSizeBytes: 100, durationSeconds: 3, mimeType: "video/mp4", hasAudio: true, publicUrl: null,
    storageBucket: "production-assets", storagePath: "media/source", timelineRole: "AVATAR" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 3, subtitle: "Crossfade", title: "Crossfade" } });
  const first = document.clips[0]!; first.durationSeconds = 1.5;
  document.clips.push({ ...first, id: "second-video", hfId: "second-video", startSeconds: 1.5, sourceOffsetSeconds: 1.5 });
  document.transitions = { schemaVersion: 1, items: [{ id: "audio-crossfade", fromClipId: first.id, toClipId: "second-video",
    durationSeconds: 0.2, type: "CROSS_DISSOLVE", alignment: "CENTER_AT_CUT", audioMode: "CROSSFADE", easing: "power1.inOut", origin: "USER" }] };
  return document;
}
test("linear crossfade has exact endpoints and complementary gains independent of visual easing", () => {
  const document = fixture(); const envelopes = buildCompositionPlaybackVolumeAutomations(document);
  assert.equal(envelopes.length, 2);
  const outgoing = envelopes.find((envelope) => envelope.targetClipId === document.clips[0]!.id)!;
  const incoming = envelopes.find((envelope) => envelope.targetClipId === "second-video")!;
  assert.equal(resolvePlaybackVolume(outgoing.points, 1.4, 1), 1);
  assert.equal(resolvePlaybackVolume(incoming.points, 1.4, 1), 0);
  assert.equal(resolvePlaybackVolume(outgoing.points, 1.6, 1), 0);
  for (const time of [1.425, 1.45, 1.5, 1.55, 1.575]) {
    assert.ok(Math.abs(resolvePlaybackVolume(outgoing.points, time, 1) + resolvePlaybackVolume(incoming.points, time, 1) - 1) < 1e-12);
  }
  document.transitions!.items[0]!.easing = "sine.inOut";
  assert.deepEqual(buildCompositionPlaybackVolumeAutomations(document), envelopes);
});
test("authored fades multiply crossfade instead of overriding it and stay bounded", () => {
  const document = fixture(); document.clips[0]!.fadeOutSeconds = 0.5; document.clips[1]!.fadeInSeconds = 0.5;
  const envelopes = buildCompositionPlaybackVolumeAutomations(document);
  assert.ok(Math.abs(resolvePlaybackVolume(envelopes[0]!.points, 1.45, 1) - 0.075) < 1e-12);
  assert.equal(resolvePlaybackVolume(envelopes[0]!.points, 1.5, 1), 0);
  assert.ok(Math.abs(resolvePlaybackVolume(envelopes[1]!.points, 1.55, 1) - 0.075) < 1e-12);
  assert.ok(envelopes.every((envelope) => envelope.points.every((point) => point.volume >= 0 && point.volume <= 1)));
});
test("CUT and documents without crossfade preserve original fade/duck automation", () => {
  const document = fixture(); document.transitions!.items[0]!.audioMode = "CUT"; document.clips[0]!.fadeOutSeconds = 0.5;
  assert.deepEqual(buildCompositionPlaybackVolumeAutomations(document), buildCompositionVolumeAutomations(document));
  delete document.transitions;
  assert.deepEqual(buildCompositionPlaybackVolumeAutomations(document), buildCompositionVolumeAutomations(document));
});
test("extended incoming handle samples the matching earlier source time", () => {
  const document = fixture(); const plan = buildAudioReferenceMixPlan(document);
  const source = Buffer.alloc(3 * 8000 * 8);
  for (let frame = 0; frame < 24000; frame++) {
    const sample = frame / 24000 * 0.25; source.writeFloatLE(sample, frame * 8); source.writeFloatLE(-sample, frame * 8 + 4);
  }
  const samples = mixAudioReferencePcm(plan, new Map([[assetId, source]])).pcm;
  assert.ok(Math.abs(samples.readFloatLE(12000 * 8) - 0.125) < 1e-6);
  assert.ok(Math.abs(samples.readFloatLE(12000 * 8 + 4) + 0.125) < 1e-6);
});
test("preview and render serialize exactly the envelope used by the audio reference, without competing tweens", async () => {
  const document = fixture(); document.clips[0]!.fadeOutSeconds = 0.5;
  const expected = buildCompositionPlaybackVolumeAutomations(document);
  const urls = new Map([[assetId, "media/local.mp4"]]);
  for (const target of [COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW, COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER]) {
    const html = await compileCompositionPreview({ document, assetUrls: urls, target });
    assert.deepEqual(JSON.parse(html.match(/const volumeAutomations = (\[[^;]+\]);/)![1]!), expected);
    assert.match(html, /window\.__courseforgeAudioEnvelopeVersion = 2/);
    assert.doesNotMatch(html, /targetTimeline\.fromTo\(\s*(?:fromAudio|toAudio)/);
  }
  const plan = buildAudioReferenceMixPlan(document);
  for (const clip of plan.clips) assert.deepEqual(clip.points, expected.find((envelope) => envelope.targetClipId === clip.clipId)!.points);
});
