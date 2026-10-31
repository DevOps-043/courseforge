import assert from "node:assert/strict";
import test from "node:test";
import { compositionEditorDocumentSchema } from "../composition-document.types";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { compositionEditorPatchOperationSchema } from "../editor-patch.types";
import { compositionDocumentHasAudibleMedia, resolveCompositionClipAudioVolume } from "../composition-clip-audio.service";
import { buildCompositionPlaybackVolumeAutomations } from "../composition-playback-audio-envelope";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS } from "../composition-preview-compiler.service";
import { buildCompositionPreviewScenePatch } from "../composition-preview-scene-patch";
import { buildCompositionPreviewVisualPatch } from "../composition-preview-visual-patch";
import { simulateCompositionAgentOperations } from "../composition-agent-simulation.service";
import { buildCompositionAgentDiff } from "../composition-agent-diff.service";
import { buildAudioReferenceMixPlan, mixAudioReferencePcm, AUDIO_REFERENCE_LIMITS } from "../qa/composition-audio-reference-mix";
import { createMasterVolumeFixture, MASTER_VOLUME_ASSET_IDS } from "./composition-master-volume.fixtures";
import { classifyCompositionAgentRisk } from "../composition-agent-risk.service";

const assetUrls = new Map(MASTER_VOLUME_ASSET_IDS.map(id => [id, `https://storage.test/${id}`]));

test("el lector conserva documentos anteriores y valida niveles y payloads del maestro", () => {
  const document = createMasterVolumeFixture();
  const json = JSON.stringify(document);
  assert.equal(JSON.stringify(compositionEditorDocumentSchema.parse(document)), json);
  assert.equal("masterVolume" in document.audioMix, false);
  for (const masterVolume of [-0.1, 1.01, Number.NaN, Number.POSITIVE_INFINITY, "0.5"]) {
    assert.equal(compositionEditorDocumentSchema.safeParse({ ...document, audioMix: { ...document.audioMix, masterVolume } }).success, false);
    assert.equal(compositionEditorPatchOperationSchema.safeParse({ type: "audio-mix.update", settings: { masterVolume } }).success, false);
  }
});

test("el patch guarda el maestro sin alterar pistas, clips ni ducking y permite deshacer", () => {
  const document = createMasterVolumeFixture();
  const operation = { type: "audio-mix.update" as const, settings: { masterVolume: 0.5 } };
  const result = simulateCompositionAgentOperations(document, [operation]);
  assert.equal(result.document.audioMix.masterVolume, 0.5);
  assert.deepEqual(result.document.tracks, document.tracks);
  assert.deepEqual(result.document.clips, document.clips);
  assert.deepEqual(result.document.audioMix.ducking, document.audioMix.ducking);
  assert.deepEqual(applyCompositionEditorPatches(result.document, result.inverseOperations), document);
  assert.ok(buildCompositionAgentDiff(document, result.document).some(change => change.path === "/audioMix/masterVolume"));
  const restored = applyCompositionEditorPatches(result.document, [{ ...operation, settings: { masterVolume: 1 } }]);
  assert.equal("masterVolume" in restored.audioMix, false);
  assert.deepEqual(restored, document);
});

test("el maestro atenúa toda fuente audible sin reactivar pistas muteadas", () => {
  const document = createMasterVolumeFixture();
  for (const clip of document.clips) {
    const track = document.tracks.find(candidate => candidate.id === clip.trackId)!;
    assert.equal(resolveCompositionClipAudioVolume(clip, track, 0.5), 0.2);
    assert.equal(resolveCompositionClipAudioVolume(clip, { ...track, muted: true }, 0.5), 0);
  }
  document.audioMix.masterVolume = 0;
  assert.equal(compositionDocumentHasAudibleMedia(document), false);
  document.audioMix.masterVolume = 1;
  assert.equal(compositionDocumentHasAudibleMedia(document), true);
});

test("silenciar toda la composición se clasifica como cambio de alto riesgo", () => {
  const risk = classifyCompositionAgentRisk([{ type: "audio-mix.update", settings: { masterVolume: 0 } }]);
  assert.equal(risk.level, "HIGH");
  assert.equal(risk.requiresReinforcedConfirmation, true);
});

test("los SFX participan en el maestro, la envolvente y la detección de audio", () => {
  const document = createMasterVolumeFixture();
  const clip = document.clips[0]!;
  clip.source = { type: "SOUND_EFFECT_ASSET", soundEffectAssetId: MASTER_VOLUME_ASSET_IDS[0] };
  clip.fadeInSeconds = 0.5;
  document.clips = [clip];
  document.tracks = document.tracks.filter(track => track.id === clip.trackId);
  document.tracks[0]!.semanticRole = "SFX";
  document.audioMix.masterVolume = 0.5;
  assert.equal(compositionDocumentHasAudibleMedia(document), true);
  assert.equal(buildCompositionPlaybackVolumeAutomations(document)[0]?.baselineVolume, 0.2);
  document.audioMix.masterVolume = 0;
  assert.equal(compositionDocumentHasAudibleMedia(document), false);
});

test("la ganancia final multiplica fades, ducking, curvas y crossfade una sola vez", () => {
  const document = createMasterVolumeFixture();
  document.audioMix.ducking.enabled = true;
  const video = document.clips.find(clip => clip.kind === "VIDEO")!;
  video.durationSeconds = 2; video.fadeOutSeconds = 0.5;
  video.volumeEnvelope = [{ sourceTimeSeconds: 0, gain: 0.8 }, { sourceTimeSeconds: 4, gain: 0.4 }];
  document.clips.push({ ...structuredClone(video), id: "second", hfId: "second", startSeconds: 2, sourceOffsetSeconds: 2, fadeOutSeconds: 0, fadeInSeconds: 0.5 });
  document.transitions = { schemaVersion: 1, items: [{ id: "crossfade", fromClipId: video.id, toClipId: "second",
    durationSeconds: 0.2, type: "CROSS_DISSOLVE", alignment: "CENTER_AT_CUT", audioMode: "CROSSFADE", easing: "power1.inOut", origin: "USER" }] };
  const baseline = buildCompositionPlaybackVolumeAutomations(document);
  assert.ok(baseline.length >= 3);
  document.audioMix.masterVolume = 0.5;
  const attenuated = buildCompositionPlaybackVolumeAutomations(document);
  assert.deepEqual(attenuated, baseline.map(automation => ({ ...automation, baselineVolume: automation.baselineVolume * 0.5,
    points: automation.points.map(point => ({ ...point, volume: point.volume * 0.5 })) })));
  document.audioMix.masterVolume = 0;
  assert.ok(buildCompositionPlaybackVolumeAutomations(document).every(automation => automation.points.every(point => point.volume === 0)));
});

test("preview, render y scene patch usan el mismo volumen estático efectivo", async () => {
  const before = createMasterVolumeFixture();
  const document = applyCompositionEditorPatches(before, [{ type: "audio-mix.update", settings: { masterVolume: 0.5 } }]);
  for (const target of [COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW, COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER]) {
    const html = await compileCompositionPreview({ document, assetUrls, target });
    assert.equal((html.match(/data-volume="0.2"/g) || []).length, 3);
  }
  const patch = buildCompositionPreviewScenePatch({ document, beforeDocument: before, assetUrls, audioMetersEnabled: false });
  assert.ok(patch);
  assert.equal(patch.nodes.filter(node => node.html.includes('data-volume="0.2"')).length, 3);
  const clip = document.clips[0]!;
  const updated = applyCompositionEditorPatches(document, [{ type: "clip.volume", clipId: clip.id, volume: 0.4 }]);
  const visual = buildCompositionPreviewVisualPatch({ document: updated, operations: [{ type: "clip.volume", clipId: clip.id, volume: 0.4 }] });
  assert.equal(visual?.changes[0]?.volume, 0.1);
});

test("la referencia PCM atenúa la mezcla completa y mantiene silencio a 0%", () => {
  const document = createMasterVolumeFixture();
  const pcm = Buffer.alloc(AUDIO_REFERENCE_LIMITS.sampleRate * 4 * 8);
  for (let index = 0; index < pcm.length; index += 8) { pcm.writeFloatLE(0.25, index); pcm.writeFloatLE(-0.25, index + 4); }
  const sources = new Map(MASTER_VOLUME_ASSET_IDS.map(id => [id, pcm]));
  const baseline = mixAudioReferencePcm(buildAudioReferenceMixPlan(document), sources);
  document.audioMix.masterVolume = 0.5;
  const attenuated = mixAudioReferencePcm(buildAudioReferenceMixPlan(document), sources);
  for (let index = 0; index < baseline.pcm.length; index += 4) assert.equal(attenuated.pcm.readFloatLE(index), baseline.pcm.readFloatLE(index) * 0.5);
  document.audioMix.masterVolume = 0;
  const muted = mixAudioReferencePcm(buildAudioReferenceMixPlan(document), sources);
  assert.equal(muted.pcm.some(byte => byte !== 0), false);
});
