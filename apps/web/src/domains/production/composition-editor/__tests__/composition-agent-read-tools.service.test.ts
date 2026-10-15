import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { buildCompositionAgentReadSnapshot, COMPOSITION_AGENT_READ_LIMITS, CompositionAgentReadError, getCompositionAgentTimelineConflicts } from "../composition-agent-read-tools.service";
import { compositionAgentFixture } from "./composition-agent-test-fixture";

test("returns scoped read results without source references and resolves selection", () => {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{ checksum: "d".repeat(64), durationSeconds: 8, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: "00000000-0000-4000-8000-000000000054", publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/read-tool.mp4", timelineRole: "BROLL" }],
    plan: { accentColor: "#00D4B3", durationSeconds: 8, subtitle: "Lectura", title: "Agente" },
  });
  const selectedClipId = document.clips[0]!.id;
  const snapshot = buildCompositionAgentReadSnapshot(document, selectedClipId);

  assert.deepEqual(snapshot.availableTools, ["get_composition", "get_selected_elements", "get_timeline_conflicts", "get_motion_catalog"]);
  assert.equal(snapshot.selectedElements[0]?.id, selectedClipId);
  assert.equal(snapshot.motionCatalog.presetIds.includes("FADE_IN"), true);
  assert.doesNotMatch(JSON.stringify(snapshot), /storagePath|publicUrl|productionAssetId|source/);
});

test("snapshot is deeply frozen and detached from all nested document fields", () => {
  const { document, clip } = compositionAgentFixture();
  const snapshot = buildCompositionAgentReadSnapshot(document, clip.id);
  const before = JSON.stringify(snapshot);
  document.canvas.width = 500;
  document.audioMix.ducking.enabled = !document.audioMix.ducking.enabled;
  clip.layout.x += 10;
  assert.equal(JSON.stringify(snapshot), before);
  assert.ok(Object.isFrozen(snapshot.composition.audioMix.ducking));
  assert.ok(Object.isFrozen(snapshot.composition.clips[0]!.layout));
  assert.ok(!Object.isFrozen(document.canvas));
});

test("legacy context fails safely on entity, output and conflict limits", () => {
  const { document, clip } = compositionAgentFixture();
  const isLimit = (error: unknown) => error instanceof CompositionAgentReadError && error.code === "AGENT_READ_LIMIT_EXCEEDED";
  document.clips = Array(COMPOSITION_AGENT_READ_LIMITS.maxClips + 1).fill(clip);
  assert.throws(() => buildCompositionAgentReadSnapshot(document, null), isLimit);
  document.clips = [clip];
  clip.label = "x".repeat(COMPOSITION_AGENT_READ_LIMITS.maxSnapshotBytes);
  assert.throws(() => buildCompositionAgentReadSnapshot(document, null), isLimit);
  clip.label = "Video";
  document.clips = Array.from({ length: 33 }, (_, index) => ({ ...clip, id: `clip-${index}` }));
  assert.throws(() => getCompositionAgentTimelineConflicts(document), isLimit);
});

test("conflicts preserve exact nested overlap and exclude hidden/touching clips", () => {
  const { document, clip } = compositionAgentFixture();
  document.clips = [
    { ...clip, id: "left", startSeconds: 0, durationSeconds: 10 },
    { ...clip, id: "nested", startSeconds: 1, durationSeconds: 2 },
    { ...clip, id: "touching", startSeconds: 10, durationSeconds: 1 },
    { ...clip, id: "hidden", startSeconds: 0, hidden: true },
  ];
  const conflicts = getCompositionAgentTimelineConflicts(document);
  assert.deepEqual(conflicts, [{ clipIds: ["left", "nested"], overlapSeconds: 2, trackId: clip.trackId }]);
});
