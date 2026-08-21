import assert from "node:assert/strict";
import test from "node:test";
import "./composition-preview-playhead.service.test";
import {
  buildTimelineSnapTargets,
  resolveTimelineSnap,
} from "../composition-timeline-snap.service";

const clips = [
  { durationSeconds: 4, hidden: false, id: "active", label: "Activo", startSeconds: 2 },
  { durationSeconds: 3, hidden: false, id: "video", label: "Video", startSeconds: 10 },
  { durationSeconds: 2, hidden: true, id: "hidden", label: "Oculto", startSeconds: 20 },
];

test("construye candidatos de inicio y final y excluye el clip activo y los ocultos", () => {
  const targets = buildTimelineSnapTargets({ clips, excludedClipId: "active", playheadSeconds: 5 });

  assert.deepEqual(targets, [
    { source: "PLAYHEAD", timeSeconds: 5 },
    { clipId: "video", clipLabel: "Video", source: "CLIP_START", timeSeconds: 10 },
    { clipId: "video", clipLabel: "Video", source: "CLIP_END", timeSeconds: 13 },
  ]);
});

test("alinea el inicio de un clip con el inicio de otro track", () => {
  const result = resolveTimelineSnap({
    anchors: [{ edge: "START", timeSeconds: 9.92 }],
    targets: buildTimelineSnapTargets({ clips, excludedClipId: "active", playheadSeconds: 5 }),
    toleranceSeconds: 0.1,
  });

  assert.ok(Math.abs(result.deltaSeconds - 0.08) < 1e-9);
  assert.deepEqual(result.match, {
    clipId: "video",
    clipLabel: "Video",
    movingEdge: "START",
    source: "CLIP_START",
    timeSeconds: 10,
  });
});

test("alinea el inicio inmediatamente después del final de otro clip", () => {
  const result = resolveTimelineSnap({
    anchors: [{ edge: "START", timeSeconds: 13.06 }],
    targets: buildTimelineSnapTargets({ clips, excludedClipId: "active", playheadSeconds: 5 }),
    toleranceSeconds: 0.1,
  });

  assert.ok(Math.abs(result.deltaSeconds - (-0.06)) < 1e-9);
  assert.equal(result.match?.source, "CLIP_END");
  assert.equal(result.match?.timeSeconds, 13);
});

test("compara ambos bordes al mover y elige el ajuste más cercano", () => {
  const result = resolveTimelineSnap({
    anchors: [
      { edge: "START", timeSeconds: 6.9 },
      { edge: "END", timeSeconds: 9.98 },
    ],
    targets: buildTimelineSnapTargets({ clips, excludedClipId: "active", playheadSeconds: 5 }),
    toleranceSeconds: 0.15,
  });

  assert.ok(Math.abs(result.deltaSeconds - 0.02) < 1e-9);
  assert.equal(result.match?.movingEdge, "END");
  assert.equal(result.match?.source, "CLIP_START");
});

test("conserva la preferencia por el playhead cuando hay empate", () => {
  const result = resolveTimelineSnap({
    anchors: [{ edge: "START", timeSeconds: 5.1 }],
    targets: [
      { clipId: "video", source: "CLIP_START", timeSeconds: 5 },
      { source: "PLAYHEAD", timeSeconds: 5.2 },
    ],
    toleranceSeconds: 0.2,
  });

  assert.equal(result.match?.source, "PLAYHEAD");
});

test("ignora candidatos fuera de tolerancia o que rompen los límites", () => {
  const outsideTolerance = resolveTimelineSnap({
    anchors: [{ edge: "START", timeSeconds: 9.7 }],
    targets: [{ clipId: "video", source: "CLIP_START", timeSeconds: 10 }],
    toleranceSeconds: 0.1,
  });
  const outsideBounds = resolveTimelineSnap({
    anchors: [{ edge: "END", timeSeconds: 0.05 }],
    isValidDelta: (delta) => 0.02 + delta >= 0,
    targets: [{ clipId: "video", source: "CLIP_END", timeSeconds: 0 }],
    toleranceSeconds: 0.1,
  });

  assert.equal(outsideTolerance.match, null);
  assert.equal(outsideBounds.match, null);
});

test("no hace snap cuando la tolerancia está desactivada", () => {
  const result = resolveTimelineSnap({
    anchors: [{ edge: "START", timeSeconds: 9.99 }],
    targets: [{ clipId: "video", source: "CLIP_START", timeSeconds: 10 }],
    toleranceSeconds: -1,
  });

  assert.deepEqual(result, { deltaSeconds: 0, match: null });
});
