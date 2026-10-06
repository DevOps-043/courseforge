import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { compositionCanvasVisibleBounds, compositionCanvasResizedVisibleBounds, resolveCompositionVisibleResizeSnap, renderCompositionCanvasVisibleBounds } from "../composition-canvas-visible-bounds";

const layout = { x: 100, y: 50, width: 200, height: 100, rotation: 0 };
const crop = { left: 20, right: 40, top: 10, bottom: 20 };
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test("uncropped layout and asymmetric crop expose editorial visible edges and center", () => {
  assert.deepEqual(compositionCanvasVisibleBounds(layout, crop), { left: 120, right: 260, top: 60, bottom: 130, centerX: 190, centerY: 95 });
  const rotated = compositionCanvasVisibleBounds({ ...layout, rotation: 90 }, crop)!;
  near(rotated.left, 170); near(rotated.right, 240);
  near(rotated.top, 20); near(rotated.bottom, 160);
});

test("resize scales crop instead of treating source box edges as visible", () => {
  assert.deepEqual(compositionCanvasResizedVisibleBounds(layout, crop, 400, 200), { left: 140, right: 420, top: 70, bottom: 210, centerX: 280, centerY: 140 });
  const result = resolveCompositionVisibleResizeSnap({ layout, crop, width: 200, height: 100, preserveRatio: false, guidesX: [264], guidesY: [132], threshold: 7 });
  const bounds = compositionCanvasResizedVisibleBounds(layout, crop, result.width, result.height)!;
  near(bounds.right, 264); near(bounds.bottom, 132);
  assert.equal(result.guideX, 264); assert.equal(result.guideY, 132);
});

test("proportional snap chooses one dominant axis for cropped rotated rectangles", () => {
  for (const rotation of [0, 30, 45, 90, 180, 270, -30]) {
    const rotatedLayout = { ...layout, rotation };
    const initial = compositionCanvasVisibleBounds(rotatedLayout, crop)!;
    const result = resolveCompositionVisibleResizeSnap({ layout: rotatedLayout, crop, width: 200, height: 100, preserveRatio: true,
      guidesX: [initial.right + 2], guidesY: [initial.bottom + 4], threshold: 7 });
    near(result.width / result.height, 2);
    const finalBounds = compositionCanvasResizedVisibleBounds(rotatedLayout, crop, result.width, result.height)!;
    if (result.guideX !== undefined) near(finalBounds.right, result.guideX);
    if (result.guideY !== undefined) near(finalBounds.bottom, result.guideY);
    assert.equal(result.guideX !== undefined && result.guideY !== undefined, false);
    assert.ok(result.guideX !== undefined || result.guideY !== undefined);
  }
});

test("free resize solves both rotated guide constraints including quarter turns", () => {
  for (const rotation of [0, 30, 45, 90, 135, 180, 270]) {
    const rotatedLayout = { ...layout, rotation };
    const expected = compositionCanvasResizedVisibleBounds(rotatedLayout, crop, 203, 102)!;
    const result = resolveCompositionVisibleResizeSnap({ layout: rotatedLayout, crop, width: 200, height: 100, preserveRatio: false,
      guidesX: [expected.right], guidesY: [expected.bottom], threshold: 7 });
    near(result.width, 203); near(result.height, 102);
    near(result.guideX!, expected.right); near(result.guideY!, expected.bottom);
  }
});

test("missing or invalid candidates and geometry cannot emit a guide", () => {
  const input = { layout, crop, width: 200, height: 100, preserveRatio: true, guidesX: [NaN, Infinity, 500], guidesY: [], threshold: 7 };
  assert.deepEqual(resolveCompositionVisibleResizeSnap(input), { width: 200, height: 100, guideX: undefined, guideY: undefined });
  assert.equal(compositionCanvasVisibleBounds(layout, { ...crop, left: 200 }), null);
  assert.equal(compositionCanvasVisibleBounds({ ...layout, rotation: NaN }, crop), null);
  assert.equal(compositionCanvasVisibleBounds(layout, { ...crop, top: -1 }), null);
});

test("runtime geometry and resize solver have no hidden module dependencies", () => {
  const input = { layout: { ...layout, rotation: 90 }, crop, width: 200, height: 100, preserveRatio: true, guidesX: [242], guidesY: [], threshold: 7 };
  const result = runInNewContext(`${renderCompositionCanvasVisibleBounds()} resolveVisibleResizeSnap(${JSON.stringify(input)});`);
  const bounds = compositionCanvasResizedVisibleBounds(input.layout, crop, result.width, result.height)!;
  near(bounds.right, 242);
});
