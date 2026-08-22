import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveCompositionTimelineTrimStartMinimum,
  resolveCompositionTimelineTrimStartSourceOffset,
} from "../composition-timeline-trim.service";

test("permite extender una diapositiva desde su borde izquierdo sin crear offset de fuente", () => {
  const slide = { kind: "DECK_SLIDE" as const, sourceOffsetSeconds: 0, startSeconds: 10 };

  assert.equal(resolveCompositionTimelineTrimStartMinimum(slide), 0);
  assert.equal(resolveCompositionTimelineTrimStartSourceOffset(slide, 6), 0);
  assert.equal(resolveCompositionTimelineTrimStartSourceOffset(slide, 12), 0);
});

test("conserva el límite temporal de audio y video al ajustar el borde izquierdo", () => {
  const untrimmedVideo = { kind: "VIDEO" as const, sourceOffsetSeconds: 0, startSeconds: 10 };
  const trimmedVideo = { kind: "VIDEO" as const, sourceOffsetSeconds: 3, startSeconds: 10 };

  assert.equal(resolveCompositionTimelineTrimStartMinimum(untrimmedVideo), 10);
  assert.equal(resolveCompositionTimelineTrimStartMinimum(trimmedVideo), 7);
  assert.equal(resolveCompositionTimelineTrimStartSourceOffset(trimmedVideo, 8), 1);
  assert.equal(resolveCompositionTimelineTrimStartSourceOffset(trimmedVideo, 12), 5);
});
