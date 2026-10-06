import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { boundCompositionCanvasResize, compositionCanvasSnapTolerance, renderCompositionCanvasSnapGeometry } from "../composition-canvas-snap-geometry";

test("snap tolerance stays at seven screen pixels across preview scales", () => {
  for (const scale of [0.1, 0.5, 1, 2, 4, 8]) {
    assert.equal(compositionCanvasSnapTolerance(scale, 7) * scale, 7);
  }
  for (const scale of [0, -1, NaN, Infinity]) assert.equal(compositionCanvasSnapTolerance(scale, 7), 0);
});

test("proportional resize respects both canvas bounds without deformation", () => {
  const input = { width: 640, height: 100, maxWidth: 1000, maxHeight: 180, aspectRatio: 16 / 9, minimumSize: 24 };
  assert.deepEqual(boundCompositionCanvasResize(input), { width: 320, height: 180 });
  assert.deepEqual(boundCompositionCanvasResize({ ...input, maxWidth: 160 }), { width: 160, height: 90 });
  assert.deepEqual(boundCompositionCanvasResize({ ...input, width: 250 }), { width: 250, height: 140.625 });
});

test("portrait, grid fallback and minimum sizes preserve the aspect ratio", () => {
  for (const aspectRatio of [9 / 16, 1, 16 / 9]) {
    for (const width of [-100, 24, 272, 10000]) {
      const result = boundCompositionCanvasResize({ width, height: 160, maxWidth: 300, maxHeight: 200, aspectRatio, minimumSize: 24 });
      assert.ok(result);
      assert.ok(Math.abs(result.width / result.height - aspectRatio) < 1e-10);
      assert.ok(result.width <= 300 && result.height <= 200);
    }
  }
});

test("canvas constraints win over impossible minimum dimensions", () => {
  assert.deepEqual(boundCompositionCanvasResize({ width: 200, height: 200, maxWidth: 12, maxHeight: 8, aspectRatio: 2, minimumSize: 24 }), { width: 12, height: 6 });
  assert.deepEqual(boundCompositionCanvasResize({ width: 200, height: -1, maxWidth: 12, maxHeight: 8, aspectRatio: null, minimumSize: 24 }), { width: 12, height: 8 });
});

test("invalid geometry does not produce a resize", () => {
  const input = { width: 100, height: 100, maxWidth: 300, maxHeight: 200, aspectRatio: 1, minimumSize: 24 };
  for (const override of [{ width: NaN }, { height: Infinity }, { maxWidth: 0 }, { maxHeight: -1 }, { aspectRatio: 0 }, { aspectRatio: NaN }, { minimumSize: -1 }]) {
    assert.equal(boundCompositionCanvasResize({ ...input, ...override }), null);
  }
});

test("serialized preview geometry executes without module dependencies", () => {
  const result = runInNewContext(`${renderCompositionCanvasSnapGeometry()}
    ({ tolerance: canvasSnapTolerance(8, canvasSnapGeometry.screenTolerancePixels),
       size: boundCanvasResize({width: 640, height: 360, maxWidth: 1000, maxHeight: 180, aspectRatio: 16/9, minimumSize: canvasSnapGeometry.minimumSizePixels}) });`);
  assert.equal(result.tolerance, 0.875);
  assert.equal(result.size.width, 320);
  assert.equal(result.size.height, 180);
});
