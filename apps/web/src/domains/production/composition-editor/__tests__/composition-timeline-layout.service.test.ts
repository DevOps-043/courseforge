import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { resolveCompositionAssetInsertionTiming } from "../composition-asset-placement.service";
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

test("inserta en el playhead y permite solapamiento cuando la pista ya llega al final", () => {
  const timing = resolveCompositionAssetInsertionTiming({
    canvasDurationSeconds: 137,
    isSequential: true,
    occupiedUntilSeconds: 137,
    playheadSeconds: 103,
    preferredDurationSeconds: 20,
  });

  assert.deepEqual(timing, {
    durationSeconds: 20,
    overlapsExistingClips: true,
    startSeconds: 103,
  });
});

test("desplaza hacia atrás un asset superpuesto para conservarlo dentro del canvas", () => {
  const timing = resolveCompositionAssetInsertionTiming({
    canvasDurationSeconds: 137,
    isSequential: true,
    occupiedUntilSeconds: 137,
    playheadSeconds: 132,
    preferredDurationSeconds: 20,
  });

  assert.deepEqual(timing, {
    durationSeconds: 20,
    overlapsExistingClips: true,
    startSeconds: 117,
  });
});

test("mantiene la inserción consecutiva mientras todavía queda espacio", () => {
  const timing = resolveCompositionAssetInsertionTiming({
    canvasDurationSeconds: 137,
    isSequential: true,
    occupiedUntilSeconds: 100,
    playheadSeconds: 25,
    preferredDurationSeconds: 20,
  });

  assert.deepEqual(timing, {
    durationSeconds: 20,
    overlapsExistingClips: false,
    startSeconds: 100,
  });
});

test("coloca un audio de voz después del canvas para extender la duración total", () => {
  const timing = resolveCompositionAssetInsertionTiming({
    canvasDurationSeconds: 137,
    extendCanvasForSequentialAsset: true,
    isSequential: true,
    occupiedUntilSeconds: 137,
    playheadSeconds: 103,
    preferredDurationSeconds: 20,
  });

  assert.deepEqual(timing, {
    durationSeconds: 20,
    overlapsExistingClips: false,
    startSeconds: 137,
  });
});

test("conserva completa una voz aunque dure más que el canvas actual", () => {
  const timing = resolveCompositionAssetInsertionTiming({
    canvasDurationSeconds: 10,
    extendCanvasForSequentialAsset: true,
    isSequential: true,
    occupiedUntilSeconds: 10,
    playheadSeconds: 5,
    preferredDurationSeconds: 24,
  });

  assert.deepEqual(timing, {
    durationSeconds: 24,
    overlapsExistingClips: false,
    startSeconds: 10,
  });
});
