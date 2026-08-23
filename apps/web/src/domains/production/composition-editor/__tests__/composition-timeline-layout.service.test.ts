import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { buildCompositionTimelineLayout } from "../composition-timeline-layout.service";

const BROLL_IDS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
];

function createBrollDocument() {
  return createInitialCompositionDocument({
    animatedDeck: null,
    assets: BROLL_IDS.map((productionAssetId, index) => ({
      checksum: String(index + 1).repeat(64),
      durationSeconds: 4,
      fileSizeBytes: 4,
      hasAudio: true,
      mimeType: "video/mp4",
      productionAssetId,
      publicUrl: null,
      storageBucket: "production-assets",
      storagePath: `production-assets/broll-${index + 1}.mp4`,
      timelineRole: "BROLL" as const,
    })),
    plan: { accentColor: "#38BDF8", durationSeconds: 12, subtitle: "Prueba", title: "B-rolls" },
  });
}

test("compacta clips consecutivos de la misma capa en una sola fila", () => {
  const document = createBrollDocument();
  const layout = buildCompositionTimelineLayout(document);
  const brollGroup = layout.groups.find((group) => group.track.id === "broll");

  assert.ok(brollGroup);
  assert.equal(brollGroup.zIndex, 2);
  assert.equal(brollGroup.lanes.length, 1);
  assert.deepEqual(brollGroup.lanes[0]?.clips.map((clip) => clip.id), document.clips.map((clip) => clip.id));
  assert.equal(new Set(document.clips.map((clip) => layout.trackIndexByClipId.get(clip.id))).size, 1);
  assert.equal(new Set(document.clips.map((clip) => layout.audioTrackIndexByClipId.get(clip.id))).size, 1);
});

test("crea subfilas y tracks de render distintos cuando los clips se solapan", () => {
  const document = createBrollDocument();
  document.clips[1]!.startSeconds = 2;
  const layout = buildCompositionTimelineLayout(document);
  const brollGroup = layout.groups.find((group) => group.track.id === "broll");

  assert.ok(brollGroup);
  assert.equal(brollGroup.lanes.length, 2);
  assert.notEqual(
    layout.trackIndexByClipId.get(document.clips[0]!.id),
    layout.trackIndexByClipId.get(document.clips[1]!.id),
  );
  assert.notEqual(
    layout.audioTrackIndexByClipId.get(document.clips[0]!.id),
    layout.audioTrackIndexByClipId.get(document.clips[1]!.id),
  );
});

test("separa profundidades visuales aunque sus tiempos no se solapen", () => {
  const document = createBrollDocument();
  document.clips[2]!.layout.zIndex = 7;
  const layout = buildCompositionTimelineLayout(document);
  const brollGroups = layout.groups.filter((group) => group.track.id === "broll");

  assert.deepEqual(brollGroups.map((group) => group.zIndex), [7, 2]);
  assert.equal(brollGroups[0]?.clips[0]?.id, document.clips[2]!.id);
});
