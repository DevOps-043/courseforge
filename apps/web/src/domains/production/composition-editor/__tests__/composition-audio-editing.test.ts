import assert from "node:assert/strict";
import test from "node:test";
import { createAudioEditingFixture, createAudioTransition } from "./composition-audio-editing.fixtures";
import { listCompositionTransitionEditPoints, resolveCompositionTransitionEligibility } from "../composition-transition.service";
import { buildCompositionTransitionRuntime } from "../composition-transition-runtime";
import { buildCompositionPlaybackVolumeAutomations, resolvePlaybackVolume } from "../composition-playback-audio-envelope";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS } from "../composition-preview-compiler.service";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { scheduleCompositionTransitions } from "../composition-transition-timeline";
import { buildCompositionTimelineLayout } from "../composition-timeline-layout.service";
import { buildAudioReferenceMixPlan } from "../qa/composition-audio-reference-mix";
import { resolveAudioTimelineZoom, audioTimelinePointerSeconds, buildAudioTimelineRuler } from "../composition-audio-timeline-view";

test("audios adyacentes exponen crossfade con handles reales", () => {
  const document = createAudioEditingFixture();
  const transition = createAudioTransition(document);
  assert.equal(listCompositionTransitionEditPoints(document).length, 1);
  assert.equal(resolveCompositionTransitionEligibility({ document, transition }).available, true);
  for (const mode of ["source", "handles", "locked", "visual", "mixed", "third"] as const) {
    const altered = structuredClone(document);
    if (mode === "source") delete altered.clips[0]!.sourceDurationSeconds;
    if (mode === "handles") altered.clips[1]!.sourceOffsetSeconds = 0;
    if (mode === "locked") altered.tracks[0]!.locked = true;
    if (mode === "mixed") altered.clips[1]!.kind = "VIDEO";
    if (mode === "third") altered.clips.push({ ...altered.clips[0]!, id: "third", hfId: "third", startSeconds: 3.8, durationSeconds: 0.4 });
    const probe = mode === "visual" ? { ...transition, type: "PUSH" as const, parameters: { direction: "LEFT" as const } } : transition;
    assert.equal(resolveCompositionTransitionEligibility({ document: altered, transition: probe }).available, false, mode);
  }
});

test("ventanas y offsets de audio se extienden sin animación visual ni alteración canónica", () => {
  const initial = createAudioEditingFixture();
  const transition = createAudioTransition(initial);
  const document = applyCompositionEditorPatches(initial, [{ type: "transition.add", transition }]);
  const runtime = buildCompositionTransitionRuntime(document);
  assert.equal(runtime.items[0]!.audioOnly, true);
  const [from, to] = document.clips;
  assert.equal(runtime.audioWindowsByClipId.get(from!.id)?.endSeconds, 4.2);
  assert.equal(runtime.audioWindowsByClipId.get(to!.id)?.startSeconds, 3.8);
  assert.equal(runtime.audioWindowsByClipId.get(to!.id)?.sourceOffsetSeconds, 0.8);
  assert.equal(runtime.items[0]!.fromAudioTargetId, from!.id);
  assert.deepEqual(document.clips, initial.clips);
  let calls = 0;
  scheduleCompositionTransitions({ set() { calls++; }, to() { calls++; }, fromTo() { calls++; } }, runtime.items, () => ({}));
  assert.equal(calls, 0);
  const layout = buildCompositionTimelineLayout(document);
  assert.notEqual(layout.trackIndexByClipId.get(from!.id), layout.trackIndexByClipId.get(to!.id));
  const removed = applyCompositionEditorPatches(document, [{ type: "transition.remove", transitionId: transition.id }]);
  assert.deepEqual(buildCompositionTransitionRuntime(removed).audioWindowsByClipId.get(to!.id), {
    durationSeconds: 4, startSeconds: 4, endSeconds: 8, sourceOffsetSeconds: 1,
  });
});

test("crossfade lineal respeta maestro y reference mix con el mismo offset", () => {
  const document = createAudioEditingFixture();
  document.audioMix.masterVolume = 0.5;
  document.transitions = { schemaVersion: 1, items: [createAudioTransition(document)] };
  const automations = buildCompositionPlaybackVolumeAutomations(document);
  const outgoing = automations.find(item => item.targetClipId === document.clips[0]!.id)!;
  const incoming = automations.find(item => item.targetClipId === document.clips[1]!.id)!;
  assert.ok(Math.abs(resolvePlaybackVolume(outgoing.points, 4, 0) - 0.2) < 1e-6);
  assert.ok(Math.abs(resolvePlaybackVolume(incoming.points, 4, 0) - 0.15) < 1e-6);
  const plan = buildAudioReferenceMixPlan(document);
  assert.equal(plan.clips[1]!.sourceOffsetSeconds, 0.8);
  assert.equal(plan.clips[1]!.startSeconds, 3.8);
});

test("las tres alineaciones consumen solo handles disponibles", () => {
  for (const alignment of ["CENTER_AT_CUT", "START_AT_CUT", "END_AT_CUT"] as const) {
    const document = createAudioEditingFixture();
    document.transitions = { schemaVersion: 1, items: [{ ...createAudioTransition(document), alignment }] };
    const runtime = buildCompositionTransitionRuntime(document);
    const window = runtime.audioWindowsByClipId.get(document.clips[1]!.id)!;
    const expectedOffset = alignment === "CENTER_AT_CUT" ? 0.8 : alignment === "START_AT_CUT" ? 1 : 0.6;
    assert.equal(window.sourceOffsetSeconds, expectedOffset);
    assert.ok(window.sourceOffsetSeconds >= 0 && window.sourceOffsetSeconds + window.durationSeconds <= 10);
  }
});

test("split de audio transfiere el crossfade saliente y trim inválido se rechaza", () => {
  const initial = createAudioEditingFixture();
  const transition = createAudioTransition(initial);
  const document = applyCompositionEditorPatches(initial, [{ type: "transition.add", transition }]);
  const split = applyCompositionEditorPatches(document, [{ type: "clip.split", clipId: document.clips[0]!.id,
    atSeconds: 2, newClipId: "tail", newHfId: "tail" }]);
  assert.equal(split.transitions?.items[0]?.fromClipId, "tail");
  assert.equal(buildCompositionTransitionRuntime(split).items[0]?.audioOnly, true);
  assert.throws(() => applyCompositionEditorPatches(split, [{ type: "clip.trim", clipId: "tail",
    startSeconds: 2, durationSeconds: 1, sourceOffsetSeconds: 3 }]));
});

test("preview y render usan ventanas de audio solapadas y lanes distintas", async () => {
  const document = createAudioEditingFixture();
  document.transitions = { schemaVersion: 1, items: [createAudioTransition(document)] };
  const assetUrls = new Map(document.clips.flatMap(clip => clip.source.type === "PRODUCTION_ASSET" ? [[clip.source.productionAssetId, "https://storage.test/audio.wav"]] : []));
  for (const target of [COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW, COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER]) {
    const html = await compileCompositionPreview({ document, assetUrls, target });
    assert.match(html, /data-start="3.8" data-duration="4.2" data-end="8"/);
    assert.match(html, /data-source-offset="0.8"/);
    assert.match(html, /"audioOnly":true/);
  }
});

test("corte visual de audio conserva offsets, fuente y permite trim posterior", () => {
  const document = createAudioEditingFixture();
  const clip = document.clips[0]!;
  const atSeconds = audioTimelinePointerSeconds({ clientX: 350, left: 100, width: 500, startSeconds: 0, durationSeconds: 4, fps: 30 });
  assert.equal(atSeconds, 2);
  const split = applyCompositionEditorPatches(document, [{ type: "clip.split", clipId: clip.id, atSeconds, newClipId: "right", newHfId: "right" }]);
  const right = split.clips.find(item => item.id === "right")!;
  assert.equal(right.sourceOffsetSeconds, 3);
  assert.equal(right.durationSeconds, 2);
  assert.deepEqual(right.source, clip.source);
  const trimmed = applyCompositionEditorPatches(split, [{ type: "clip.trim", clipId: right.id, startSeconds: 2.5, durationSeconds: 1.5, sourceOffsetSeconds: 3.5 }]);
  assert.equal(trimmed.clips.find(item => item.id === right.id)?.sourceOffsetSeconds, 3.5);
  assert.deepEqual(document.clips[0], clip);
});

test("zoom de audio es preciso y acotado y el cursor se alinea al frame", () => {
  assert.equal(resolveAudioTimelineZoom(8, 960, 30), 2);
  assert.equal(resolveAudioTimelineZoom(86_400, 100, 30), 128);
  assert.equal(resolveAudioTimelineZoom(Number.NaN, 960, 30), 1);
  for (const duration of [8, 600, 86_400]) {
    const ruler = buildAudioTimelineRuler(duration, 128);
    assert.ok(ruler.major.length + ruler.minor.length <= 2_002);
  }
  assert.equal(audioTimelinePointerSeconds({ clientX: 176, left: 100, width: 200, startSeconds: 2, durationSeconds: 1, fps: 30 }), 71 / 30);
});
