import assert from "node:assert/strict";
import test from "node:test";
import { createNarrativeDocumentFixture } from "./fixtures/composition-narrative.fixture";
import { deriveNarrativeNavigationOccurrences } from "../composition-narrative-occurrence.service";
import { buildNarrativeFragmentPlan } from "../composition-narrative-fragment.service";
import { compositionEditorDocumentSchema } from "../composition-document.types";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { compositionNativeCaptionSourceSchema } from "../composition-text-layer.types";
import { resolveAvatarAudioLink } from "../composition-avatar-audio-link.service";
import { fingerprintNarrativeFragmentPlan } from "../composition-narrative-fragment-review.server";

const visualAssetId = "22222222-2222-4222-8222-222222222222";
function fixture() {
  const document = createNarrativeDocumentFixture();
  document.tracks.push({ id: "visual", kind: "VISUAL", label: "Visual", locked: false, order: 1, semanticRole: "BROLL" });
  document.clips.push({ ...structuredClone(document.clips[0]!), id: "visual-1", hfId: "hf-visual-1", kind: "VIDEO", trackId: "visual", label: "Visual",
    startSeconds: 10.5, durationSeconds: 1.5, sourceOffsetSeconds: 2, sourceDurationSeconds: 10, sceneId: undefined,
    source: { type: "PRODUCTION_ASSET", productionAssetId: visualAssetId, hasAudio: false } });
  const organizationId = "33333333-3333-4333-8333-333333333333";
  const componentId = "44444444-4444-4444-8444-444444444444";
  const commandId = "55555555-5555-4555-8555-555555555555";
  const occurrence = deriveNarrativeNavigationOccurrences(document).occurrences[0]!;
  const shared = { organization_id: organizationId, material_component_id: componentId, checksum: "c".repeat(64), qa_status: "APPROVED", duration_milliseconds: 10_000 };
  const registryAssets = new Map<string, unknown>([
    [occurrence.assetId, { ...shared, id: occurrence.assetId, asset_type: "VOICE_AUDIO", mime_type: "audio/mpeg",
      metadata: { script_hash: occurrence.scriptHash, word_timestamps: document.narrativeScenes![0]!.wordTimestamps } }],
    [visualAssetId, { ...shared, id: visualAssetId, asset_type: "SOURCE_MEDIA", mime_type: "video/mp4" }],
  ]);
  return { document: compositionEditorDocumentSchema.parse(document), documentHash: "b".repeat(64), organizationId, componentId, commandId,
    selection: { documentHash: "b".repeat(64), occurrenceId: occurrence.id, firstSourceIndex: 1, lastSourceIndex: 2 },
    selectedTrackIds: ["voice", "visual"], linkedAssetIds: [...registryAssets.keys()], registryAssets };
}
test("multitrack append preserves relative intersections and source offsets with a single reducer batch", () => {
  const params = fixture(); const before = structuredClone(params.document);
  const result = buildNarrativeFragmentPlan(params); assert.ok(result.ok);
  const applied = applyCompositionEditorPatches(params.document, result.plan.operations, "USER");
  const visualCopy = result.plan.copies.find(copy => copy.sourceClipId === "visual-1")!;
  const visual = applied.clips.find(clip => clip.id === visualCopy.newClipId)!;
  assert.deepEqual([visual.startSeconds, visual.durationSeconds, visual.sourceOffsetSeconds], [30.5, 1, 2]);
  assert.equal(applied.canvas.durationSeconds, 31.5); assert.equal(result.plan.scope, "AUDIOVISUAL");
  assert.deepEqual(params.document, before); assert.deepEqual(applied.clips.slice(0, 2), before.clips);
  assert.deepEqual(buildNarrativeFragmentPlan({ ...params, selectedTrackIds: ["visual", "voice"] }), result);
});
test("unselected overlapping clips are not copied; tracks and anchor must be explicit", () => {
  const params = fixture();
  params.document.tracks.push({ id: "other", kind: "VISUAL", label: "Otro", locked: false, order: 2 });
  params.document.clips.push({ ...params.document.clips[1]!, id: "unselected", hfId: "hf-unselected", trackId: "other" });
  const result = buildNarrativeFragmentPlan(params); assert.ok(result.ok); assert.equal(result.plan.copies.length, 2);
  assert.deepEqual(buildNarrativeFragmentPlan({ ...params, selectedTrackIds: ["visual", "other"] }), { ok: false, reason: "MISSING_REQUIRED_CLIP" });
  assert.deepEqual(buildNarrativeFragmentPlan({ ...params, selectedTrackIds: ["voice", "missing"] }), { ok: false, reason: "INVALID_TRACK_SELECTION" });
  assert.deepEqual(buildNarrativeFragmentPlan({ ...params, selectedTrackIds: ["voice", "voice"] }), { ok: false, reason: "INVALID_TRACK_SELECTION" });
});
test("source scope, duration, MIME, checksum and linked registry are required", () => {
  for (const patch of [{ organization_id: "99999999-9999-4999-8999-999999999999" }, { duration_milliseconds: 2000 },
    { checksum: "invalid" }, { mime_type: "audio/mpeg" }, { qa_status: "REJECTED" }]) {
    const params = fixture(); const asset = params.registryAssets.get(visualAssetId) as Record<string, unknown>;
    params.registryAssets.set(visualAssetId, { ...asset, ...patch });
    assert.deepEqual(buildNarrativeFragmentPlan(params), { ok: false, reason: "ASSET_BINDING_UNAVAILABLE" });
  }
  const params = fixture(); params.linkedAssetIds = [params.linkedAssetIds[0]!];
  assert.deepEqual(buildNarrativeFragmentPlan(params), { ok: false, reason: "ASSET_BINDING_UNAVAILABLE" });
});
test("voice/avatar pair is mandatory and copied under a fresh temporal link, without scene approval", () => {
  const params = fixture(); params.document.tracks[1]!.semanticRole = "AVATAR";
  params.document.clips[1] = { ...params.document.clips[1]!, startSeconds: 10, durationSeconds: 2, sourceOffsetSeconds: 1, sceneId: "scene-1" };
  const result = buildNarrativeFragmentPlan(params); assert.ok(result.ok);
  const applied = applyCompositionEditorPatches(params.document, result.plan.operations, "USER");
  const link = resolveAvatarAudioLink(applied, result.plan.anchor.newClipId); assert.equal(link.status, "LINKED");
  if (link.status === "LINKED") { assert.notEqual(link.sceneId, "scene-1"); assert.equal(applied.narrativeScenes?.some(scene => scene.id === link.sceneId), false); }
  params.document.tracks.push({ id: "empty", kind: "VISUAL", label: "Vacío", locked: false, order: 2 });
  assert.deepEqual(buildNarrativeFragmentPlan({ ...params, selectedTrackIds: ["voice", "empty"] }), { ok: false, reason: "NO_VISUAL_CONTENT" });
  params.document.clips[1]!.sourceOffsetSeconds = 2;
  assert.deepEqual(buildNarrativeFragmentPlan(params), { ok: false, reason: "LINK_TIMING_MISMATCH" });
});
test("groups are cloned only when every member has a retained copy", () => {
  const params = fixture(); params.document.groups = [{ id: "original-group", order: 0, label: "Grupo", clipIds: ["voice-1", "visual-1"] }];
  const result = buildNarrativeFragmentPlan(params); assert.ok(result.ok);
  const applied = applyCompositionEditorPatches(params.document, result.plan.operations, "USER");
  assert.equal(applied.groups?.length, 2); assert.deepEqual(applied.groups?.[0], params.document.groups[0]);
  params.document.clips[1]!.startSeconds = 15;
  assert.equal(buildNarrativeFragmentPlan(params).ok, false);
});
test("captions are trimmed without regenerating manual text and warnings retain original identities", () => {
  const params = fixture(); params.document.format = "courseforge-composition-v3";
  params.document.tracks.push({ id: "captions", kind: "OVERLAY", label: "Captions", locked: false, order: 2, semanticRole: "CAPTIONS" });
  params.document.clips.push({ ...params.document.clips[0]!, id: "captions-1", hfId: "hf-captions-1", sceneId: undefined, kind: "CAPTION", trackId: "captions",
    startSeconds: 9, durationSeconds: 4, sourceOffsetSeconds: undefined, sourceDurationSeconds: undefined,
    source: compositionNativeCaptionSourceSchema.parse({ type: "NATIVE_CAPTIONS", origin: "MANUAL", style: {}, cues: [
      { id: "authored", text: "Texto manual conservado", startSeconds: 0, endSeconds: 4 }] }) });
  params.selectedTrackIds.push("captions");
  const result = buildNarrativeFragmentPlan(params); assert.ok(result.ok);
  const operation = result.plan.operations.find(operation => operation.type === "clip.add" && operation.clip.kind === "CAPTION");
  assert.ok(operation?.type === "clip.add" && operation.clip.source.type === "NATIVE_CAPTIONS");
  assert.equal(operation.clip.source.cues[0]?.text, "Texto manual conservado");
  assert.deepEqual([operation.clip.source.cues[0]?.startSeconds, operation.clip.source.cues[0]?.endSeconds], [0, 1.5]);
  assert.deepEqual(result.plan.warnings, [{ clipId: "captions-1", cueId: "authored", kind: "CUE_CUT" }]);
});
test("locked tracks, unsupported motion and colliding identifiers fail without partial operations", () => {
  const locked = fixture(); locked.document.tracks[1]!.locked = true;
  assert.deepEqual(buildNarrativeFragmentPlan(locked), { ok: false, reason: "LOCKED_TRACK" });
  const fade = fixture(); fade.document.clips[1]!.fadeInSeconds = 0.2;
  assert.deepEqual(buildNarrativeFragmentPlan(fade), { ok: false, reason: "DEPENDENCIES_UNSUPPORTED" });
  const collision = fixture(); collision.document.clips.push({ ...collision.document.clips[0]!, sceneId: undefined,
    id: `voice-extract-${collision.commandId}`, hfId: "hf-existing", startSeconds: 20 });
  assert.deepEqual(buildNarrativeFragmentPlan(collision), { ok: false, reason: "INVALID_OPERATIONS" });
});

test("fragment review binds every asset while remaining independent of generated identity", () => {
  const params = fixture(); const first = buildNarrativeFragmentPlan(params); assert.ok(first.ok);
  const second = buildNarrativeFragmentPlan({ ...params, commandId: "66666666-6666-4666-8666-666666666666" }); assert.ok(second.ok);
  assert.equal(fingerprintNarrativeFragmentPlan(first.plan), fingerprintNarrativeFragmentPlan(second.plan));
  const changed = structuredClone(first.plan); changed.assets[1]!.checksum = "e".repeat(64);
  assert.notEqual(fingerprintNarrativeFragmentPlan(first.plan), fingerprintNarrativeFragmentPlan(changed));
  const reordered = structuredClone(first.plan); reordered.candidateClipIds.reverse();
  assert.notEqual(fingerprintNarrativeFragmentPlan(first.plan), fingerprintNarrativeFragmentPlan(reordered));
  assert.deepEqual(first.plan.candidateClipIds, first.plan.copies.map(copy => copy.sourceClipId));
});
