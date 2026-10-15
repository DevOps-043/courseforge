import { z } from "zod";
import { COMPOSITION_TEXT_PARITY_POLICY as policy } from "../composition-text-parity-policy";
export { TEXT_PAINT_REGION_EXPANSION_POLICY } from "../composition-text-parity-policy";
const MAX_ASSIGNMENT_CHECKS = 8_388_608;
export const textPaintSourceRegionsSchema = z.array(z.object({elementId: z.string().min(1).max(280),
  left: z.number().int().nonnegative(), top: z.number().int().nonnegative(),
  width: z.number().int().positive(), height: z.number().int().positive(),
}).strict()).min(1).max(policy.maximumRegions).refine((regions) =>
  new Set(regions.map((region) => region.elementId)).size === regions.length
  && regions.reduce((area, region) => area + region.width * region.height, 0) <= policy.maximumComparedPixels);
export type TextPaintSourceRegion = z.infer<typeof textPaintSourceRegionsSchema>[number];

/** Joint paint support: nearest ROI is only a deterministic allocation, never causal attribution. */
export function expandTextPaintRegions(input: {
  regions: TextPaintSourceRegion[]; painted: Uint8Array; suppressed: Uint8Array; width: number; height: number;
}) {
  const regions = textPaintSourceRegionsSchema.parse(input.regions);
  const {width, height, painted, suppressed} = input;
  const area = width * height;
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0
    || !Number.isSafeInteger(area) || area > policy.maximumFramePixels || painted.length !== area * 4
    || suppressed.length !== painted.length || regions.some((region) => region.left + region.width > width || region.top + region.height > height))
    throw new Error("CONFORMANCE_TEXT_PAINT_EXPANSION_INVALID");
  const coverage = new Uint8Array(area);
  const bounds = regions.map((region) => ({left: region.left, top: region.top, right: region.left + region.width, bottom: region.top + region.height}));
  for (const region of regions) for (let row = 0; row < region.height; row++) {
    const start = (region.top + row) * width + region.left; coverage.fill(1, start, start + region.width);
  }
  let assignmentChecks = 0;
  for (let pixel = 0; pixel < area; pixel++) {
    const offset = pixel * 4;
    if (painted[offset + 3] !== 255 || suppressed[offset + 3] !== 255) throw new Error("CONFORMANCE_TEXT_PAINT_MASK_NON_OPAQUE");
    if (coverage[pixel] || Math.abs(painted[offset]! - suppressed[offset]!) <= policy.pixelDifferenceThreshold
      && Math.abs(painted[offset + 1]! - suppressed[offset + 1]!) <= policy.pixelDifferenceThreshold
      && Math.abs(painted[offset + 2]! - suppressed[offset + 2]!) <= policy.pixelDifferenceThreshold) continue;
    const x = pixel % width, y = Math.floor(pixel / width);
    let nearestIndex = 0, nearestDistance = Infinity;
    for (let index = 0; index < regions.length; index++) {
      if (++assignmentChecks > MAX_ASSIGNMENT_CHECKS) throw new Error("CONFORMANCE_TEXT_PAINT_EXPANSION_WORK_LIMIT");
      const region = regions[index]!;
      const dx = Math.max(region.left - x, 0, x - (region.left + region.width - 1));
      const dy = Math.max(region.top - y, 0, y - (region.top + region.height - 1));
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) {nearestDistance = distance; nearestIndex = index;}
    }
    const bound = bounds[nearestIndex]!;
    bound.left = Math.min(bound.left, x); bound.top = Math.min(bound.top, y);
    bound.right = Math.max(bound.right, x + 1); bound.bottom = Math.max(bound.bottom, y + 1);
  }
  return textPaintSourceRegionsSchema.parse(regions.map((region, index) => {
    const bound = bounds[index]!;
    return {...region, left: bound.left, top: bound.top, width: bound.right - bound.left, height: bound.bottom - bound.top};
  }));
}
