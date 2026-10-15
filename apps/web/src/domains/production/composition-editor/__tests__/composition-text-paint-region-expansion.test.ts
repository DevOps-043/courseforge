import assert from "node:assert/strict";
import test from "node:test";
import { expandTextPaintRegions } from "../qa/composition-text-paint-region-expansion";
import { COMPOSITION_TEXT_PARITY_POLICY as policy } from "../composition-text-parity-policy";

function frame(width: number, height: number) {
  const bytes = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) bytes[pixel * 4 + 3] = 255;
  return bytes;
}
test("expanded rectangles preserve base coverage and allocate external paint deterministically, not causally", () => {
  const width = 8, height = 8, suppressed = frame(width, height), painted = Buffer.from(suppressed);
  const regions = [{elementId: "first", left: 1, top: 1, width: 1, height: 1},
    {elementId: "second", left: 5, top: 1, width: 1, height: 1}];
  painted[(1 * width + 3) * 4] = 50; // Equal distance: original semantic order breaks ties.
  painted[(4 * width + 5) * 4] = 50;
  const input = {regions, painted, suppressed, width, height};
  assert.deepEqual(expandTextPaintRegions(input), [{elementId: "first", left: 1, top: 1, width: 3, height: 1},
    {elementId: "second", left: 5, top: 1, width: 1, height: 4}]);
  assert.deepEqual(expandTextPaintRegions(input), expandTextPaintRegions(input));
  assert.equal(regions[0]!.width, 1);
});
test("threshold-exact deltas do not expand, overlapping sources remain present, alpha is mandatory across canvas", () => {
  const width = 8, height = 8, suppressed = frame(width, height), painted = Buffer.from(suppressed);
  const regions = [{elementId: "first", left: 2, top: 2, width: 3, height: 3},
    {elementId: "second", left: 3, top: 3, width: 2, height: 2}];
  painted[0] = policy.pixelDifferenceThreshold;
  assert.deepEqual(expandTextPaintRegions({regions, painted, suppressed, width, height}), regions);
  painted[3] = 254;
  assert.throws(() => expandTextPaintRegions({regions, painted, suppressed, width, height}), /NON_OPAQUE/);
});
test("expanded area cannot exceed the shared quota or be reduced by dropping a distant pixel", () => {
  const width = 1100, height = 1000, suppressed = frame(width, height), painted = Buffer.from(suppressed);
  const regions = [{elementId: "first", left: 0, top: 0, width: 1, height: 1}];
  painted[((height - 1) * width + width - 1) * 4] = 50;
  assert.throws(() => expandTextPaintRegions({regions, painted, suppressed, width, height}));
});

test("assignment work is bounded before pathological external paint can trigger region-by-canvas scanning", () => {
  const width = 257, height = 129, suppressed = frame(width, height), painted = Buffer.from(suppressed);
  const regions = Array.from({length: policy.maximumRegions}, (_, index) => ({elementId: `region-${index}`,
    left: index, top: 0, width: 1, height: 1}));
  for (let pixel = width; pixel < width * height; pixel++) painted[pixel * 4] = 50;
  assert.throws(() => expandTextPaintRegions({regions, painted, suppressed, width, height}), /EXPANSION_WORK_LIMIT/);
});
