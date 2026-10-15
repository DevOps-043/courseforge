import assert from "node:assert/strict";
import test from "node:test";
import { compositionVolumeEnvelopeSchema, evaluateVolumeEnvelope } from "../composition-volume-envelope";
import { buildCompositionPlaybackVolumeAutomations, resolvePlaybackVolume } from "../composition-playback-audio-envelope";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "../composition-document.types";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS } from "../composition-preview-compiler.service";
import { applyAuthoredVolumeEnvelopes } from "../composition-authored-volume";
import { buildVolumeEnvelopePath } from "../composition-volume-envelope-projection";

function fixture(): CompositionEditorDocument {
  return compositionEditorDocumentSchema.parse({ format: "courseforge-composition-v2", canvas: { width: 1280, height: 720, fps: 30, durationSeconds: 10 },
    clips: [{ id: "voice", hfId: "voice", kind: "AUDIO", trackId: "voice", label: "Voz", startSeconds: 0,
      durationSeconds: 10, sourceOffsetSeconds: 0, source: { type: "PRODUCTION_ASSET", productionAssetId: "00000000-0000-4000-8000-000000000001" }, volume: 0.8,
      timingSource: "USER_EDITED", layout: { x: 0, y: 0, width: 1280, height: 720 },
      volumeEnvelope: [{ sourceTimeSeconds: 0, gain: 1 }, { sourceTimeSeconds: 5, gain: 0.25 }, { sourceTimeSeconds: 10, gain: 1 }] }],
    tracks: [{ id: "voice", kind: "AUDIO", semanticRole: "VOICE", label: "Voz", order: 0, volume: 0.5 }], deckStyles: null,
    variables: { accent: "#38bdf8", title: "Audio", subtitle: "" },
  });
}

test("validates unique finite bounded points without implicit endpoint silence", () => {
  assert.equal(evaluateVolumeEnvelope([], 0), 1);
  assert.equal(evaluateVolumeEnvelope([{ sourceTimeSeconds: 5, gain: 0.5 }], 0), 0.5);
  assert.equal(evaluateVolumeEnvelope([{ sourceTimeSeconds: 5, gain: 0.5 }], 100), 0.5);
  assert.equal(compositionVolumeEnvelopeSchema.safeParse([{ sourceTimeSeconds: 1, gain: 1 }, { sourceTimeSeconds: 1, gain: 0 }]).success, false);
  assert.equal(compositionVolumeEnvelopeSchema.safeParse([{ sourceTimeSeconds: 0, gain: NaN }]).success, false);
});

test("composes authored gain with track/clip volume and fades deterministically", () => {
  const document = fixture(); document.clips[0].fadeInSeconds = 2;
  const [automation] = buildCompositionPlaybackVolumeAutomations(document);
  assert.equal(resolvePlaybackVolume(automation.points, 0, automation.baselineVolume), 0);
  assert.ok(Math.abs(resolvePlaybackVolume(automation.points, 5, automation.baselineVolume) - 0.1) < 1e-9);
  assert.deepEqual(buildCompositionPlaybackVolumeAutomations(document), buildCompositionPlaybackVolumeAutomations(document));
});

test("split preserves source-anchored gain at both new boundaries; locked edits fail", () => {
  const document = fixture();
  const split = applyCompositionEditorPatches(document, [{ type: "clip.split", clipId: "voice", newClipId: "voice-right", newHfId: "voice-right", atSeconds: 5 }]);
  const automations = buildCompositionPlaybackVolumeAutomations(split);
  for (const automation of automations) assert.ok(Math.abs(resolvePlaybackVolume(automation.points, 5, automation.baselineVolume) - 0.1) < 1e-9);
  document.tracks[0].locked = true;
  assert.throws(() => applyCompositionEditorPatches(document, [{ type: "clip.volume-envelope", clipId: "voice", points: [] }]));
});

test("preview and render serialize identical authored levels; trim retains source-time gain", async () => {
  const document = fixture();
  const trimmed = applyCompositionEditorPatches(document, [{ type: "clip.trim", clipId: "voice", startSeconds: 0, sourceOffsetSeconds: 5, durationSeconds: 5 }]);
  const expected = buildCompositionPlaybackVolumeAutomations(trimmed);
  assert.ok(Math.abs(resolvePlaybackVolume(expected[0].points, 0, expected[0].baselineVolume) - 0.1) < 1e-9);
  for (const target of [COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW, COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER]) {
    const html = await compileCompositionPreview({ document: trimmed,
      assetUrls: new Map([[document.clips[0].source.type === "PRODUCTION_ASSET" ? document.clips[0].source.productionAssetId : "", "media/voice.mp3"]]), target });
    assert.deepEqual(JSON.parse(html.match(/const volumeAutomations = (\[[^;]+\]);/)![1]), expected);
  }
});

test("an extended transition handle evaluates the earlier source gain instead of holding the cut value", () => {
  const document = fixture();
  document.clips[0].startSeconds = 5; document.clips[0].durationSeconds = 5; document.clips[0].sourceOffsetSeconds = 5;
  const [automation] = applyAuthoredVolumeEnvelopes(document, [], new Map([["voice", { startSeconds: 4, endSeconds: 10 }]]));
  // Source t=4 has gain .4; the clip and track baseline is .4.
  assert.ok(Math.abs(resolvePlaybackVolume(automation.points, 4, automation.baselineVolume) - 0.16) < 1e-9);
});

test("resetting an asset removes authored gain together with static volume and fades", () => {
  const document = fixture(); document.clips[0].sourceDurationSeconds = 10;
  const reset = applyCompositionEditorPatches(document, [{ type: "clip.reset-asset", clipId: "voice" }]);
  assert.equal(reset.clips[0].volumeEnvelope, undefined);
});

test("authoring is gated while persisted curves and removal remain available", () => {
  const previous = process.env.NEXT_PUBLIC_COMPOSITION_VOLUME_ENVELOPE_ENABLED;
  try {
    delete process.env.NEXT_PUBLIC_COMPOSITION_VOLUME_ENVELOPE_ENABLED;
    assert.throws(() => applyCompositionEditorPatches(fixture(), [{ type: "clip.volume-envelope", clipId: "voice", points: [{ sourceTimeSeconds: 0, gain: 0.5 }] }]), /habilitada/);
    assert.equal(buildCompositionPlaybackVolumeAutomations(fixture()).length, 1);
    assert.deepEqual(applyCompositionEditorPatches(fixture(), [{ type: "clip.volume-envelope", clipId: "voice", points: [] }]).clips[0].volumeEnvelope, []);
    process.env.NEXT_PUBLIC_COMPOSITION_VOLUME_ENVELOPE_ENABLED = "true";
    assert.equal(applyCompositionEditorPatches(fixture(), [{ type: "clip.volume-envelope", clipId: "voice", points: [{ sourceTimeSeconds: 0, gain: 0.5 }] }]).clips[0].volumeEnvelope?.[0].gain, 0.5);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_COMPOSITION_VOLUME_ENVELOPE_ENABLED;
    else process.env.NEXT_PUBLIC_COMPOSITION_VOLUME_ENVELOPE_ENABLED = previous;
  }
});

test("the graph retains a brief attenuation between uniform sampling positions", () => {
  const points = [{ sourceTimeSeconds: 0, gain: 1 }, { sourceTimeSeconds: 5.001, gain: 1 },
    { sourceTimeSeconds: 5.002, gain: 0 }, { sourceTimeSeconds: 5.003, gain: 1 }];
  assert.match(buildVolumeEnvelopePath(points, 0, 10, 100), /L[^ ]+ 100/);
});
