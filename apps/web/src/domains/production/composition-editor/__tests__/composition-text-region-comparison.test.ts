import assert from "node:assert/strict";
import test from "node:test";
import { compareTextParityRegions } from "../qa/composition-text-region-comparison";
import { buildNativeTextPaintPose } from "../composition-text-paint-pose";
import { isPointInConvexPaintPolygon } from "../composition-text-paint-geometry";

const width = 48, height = 24, channels = 3;
const region = {elementId: "caption", textSha256: "a".repeat(64), left: 8, top: 4, width: 20, height: 12};
function frame(shiftX = 0, shiftY = 0, missing = false) {
  const image = Buffer.alloc(width * height * channels);
  if (!missing) for (let y = 6; y < 14; y++) for (let x = 10; x < 24; x++) {
    if (x === 10 || x === 16 || y === 6 || y === 10) {
      const offset = ((y + shiftY) * width + x + shiftX) * channels; image.fill(240, offset, offset + 3);
    }
  }
  return image;
}
function compare(rendered = frame(), regions: unknown = [region], expectedElementIds = ["caption"], preview = frame()) {
  return compareTextParityRegions({preview, rendered, width, height, channels, regions,
    expectedTexts: expectedElementIds.map((elementId) => ({elementId, textSha256: region.textSha256}))});
}

test("convex support membership handles rotation, either winding, boundaries and degenerate support", () => {
  const polygon = [{x: 10, y: 0}, {x: 20, y: 10}, {x: 10, y: 20}, {x: 0, y: 10}];
  for (const points of [polygon, [...polygon].reverse()]) {
    assert.equal(isPointInConvexPaintPolygon({x: 10, y: 10}, points), true);
    assert.equal(isPointInConvexPaintPolygon({x: 10, y: 0}, points), true);
    assert.equal(isPointInConvexPaintPolygon({x: 0, y: 0}, points), false);
  }
  assert.equal(isPointInConvexPaintPolygon({x: 0, y: 0}, []), false);
  assert.equal(isPointInConvexPaintPolygon({x: 1, y: 1}, [{x: 0, y: 0}, {x: 1, y: 1}, {x: 2, y: 2}]), false);
});

test("contrast outside a partial wipe cannot prove informative text; outside paint is never ignored", () => {
  const paintPose = buildNativeTextPaintPose("native", {canvas: {width, height},
    layout: {x: 8, y: 4, width: 20, height: 12, rotation: 0}, motion: {x: 0, y: 0, scale: 1, rotation: 0},
    transition: {xPercent: 0, yPercent: 0, clipPath: "inset(0 0 0 75%)"}}, "blur(0px)");
  const presentation = {effectiveOpacity: 1, opaqueOverlayIds: [], paintPose};
  const decoratedBackground = Buffer.alloc(width * height * channels);
  decoratedBackground.fill(240, (6 * width + 10) * channels, (6 * width + 11) * channels);
  const input = {width, height, channels, regions: [{...region, visibility: "VISIBLE" as const, presentation}],
    expectedTexts: [{elementId: region.elementId, textSha256: region.textSha256, visibility: "VISIBLE" as const, presentation}]};
  const noText = compareTextParityRegions({...input, preview: decoratedBackground, rendered: decoratedBackground});
  assert.equal(noText.status, "INCOMPLETE"); assert.equal(noText.checkedRegionCount, 0);
  assert.equal(noText.regions[0]!.reason, "TEXT_REGION_UNINFORMATIVE");
  const visible = Buffer.from(decoratedBackground);
  visible.fill(240, (6 * width + 24) * channels, (6 * width + 25) * channels);
  assert.equal(compareTextParityRegions({...input, preview: visible, rendered: visible}).status, "PASS");
  const unexpected = Buffer.from(visible);
  unexpected.fill(240, (12 * width + 12) * channels, (12 * width + 13) * channels);
  assert.equal(compareTextParityRegions({...input, preview: visible, rendered: unexpected}).status, "FAIL");
});

test("coincident text passes local stricter gates with zero displacement", () => {
  const result = compare(); assert.equal(result.status, "PASS"); assert.equal(result.maximumAcceptedDisplacementPixels, 0);
  assert.equal(result.regions[0]!.meanAbsoluteError, 0); assert.equal(result.checkedRegionCount, 1);
});

test("one-pixel shifts are measured, two-pixel shifts never aligned to pass", () => {
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [1, -1]]) {
    const result = compare(frame(x, y)); assert.equal(result.status, "PASS"); assert.equal(result.regions[0]!.displacementX, x);
    assert.equal(result.regions[0]!.displacementY, y); assert.equal(result.maximumAcceptedDisplacementPixels, 1);
  }
  for (const [x, y] of [[2, 0], [0, -2], [3, 3]]) assert.equal(compare(frame(x, y)).status, "FAIL");
});

test("missing or altered glyph shape cannot hide in full-frame averages", () => {
  assert.equal(compare(frame(0, 0, true)).status, "FAIL");
  const changed = frame(); changed.fill(0, (10 * width + 16) * channels, (10 * width + 16) * channels + 3);
  assert.equal(compare(changed).status, "FAIL");
});

test("flat or absent regions are incomplete, not successful coverage", () => {
  assert.equal(compare(frame(), []).status, "INCOMPLETE");
  assert.equal(compareTextParityRegions({preview: frame(), rendered: frame(), width, height, channels,
    regions: undefined, expectedTexts: [{elementId: "caption", textSha256: region.textSha256}]}).status, "INCOMPLETE");
  assert.equal(compare(frame(0, 0, true), [region], ["caption"], frame(0, 0, true)).status, "INCOMPLETE");
  assert.equal(compare(frame(), [], []).status, "PASS");
});

test("explicit hidden regions measure absence without shifts and reject visible render glyphs", () => {
  const hiddenRegion = {...region, visibility: "HIDDEN" as const};
  const expectedTexts = [{elementId: region.elementId, textSha256: region.textSha256, visibility: "HIDDEN" as const}];
  const preview = frame(0, 0, true);
  const input = {preview, width, height, channels, regions: [hiddenRegion], expectedTexts};
  const absent = compareTextParityRegions({...input, rendered: preview});
  assert.equal(absent.status, "PASS"); assert.equal(absent.checkedRegionCount, 1);
  assert.equal(absent.maximumAcceptedDisplacementPixels, 0);
  assert.equal(compareTextParityRegions({...input, rendered: frame()}).status, "FAIL");
  assert.throws(() => compareTextParityRegions({...input, rendered: preview, regions: [region]}), /VISIBILITY_MISMATCH/);
  assert.equal(compareTextParityRegions({...input, rendered: preview, regions: []}).status, "INCOMPLETE");
});

test("frozen low opacity and opaque overlays allow flat references without loosening pixel thresholds", () => {
  const preview = frame(0, 0, true);
  for (const presentation of [{effectiveOpacity: 0.01, opaqueOverlayIds: []}, {effectiveOpacity: 1, opaqueOverlayIds: ["transition-overlay"]}]) {
    const expected = {elementId: region.elementId, textSha256: region.textSha256, visibility: "VISIBLE" as const, presentation};
    const input = {preview, width, height, channels, regions: [{...region, visibility: "VISIBLE" as const, presentation}], expectedTexts: [expected]};
    assert.equal(compareTextParityRegions({...input, rendered: preview}).status, "PASS");
    assert.equal(compareTextParityRegions({...input, rendered: frame()}).status, "FAIL");
    assert.throws(() => compareTextParityRegions({...input, rendered: preview,
      regions: [{...region, visibility: "VISIBLE", presentation: {...presentation, effectiveOpacity: 0}}]}), /PRESENTATION_MISMATCH/);
  }
  const presentation = {effectiveOpacity: 1, opaqueOverlayIds: []};
  assert.equal(compareTextParityRegions({preview, rendered: preview, width, height, channels,
    regions: [{...region, visibility: "VISIBLE", presentation}],
    expectedTexts: [{elementId: region.elementId, textSha256: region.textSha256, visibility: "VISIBLE", presentation}]}).status, "INCOMPLETE");
});

test("failure dominates incomplete coverage of a second region", () => {
  assert.equal(compare(frame(0, 0, true), [region], ["caption", "missing-second"]).status, "FAIL");
});

test("verified fully closed wipe measures absence without shifts; blur cannot borrow this proof", () => {
  const paintPose = buildNativeTextPaintPose("native", {canvas: {width, height},
    layout: {x: 8, y: 4, width: 20, height: 12, rotation: 0}, motion: {x: 0, y: 0, scale: 1, rotation: 0},
    transition: {xPercent: 0, yPercent: 0, clipPath: "inset(0 100% 0 0)"}}, "blur(0px)");
  const presentation = {effectiveOpacity: 1, opaqueOverlayIds: [], paintPose};
  const preview = frame(0, 0, true);
  const input = {preview, width, height, channels, regions: [{...region, visibility: "VISIBLE" as const, presentation}],
    expectedTexts: [{elementId: region.elementId, textSha256: region.textSha256, visibility: "VISIBLE" as const, presentation}]};
  const result = compareTextParityRegions({...input, rendered: preview});
  assert.equal(result.status, "PASS"); assert.equal(result.maximumAcceptedDisplacementPixels, 0);
  assert.equal(compareTextParityRegions({...input, rendered: frame()}).status, "FAIL");
  const blurred = {...presentation, paintPose: {...paintPose, filter: "blur(1px)"}};
  assert.equal(compareTextParityRegions({...input, rendered: preview,
    regions: [{...input.regions[0]!, presentation: blurred}],
    expectedTexts: [{...input.expectedTexts[0]!, presentation: blurred}]}).status, "INCOMPLETE");
});

test("full-canvas absence probes share bounded work and cannot average away one unexpected glyph pixel", () => {
  const canvasWidth = 2048, canvasHeight = 2048;
  const preview = Buffer.alloc(canvasWidth * canvasHeight * channels);
  const paintPose = buildNativeTextPaintPose("native", {canvas: {width: canvasWidth, height: canvasHeight},
    layout: {x: -100, y: 0, width: 20, height: 20, rotation: 0}, motion: {x: 0, y: 0, scale: 1, rotation: 0},
    transition: {xPercent: 0, yPercent: 0, clipPath: "none"}}, "blur(0px)");
  const presentation = {effectiveOpacity: 1, opaqueOverlayIds: [], paintPose};
  const regions = ["first", "second"].map((elementId) => ({elementId, textSha256: region.textSha256,
    visibility: "VISIBLE" as const, presentation, left: 0, top: 0, width: canvasWidth, height: canvasHeight,
    regionKind: "CANVAS_ABSENCE_PROBE" as const}));
  const expectedTexts = regions.map(({elementId, textSha256, visibility, presentation}) => ({elementId, textSha256, visibility, presentation}));
  const input = {preview, width: canvasWidth, height: canvasHeight, channels, regions, expectedTexts};
  const passed = compareTextParityRegions({...input, rendered: preview});
  assert.equal(passed.status, "PASS"); assert.equal(passed.checkedRegionCount, 2);
  assert.equal(passed.maximumAcceptedDisplacementPixels, 0);
  const rendered = Buffer.from(preview); rendered[rendered.length - 1] = 240;
  const failed = compareTextParityRegions({...input, rendered});
  assert.equal(failed.status, "FAIL"); assert.equal(failed.checkedRegionCount, 2);
  assert.ok(failed.regions.every((row) => row.status === "FAIL"));
  assert.throws(() => compareTextParityRegions({...input, rendered: preview,
    regions: [{...regions[0]!, width: canvasWidth - 1}]}), /ABSENCE_PROBE_INVALID/);
});

test("unexpected, duplicate, out-of-canvas and malformed geometry fail explicitly", () => {
  assert.throws(() => compare(frame(), [region], []), /UNEXPECTED_REGION/);
  assert.throws(() => compare(frame(), [region, region]));
  assert.throws(() => compare(frame(), [{...region, left: width - 1}]), /OUTSIDE_CANVAS/);
  assert.throws(() => compare(frame(), [{...region, left: NaN}]));
  assert.throws(() => compare(frame(), [{...region, textSha256: "b".repeat(64)}]), /CONTENT_MISMATCH/);
  assert.throws(() => compare(frame(), [region], ["caption", "caption"]), /EXPECTED_DUPLICATE/);
});

test("comparison work quota is checked before per-shift scanning", () => {
  const image = Buffer.alloc(1024 * 1024 * channels);
  const large = {elementId: "caption", textSha256: region.textSha256, left: 0, top: 0, width: 1024, height: 1024};
  assert.throws(() => compareTextParityRegions({preview: image, rendered: image, width: 1024, height: 1024, channels,
    regions: [large, {...large, elementId: "second"}], expectedTexts: ["caption", "second"].map((elementId) => ({elementId, textSha256: region.textSha256}))}), /PIXEL_BUDGET/);
});

test("transparency and raw frame shape cannot silently pass local text checks", () => {
  const rgba = Buffer.alloc(width * height * 4, 255); rgba[3] = 0;
  assert.throws(() => compareTextParityRegions({preview: rgba, rendered: rgba, width, height, channels: 4,
    regions: [{...region, left: 0, top: 0}], expectedTexts: [{elementId: region.elementId, textSha256: region.textSha256}]}), /NON_OPAQUE_FRAME/);
  assert.throws(() => compareTextParityRegions({preview: frame(), rendered: Buffer.alloc(3), width, height, channels,
    regions: [region], expectedTexts: [{elementId: region.elementId, textSha256: region.textSha256}]}), /FRAME_INVALID/);
});
