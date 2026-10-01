import assert from "node:assert/strict";
import test from "node:test";
import { parseTextPaintInset, projectTextPaintGeometry } from "../composition-text-paint-geometry";
import { createMotionOpacityProjection } from "../composition-motion-opacity-projection";
import { createTransitionDocument, createTransition } from "./composition-transition-test-fixtures";

function pose() {
  return {canvas: {width: 100, height: 100}, layout: {x: 10, y: 10, width: 40, height: 20, rotation: 0},
    motion: {x: 0, y: 0, scale: 1, rotation: 0}, transition: {xPercent: 0, yPercent: 0, clipPath: "none"}};
}
function bounds(polygon: Array<{x: number; y: number}>) {
  return [Math.min(...polygon.map((point) => point.x)), Math.min(...polygon.map((point) => point.y)),
    Math.max(...polygon.map((point) => point.x)), Math.max(...polygon.map((point) => point.y))];
}
function near(actual: number[], expected: number[]) {
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]!) < 1e-9, `${actual} != ${expected}`));
}

test("neutral support and partial canvas clipping retain exact polygon bounds", () => {
  const input = pose();
  assert.deepEqual(bounds(projectTextPaintGeometry(input).polygon), [10, 10, 50, 30]);
  input.layout.x = -10;
  assert.deepEqual(bounds(projectTextPaintGeometry(input).polygon), [0, 10, 30, 30]);
  input.layout.x = -40;
  assert.deepEqual(projectTextPaintGeometry(input), {polygon: [], empty: true});
});

test("push percentages translate by the clip size and offcanvas contact has zero area", () => {
  const input = pose(); input.transition.xPercent = 100;
  assert.deepEqual(bounds(projectTextPaintGeometry(input).polygon), [50, 10, 90, 30]);
  input.transition.xPercent = -125;
  assert.equal(projectTextPaintGeometry(input).empty, true);
});

test("wipe insets clip before layout rotation and fully closed masks are empty", () => {
  const input = pose(); input.transition.clipPath = "inset(0 50% 0 0)"; input.layout.rotation = 90;
  input.layout.x = 40;
  near(bounds(projectTextPaintGeometry(input).polygon), [20, 10, 40, 30]);
  input.transition.clipPath = "inset(0 100% 0 0)";
  assert.equal(projectTextPaintGeometry(input).empty, true);
  input.transition.clipPath = "inset(60% 0 60% 0)";
  assert.equal(projectTextPaintGeometry(input).empty, true);
});

test("centered subject scale/translation is clipped by parent overflow", () => {
  const input = pose(); input.motion.scale = 0.5;
  assert.deepEqual(bounds(projectTextPaintGeometry(input).polygon), [20, 15, 40, 25]);
  input.motion.x = 25;
  assert.deepEqual(bounds(projectTextPaintGeometry(input).polygon), [45, 15, 50, 25]);
  input.motion.x = 30;
  assert.equal(projectTextPaintGeometry(input).empty, true);
  input.motion.scale = 2; input.motion.x = 0;
  assert.deepEqual(bounds(projectTextPaintGeometry(input).polygon), [10, 10, 50, 30]);
});

test("rotated subject uses a convex polygon rather than its misleading axis aligned bounds", () => {
  const input = pose(); input.motion.rotation = 45;
  const projected = projectTextPaintGeometry(input);
  assert.equal(projected.empty, false);
  assert.ok(projected.polygon.length > 4);
  assert.ok(projected.polygon.every((point) => point.x >= 10 && point.x <= 50 && point.y >= 10 && point.y <= 30));
});

test("unsupported masks and invalid numeric geometry never fabricate support", () => {
  assert.deepEqual(parseTextPaintInset("inset(25% 10%)"), [0.25, 0.1, 0.25, 0.1]);
  assert.deepEqual(parseTextPaintInset("inset(0px 50% 0px 0px)"), [0, 0.5, 0, 0]);
  for (const mask of ["inset(-1% 0 0 0)", "inset(101% 0 0 0)", "inset(2px)", "circle(50%)", "inset(0 round 2px)"]) {
    assert.throws(() => parseTextPaintInset(mask), /MASK_UNSUPPORTED/);
  }
  const input = pose(); input.motion.x = Number.NaN;
  assert.throws(() => projectTextPaintGeometry(input), /GEOMETRY_INVALID/);
});

test("shared GSAP projection exposes geometric poses reproducibly in both seek directions", () => {
  const document = createTransitionDocument();
  const projection = createMotionOpacityProjection(document, true);
  try {
    const clip = document.clips.find((candidate) => candidate.kind !== "AUDIO")!;
    const first = projection.geometryAt(1, clip.id);
    projection.geometryAt(4, clip.id);
    assert.deepEqual(projection.geometryAt(1, clip.id), first);
    assert.equal(first.empty, false);
  } finally {projection.dispose();}
});

test("actual push and wipe scheduler endpoints produce empty incoming support then full support", () => {
  for (const type of ["PUSH", "SOFT_WIPE"] as const) {
    const document = createTransitionDocument();
    const incoming = document.clips[1]!;
    incoming.layout = {...incoming.layout, x: 0, y: 0, width: document.canvas.width, height: document.canvas.height, rotation: 0};
    document.transitions = {schemaVersion: 1, items: [{...createTransition(document), type, parameters: {direction: "LEFT"}}]};
    const projection = createMotionOpacityProjection(document, true);
    try {
      assert.equal(projection.geometryAt(3.8, incoming.id).empty, true);
      near(bounds(projection.geometryAt(4.2, incoming.id).polygon), [0, 0, document.canvas.width, document.canvas.height]);
      assert.equal(projection.geometryAt(4, incoming.id).empty, false);
      assert.equal(projection.geometryAt(3.8, incoming.id).empty, true);
    } finally {projection.dispose();}
  }
});

test("blur expansion cannot be mistaken for empty geometric paint support", () => {
  const document = createTransitionDocument();
  document.transitions = {schemaVersion: 1, items: [{...createTransition(document), type: "BLUR_DISSOLVE", parameters: {blurPixels: 20}}]};
  const projection = createMotionOpacityProjection(document, true);
  try {
    assert.throws(() => projection.geometryAt(4, document.clips[1]!.id), /FILTER_UNSUPPORTED/);
  } finally {projection.dispose();}
});
