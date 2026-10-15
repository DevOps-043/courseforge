import assert from "node:assert/strict";
import test from "node:test";
import { buildTextPaintDeltaMask, textPaintMaskSchema, measureTextPaintMask } from "../qa/composition-text-paint-mask";
import { compareTextParityRegions } from "../qa/composition-text-region-comparison";

test("paint delta encodes only changes beyond RGB threshold in canonical bounded runs", () => {
  const suppressed = Buffer.alloc(24), painted = Buffer.from(suppressed);
  painted.fill(4, 0, 3); painted.fill(5, 3, 9); painted.fill(20, 15, 18);
  const mask = buildTextPaintDeltaMask({painted, suppressed, width: 4, height: 2, channels: 3});
  assert.deepEqual(mask.runs, [[1, 2], [5, 1]]); assert.equal(mask.pixelCount, 3);
  assert.equal(mask.scope, "SUPPLEMENTAL_PREVIEW_PAINT_PIXELS_NOT_GLYPH_IDENTITY");
  for (const patch of [{pixelCount: 4}, {runs: [[1, 2], [2, 1]]}, {runs: [[1, 1], [2, 1]], pixelCount: 2},
    {runs: [[8, 1]], pixelCount: 1}, {width: 0}]) assert.equal(textPaintMaskSchema.safeParse({...mask, ...patch}).success, false);
});

test("sparse paint defect cannot dilute into a passing full-ROI average", () => {
  const width = 200, height = 100, channels = 3, preview = Buffer.alloc(width * height * channels);
  preview.fill(240, (50 * width + 100) * channels, (50 * width + 101) * channels);
  const rendered = Buffer.alloc(preview.length), mask = buildTextPaintDeltaMask({painted: preview, suppressed: rendered, width, height, channels});
  const region = {elementId: "text", textSha256: "a".repeat(64), left: 0, top: 0, width, height};
  const input = {preview, rendered, width, height, channels, expectedTexts: [{elementId: region.elementId, textSha256: region.textSha256}]};
  assert.equal(compareTextParityRegions({...input, regions: [region]}).status, "PASS");
  const result = compareTextParityRegions({...input, regions: [{...region, paintMask: mask}]});
  assert.equal(result.status, "FAIL"); assert.equal(result.regions[0]!.reason, "TEXT_PAINT_MASK_OUTSIDE_TOLERANCE");
  assert.equal(compareTextParityRegions({...input, rendered: preview, regions: [{...region, paintMask: mask}]}).status, "PASS");
  const altered = Buffer.from(preview); altered.fill(240, 0, 60);
  assert.equal(compareTextParityRegions({...input, rendered: altered, regions: [{...region, paintMask: mask}]}).status, "FAIL");
});

test("empty paint mask never certifies visible text and geometry cannot escape the region", () => {
  const width = 10, height = 10, channels = 3, preview = Buffer.alloc(width * height * channels);
  preview.fill(240, 30, 33);
  const mask = buildTextPaintDeltaMask({painted: preview, suppressed: preview, width, height, channels});
  const region = {elementId: "text", textSha256: "a".repeat(64), left: 0, top: 0, width, height, paintMask: mask};
  const input = {preview, rendered: preview, width, height, channels, regions: [region],
    expectedTexts: [{elementId: region.elementId, textSha256: region.textSha256}]};
  assert.equal(compareTextParityRegions(input).status, "INCOMPLETE");
  assert.throws(() => compareTextParityRegions({...input, regions: [{...region, width: width - 1}]}));
});

test("mask measurement retains the one-pixel displacement budget and rejects bounds or alpha errors", () => {
  const mask = textPaintMaskSchema.parse({scope: "SUPPLEMENTAL_PREVIEW_PAINT_PIXELS_NOT_GLYPH_IDENTITY",
    width: 2, height: 2, pixelCount: 1, runs: [[0, 1]]});
  const preview = Buffer.alloc(4 * 4 * 3), rendered = Buffer.from(preview);
  preview.fill(240, (1 * 4 + 1) * 3, (1 * 4 + 2) * 3);
  rendered.fill(240, (1 * 4 + 2) * 3, (1 * 4 + 3) * 3);
  const input = {mask, preview, rendered, frameWidth: 4, channels: 3, left: 1, top: 1, shiftX: 1, shiftY: 0};
  assert.equal(measureTextPaintMask(input)!.meanAbsoluteError, 0);
  assert.equal(measureTextPaintMask({...input, shiftX: 0})!.mismatchedPixelRatio, 1);
  for (const patch of [{shiftX: 2}, {left: 3}, {top: -1}, {frameWidth: 0}, {rendered: Buffer.alloc(1)}])
    assert.throws(() => measureTextPaintMask({...input, ...patch}));
  assert.throws(() => buildTextPaintDeltaMask({painted: Buffer.alloc(4), suppressed: Buffer.alloc(4), width: 1, height: 1, channels: 4}), /ALPHA_INVALID/);
});

test("nonempty RGB paint delta is informative even when chromatic luminance contrast is below the legacy probe", () => {
  const width = 200, height = 100, channels = 3, preview = Buffer.alloc(width * height * channels);
  const suppressed = Buffer.from(preview);
  preview[(50 * width + 100) * channels + 2] = 8;
  const mask = buildTextPaintDeltaMask({painted: preview, suppressed, width, height, channels});
  assert.equal(mask.pixelCount, 1);
  const region = {elementId: "text", textSha256: "a".repeat(64), left: 0, top: 0, width, height};
  const input = {preview, rendered: preview, width, height, channels,
    expectedTexts: [{elementId: region.elementId, textSha256: region.textSha256}]};
  assert.equal(compareTextParityRegions({...input, regions: [region]}).status, "INCOMPLETE");
  assert.equal(compareTextParityRegions({...input, regions: [{...region, paintMask: mask}]}).status, "PASS");
  const missing = compareTextParityRegions({...input, rendered: suppressed, regions: [{...region, paintMask: mask}]});
  assert.equal(missing.status, "FAIL");
  assert.equal(missing.regions[0]!.reason, "TEXT_PAINT_MASK_OUTSIDE_TOLERANCE");
  assert.ok(missing.regions[0]!.mismatchedPixelRatio! < 0.0005);
});
