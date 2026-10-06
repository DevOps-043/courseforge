import assert from "node:assert/strict";
import test from "node:test";
import {applyRendererTextGeometry} from "../qa/composition-renderer-text-geometry";
import {compareTextParityRegions} from "../qa/composition-text-region-comparison";
import {COMPOSITION_TEXT_PARITY_POLICY as policy} from "../composition-text-parity-policy";

const region = {elementId: "native", textSha256: "a".repeat(64), left: 8, top: 4, width: 20, height: 12,
  observedBounds: {left: 8, top: 4, right: 28, bottom: 16}};
function moved(patch: Partial<Pick<typeof region, "left" | "top" | "width" | "height">>) {
  const result = {...region, ...patch};
  return {...result, observedBounds: {left: result.left, top: result.top, right: result.left + result.width,
    bottom: result.top + result.height}};
}
const expectedTexts = [{elementId: region.elementId, textSha256: region.textSha256}];
const point = {frameIndex: 0, timeSeconds: 0, policy: policy.id, status: "CAPTURED", unavailable: [],
  expectedTexts, regions: [region]};
const width = 48, height = 24, channels = 3;
const frame = Buffer.alloc(width * height * channels);
for (let row = 6; row < 14; row++) for (let column = 10; column < 24; column++) {
  const offset = (row * width + column) * channels; frame.fill(240, offset, offset + 3);
}
const pixels = () => compareTextParityRegions({preview: frame, rendered: frame, width, height, channels,
  regions: [region], expectedTexts});

test("independent renderer bounds reject displacement even with identical image pixels", () => {
  for (const patch of [{left: 10}, {top: 6}, {width: 22}, {height: 14}, {left: 7, width: 23}]) {
    const result = applyRendererTextGeometry({pixels: pixels(), preview: point,
      rendered: {...point, regions: [moved(patch)]}});
    assert.equal(result.status, "FAIL");
    assert.equal(result.regions[0].reason, "RENDERER_TEXT_GEOMETRY_OUTSIDE_TOLERANCE");
  }
});
test("matching bounds and one-pixel edge drift stay inside the explicit geometry budget", () => {
  for (const patch of [{}, {left: 9}, {top: 3}, {width: 21}, {height: 11}])
    assert.equal(applyRendererTextGeometry({pixels: pixels(), preview: point,
      rendered: {...point, regions: [moved(patch)]}}).status, "PASS");
});
test("unrounded bounds expose over-budget subpixel movement hidden by integer ROIs", () => {
  for (const drift of [1.00001, 1.25, 1.9]) {
    const result = applyRendererTextGeometry({pixels: pixels(), preview: point, rendered: {...point,
      regions: [{...region, observedBounds: {...region.observedBounds, left: 8 + drift, right: 28 + drift}}]}});
    assert.equal(result.status, "FAIL");
  }
  const {observedBounds: _bounds, ...legacy} = region;
  assert.equal(applyRendererTextGeometry({pixels: pixels(), preview: point,
    rendered: {...point, regions: [legacy]}}).status, "INCOMPLETE");
});
test("missing renderer or unavailable node cannot obtain text PASS", () => {
  for (const rendered of [undefined, {...point, status: "INCOMPLETE", regions: [],
    unavailable: [{elementId: region.elementId, reason: "ELEMENT_MISSING"}]}]) {
    const result = applyRendererTextGeometry({pixels: pixels(), preview: point, rendered});
    assert.equal(result.status, "INCOMPLETE"); assert.equal(result.checkedRegionCount, 0);
    assert.equal(result.maximumAcceptedDisplacementPixels, null);
  }
});
test("expanded paint ROI uses its original geometry, not expanded ink bounds", () => {
  const preview = {...point, regions: [{...region, left: 6, width: 24, paintMask: {
    scope: "SUPPLEMENTAL_PREVIEW_PAINT_PIXELS_NOT_GLYPH_IDENTITY", width: 24, height: 12, pixelCount: 0, runs: []}}],
    paintMaskCapture: {policy: "NATIVE_TEXT_PAINT_SUPPRESSION_RESTORED_V1",
      scope: "ALL_NATIVE_TEXT_SUPPRESSED_NOT_PER_GLYPH_CAUSALITY", regionExpansionPolicy: "JOINT_NATIVE_PAINT_DELTA_NEAREST_ROI_V1",
      sourceRegions: [{elementId: region.elementId, left: region.left, top: region.top, width: region.width, height: region.height}],
      paintedPngSha256: "a".repeat(64), suppressedPngSha256: "b".repeat(64)}};
  assert.equal(applyRendererTextGeometry({pixels: pixels(), preview, rendered: point}).status, "PASS");
  assert.throws(() => applyRendererTextGeometry({pixels: pixels(), preview: {...preview,
    paintMaskCapture: {sourceRegions: [region]}}, rendered: point}));
});
test("foreign time, content, IDs and coverage are rejected", () => {
  for (const rendered of [{...point, timeSeconds: 1}, {...point, frameIndex: 1},
    {...point, regions: [{...region, elementId: "foreign"}]},
    {...point, expectedTexts: [{...expectedTexts[0], textSha256: "b".repeat(64)}],
      regions: [{...region, textSha256: "b".repeat(64)}]}])
    assert.throws(() => applyRendererTextGeometry({pixels: pixels(), preview: point, rendered}));
});
test("geometry match never hides a pixel failure or an uninformative region", () => {
  const failed = compareTextParityRegions({preview: frame, rendered: Buffer.alloc(frame.length), width, height, channels,
    regions: [region], expectedTexts});
  assert.equal(applyRendererTextGeometry({pixels: failed, preview: point, rendered: point}).status, "FAIL");
  const blank = Buffer.alloc(frame.length);
  const incomplete = compareTextParityRegions({preview: blank, rendered: blank, width, height, channels,
    regions: [region], expectedTexts});
  assert.equal(applyRendererTextGeometry({pixels: incomplete, preview: point, rendered: point}).status, "INCOMPLETE");
});
test("empty native text obligations require no synthetic renderer geometry", () => {
  const emptyPoint = {...point, expectedTexts: [], regions: []};
  const empty = compareTextParityRegions({preview: frame, rendered: frame, width, height, channels, regions: [], expectedTexts: []});
  assert.equal(applyRendererTextGeometry({pixels: empty, preview: emptyPoint}).status, "PASS");
});
