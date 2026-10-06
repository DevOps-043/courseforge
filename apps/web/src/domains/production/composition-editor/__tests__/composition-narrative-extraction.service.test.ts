import assert from "node:assert/strict";
import test from "node:test";
import { createNarrativeDocumentFixture } from "./fixtures/composition-narrative.fixture";
import { deriveNarrativeNavigationOccurrences } from "../composition-narrative-occurrence.service";
import { buildNarrativeVoiceExtractionPlan } from "../composition-narrative-extraction.service";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { fingerprintNarrativeVoiceExtractionPlan } from "../composition-narrative-extraction-query";

function fixture() {
  const document = createNarrativeDocumentFixture();
  const occurrence = deriveNarrativeNavigationOccurrences(document).occurrences[0]!;
  const organizationId = "33333333-3333-4333-8333-333333333333";
  const componentId = "44444444-4444-4444-8444-444444444444";
  const documentHash = "b".repeat(64);
  return { document, documentHash, organizationId, componentId, newClipId: "voice-extracted", newHfId: "hf-voice-extracted",
    selection: { documentHash, occurrenceId: occurrence.id, firstSourceIndex: 1, lastSourceIndex: 2 },
    linkedAssetIds: [occurrence.assetId], registryAsset: { id: occurrence.assetId, organization_id: organizationId,
      material_component_id: componentId, asset_type: "VOICE_AUDIO", mime_type: "audio/mpeg", checksum: "c".repeat(64),
      qa_status: "READY_FOR_QA", duration_milliseconds: 10_000,
      metadata: { script_hash: occurrence.scriptHash, word_timestamps: structuredClone(document.narrativeScenes![0]!.wordTimestamps!) } } };
}

test("copied labels preserve Unicode and fit the clip label contract", () => {
  const params = fixture();
  params.document.clips[0]!.label = "😀".repeat(100);
  const result = buildNarrativeVoiceExtractionPlan(params);
  assert.ok(result.ok);
  const added = result.plan.operations.find((operation) => operation.type === "clip.add");
  assert.ok(added?.type === "clip.add");
  assert.equal(added.clip.label, `${"😀".repeat(90)} · fragmento de voz`);
  assert.ok(added.clip.label.length <= 200);
});

test("review binding distinguishes takes using the same asset and source window", () => {
  const result = buildNarrativeVoiceExtractionPlan(fixture());
  assert.ok(result.ok);
  assert.notEqual(fingerprintNarrativeVoiceExtractionPlan(result.plan),
    fingerprintNarrativeVoiceExtractionPlan({ ...result.plan, sourceClipId: "different-take" }));
});

test("plans non-destructive append with same asset, source offset and one native patch batch", () => {
  const params = fixture();
  const before = structuredClone(params);
  const result = buildNarrativeVoiceExtractionPlan(params);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual([result.plan.sourceStartSeconds, result.plan.sourceEndSeconds], [1, 2.5]);
  assert.deepEqual([result.plan.destinationStartSeconds, result.plan.destinationEndSeconds], [30, 31.5]);
  assert.equal(result.plan.binding, "REGISTRY_METADATA_MATCH_ONLY");
  const applied = applyCompositionEditorPatches(params.document, result.plan.operations, "USER");
  assert.deepEqual(applied.clips[0], params.document.clips[0]);
  const copied = applied.clips.find((clip) => clip.id === params.newClipId)!;
  assert.equal(copied.sceneId, undefined);
  assert.equal(copied.sourceOffsetSeconds, 1);
  assert.deepEqual(copied.source, params.document.clips[0]!.source);
  assert.equal(applied.canvas.durationSeconds, 31.5);
  assert.deepEqual(params, before);
});
test("accepts manual interval only within the authoritative asset duration", () => {
  const params = fixture();
  Object.assign(params.selection, { adjustedStartSeconds: 10.2, adjustedEndSeconds: 12 });
  const result = buildNarrativeVoiceExtractionPlan(params);
  assert.equal(result.ok, true);
  if (result.ok) assert.ok(Math.abs(result.plan.sourceStartSeconds - 1.2) < 0.000001);
  params.registryAsset.duration_milliseconds = 2_000;
  assert.deepEqual(buildNarrativeVoiceExtractionPlan(params), { ok: false, reason: "SOURCE_WINDOW_INVALID" });
});
test("rejects stale revision and malformed document", () => {
  const params = fixture();
  params.selection.documentHash = "d".repeat(64);
  assert.deepEqual(buildNarrativeVoiceExtractionPlan(params), { ok: false, reason: "INVALID_RANGE" });
  params.document.canvas.durationSeconds = -1;
  assert.deepEqual(buildNarrativeVoiceExtractionPlan(params), { ok: false, reason: "INVALID_DOCUMENT" });
});
test("requires registry checksum, precise duration and permitted QA status", () => {
  for (const patch of [{ checksum: "" }, { duration_milliseconds: null }, { qa_status: "REJECTED" },
    { qa_status: "ARCHIVED" }, { asset_type: "AVATAR_VIDEO" }, { mime_type: "video/mp4" }]) {
    const params = fixture();
    Object.assign(params.registryAsset, patch);
    assert.deepEqual(buildNarrativeVoiceExtractionPlan(params), { ok: false, reason: "ASSET_BINDING_UNAVAILABLE" });
  }
});
test("fails closed for another tenant, component, asset or missing draft link", () => {
  for (const field of ["organization_id", "material_component_id", "id"] as const) {
    const params = fixture();
    params.registryAsset[field] = "55555555-5555-4555-8555-555555555555";
    assert.deepEqual(buildNarrativeVoiceExtractionPlan(params), { ok: false, reason: "ASSET_SCOPE_MISMATCH" });
  }
  const params = fixture();
  params.linkedAssetIds = [];
  assert.deepEqual(buildNarrativeVoiceExtractionPlan(params), { ok: false, reason: "ASSET_SCOPE_MISMATCH" });
});
test("requires matching script hash and exact word values, not object property order", () => {
  const params = fixture();
  params.registryAsset.metadata.word_timestamps = params.registryAsset.metadata.word_timestamps.map((word) => ({ end: word.end, start: word.start, word: word.word }));
  assert.equal(buildNarrativeVoiceExtractionPlan(params).ok, true);
  params.registryAsset.metadata.script_hash = "d".repeat(64);
  assert.deepEqual(buildNarrativeVoiceExtractionPlan(params), { ok: false, reason: "TIMESTAMPS_MISMATCH" });
  const changed = fixture();
  changed.registryAsset.metadata.word_timestamps[1]!.word = "otro";
  assert.deepEqual(buildNarrativeVoiceExtractionPlan(changed), { ok: false, reason: "TIMESTAMPS_MISMATCH" });
});
test("blocks locked tracks, groups and fades instead of silently dropping them", () => {
  const locked = fixture();
  locked.document.tracks[0]!.locked = true;
  assert.deepEqual(buildNarrativeVoiceExtractionPlan(locked), { ok: false, reason: "LOCKED_TRACK" });
  const faded = fixture();
  faded.document.clips[0]!.fadeInSeconds = 0.1;
  assert.deepEqual(buildNarrativeVoiceExtractionPlan(faded), { ok: false, reason: "DEPENDENCIES_UNSUPPORTED" });
  const grouped = fixture();
  grouped.document.clips.push({ ...structuredClone(grouped.document.clips[0]!), id: "other", hfId: "hf-other", sceneId: undefined });
  grouped.document.groups = [{ id: "group-1", clipIds: ["voice-1", "other"], order: 0 }];
  assert.deepEqual(buildNarrativeVoiceExtractionPlan(grouped), { ok: false, reason: "DEPENDENCIES_UNSUPPORTED" });
});
test("blocks avatar/voice links instead of extracting isolated generated voice", () => {
  const params = fixture();
  params.document.tracks.push({ ...structuredClone(params.document.tracks[0]!), id: "avatar", semanticRole: "AVATAR", kind: "VISUAL", order: 1 });
  params.document.clips.push({ ...structuredClone(params.document.clips[0]!), id: "avatar-1", hfId: "hf-avatar", trackId: "avatar", kind: "VIDEO" });
  assert.deepEqual(buildNarrativeVoiceExtractionPlan(params), { ok: false, reason: "DEPENDENCIES_UNSUPPORTED" });
});
test("invalid or colliding clip identities never return partially usable operations", () => {
  for (const patch of [{ newClipId: "bad/id" }, { newClipId: "voice-1" }, { newHfId: "hf-voice-1" }]) {
    assert.deepEqual(buildNarrativeVoiceExtractionPlan({ ...fixture(), ...patch }), { ok: false, reason: "INVALID_OPERATIONS" });
  }
});
test("planning twice is deterministic, not a promise of durable command idempotence", () => {
  const params = fixture();
  assert.deepEqual(buildNarrativeVoiceExtractionPlan(params), buildNarrativeVoiceExtractionPlan(params));
});
