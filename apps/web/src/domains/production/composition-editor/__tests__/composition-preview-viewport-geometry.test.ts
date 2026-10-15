import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { resolveCompositionPreviewCanvasBounds } from "../composition-preview-viewport-geometry";

const base = { canvasWidth: 1920, canvasHeight: 1080, viewportWidth: 960, viewportHeight: 540, zoom: 1 };

test("safe areas follow the same centered canvas at every supported zoom", () => {
  for (const zoom of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
    const bounds = resolveCompositionPreviewCanvasBounds({ ...base, zoom });
    assert.ok(bounds);
    assert.equal(bounds.width, 960 * zoom);
    assert.equal(bounds.height, 540 * zoom);
    assert.equal(bounds.x + bounds.width / 2, 480);
    assert.equal(bounds.y + bounds.height / 2, 270);
    for (const inset of [0.05, 0.1]) {
      assert.equal(bounds.x + bounds.width * inset, 480 + (inset - 0.5) * 960 * zoom);
    }
  }
});

test("fit uses letterboxing for portrait, square and mismatched monitor sizes", () => {
  assert.deepEqual(resolveCompositionPreviewCanvasBounds({ ...base, viewportHeight: 800 }), { width: 960, height: 540, x: 0, y: 130, scale: 0.5 });
  assert.deepEqual(resolveCompositionPreviewCanvasBounds({ ...base, canvasWidth: 1080, canvasHeight: 1920 }), { width: 303.75, height: 540, x: 328.125, y: 0, scale: 0.28125 });
  assert.deepEqual(resolveCompositionPreviewCanvasBounds({ ...base, canvasWidth: 1080 }), { width: 540, height: 540, x: 210, y: 0, scale: 0.5 });
});

test("tiny monitors preserve the runtime minimum scale and offscreen canvas bounds", () => {
  assert.deepEqual(resolveCompositionPreviewCanvasBounds({ ...base, viewportWidth: 1, viewportHeight: 1 }), { width: 19.2, height: 10.8, x: -9.1, y: -4.9, scale: 0.01 });
});

test("hidden monitor and malformed geometry never expose a misleading overlay", () => {
  for (const override of [{ viewportWidth: 0 }, { viewportHeight: 0 }, { canvasWidth: -1 }, { canvasHeight: Infinity }, { zoom: NaN }, { zoom: 0.49 }, { zoom: 2.01 }]) {
    assert.equal(resolveCompositionPreviewCanvasBounds({ ...base, ...override }), null);
  }
});

test("the same fit function runs inside the sandbox without module dependencies", () => {
  const bounds = runInNewContext(`(${resolveCompositionPreviewCanvasBounds.toString()})(${JSON.stringify({ ...base, zoom: 2 })})`);
  assert.equal(bounds.x, -480);
  assert.equal(bounds.y, -270);
  assert.equal(bounds.scale, 1);
});
