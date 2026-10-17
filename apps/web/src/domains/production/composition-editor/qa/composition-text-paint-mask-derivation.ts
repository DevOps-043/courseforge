import { createHash } from "node:crypto";
import sharp from "sharp";
import { isDeepStrictEqual } from "node:util";
import { COMPOSITION_TEXT_PARITY_POLICY as policy } from "../composition-text-parity-policy";
import { buildTextPaintDeltaMask } from "./composition-text-paint-mask";
import { textCheckpointEvidenceSchema } from "./composition-text-parity-evidence";
import type { z } from "zod";
import { expandTextPaintRegions } from "./composition-text-paint-region-expansion";
import { validateOffcanvasTextPaintSeed } from "./composition-text-paint-seed";

export function suppressedTextFrameName(frameIndex: number) {
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) throw new Error("CONFORMANCE_TEXT_PAINT_FRAME_INVALID");
  return `text-suppressed-${frameIndex}.png`;
}

/** Reproduce masks from the captured pair, not from declarations of changed pixels. */
export async function deriveTextPaintMasks(input: {
  checkpoint: z.infer<typeof textCheckpointEvidenceSchema>; paintedPng: Uint8Array; suppressedPng: Uint8Array;
  width: number; height: number; expandRegions?: boolean;
}) {
  const checkpoint = textCheckpointEvidenceSchema.parse(input.checkpoint);
  let regions = checkpoint.regions.filter((region) => !region.regionKind);
  for (const region of regions) if (region.paintSeed) {
    const seed = validateOffcanvasTextPaintSeed(region.paintSeed, input.width, input.height);
    const original = checkpoint.paintMaskCapture?.sourceRegions?.find((source) => source.elementId === region.elementId) ?? region;
    if (original.left !== seed.left || original.top !== seed.top || original.width !== seed.width || original.height !== seed.height)
      throw new Error("CONFORMANCE_TEXT_PAINT_SEED_INVALID");
  }
  if (!Number.isSafeInteger(input.width) || input.width <= 0 || !Number.isSafeInteger(input.height) || input.height <= 0
    || input.width * input.height > policy.maximumFramePixels
    || regions.reduce((pixels, region) => pixels + region.width * region.height, 0) > policy.maximumComparedPixels
    || regions.some((region) => region.left + region.width > input.width || region.top + region.height > input.height))
    throw new Error("CONFORMANCE_TEXT_PAINT_CAPTURE_LIMIT");
  const images = await Promise.all([input.paintedPng, input.suppressedPng].map(async (png) => {
    if (!png.length || png.length > policy.maximumPaintCapturePngBytes) throw new Error("CONFORMANCE_TEXT_PAINT_CAPTURE_LIMIT");
    const decoder = sharp(png, {limitInputPixels: policy.maximumFramePixels});
    if ((await decoder.metadata()).format !== "png") throw new Error("CONFORMANCE_TEXT_PAINT_CAPTURE_IMAGE_INVALID");
    const decoded = await decoder.ensureAlpha().raw().toBuffer({resolveWithObject: true});
    if (decoded.info.width !== input.width || decoded.info.height !== input.height || decoded.info.channels !== 4)
      throw new Error("CONFORMANCE_TEXT_PAINT_CAPTURE_IMAGE_INVALID");
    return decoded.data;
  }));
  if (input.expandRegions === true || checkpoint.paintMaskCapture?.regionExpansionPolicy) {
    const original = checkpoint.paintMaskCapture?.sourceRegions ?? regions.map(({elementId, left, top, width, height}) =>
      ({elementId, left, top, width, height}));
    const expanded = expandTextPaintRegions({regions: original, painted: images[0]!, suppressed: images[1]!,
      width: input.width, height: input.height});
    if (checkpoint.paintMaskCapture?.regionExpansionPolicy && !isDeepStrictEqual(expanded,
      regions.map(({elementId, left, top, width, height}) => ({elementId, left, top, width, height}))))
      throw new Error("CONFORMANCE_TEXT_PAINT_EXPANSION_RECOMPUTATION_MISMATCH");
    regions = regions.map((region, index) => ({...region, ...expanded[index]!}));
  }
  // A crop cannot silently discard shadow/blur/overflow painted by the suppressed targets.
  // Coverage is a union, not attribution to one glyph or one overlapping element.
  const coverage = new Uint8Array(input.width * input.height);
  for (const region of regions) for (let row = 0; row < region.height; row++) {
    const offset = (region.top + row) * input.width + region.left;
    coverage.fill(1, offset, offset + region.width);
  }
  const painted = images[0]!, suppressed = images[1]!;
  for (let pixel = 0; pixel < coverage.length; pixel++) {
    const offset = pixel * 4;
    if (painted[offset + 3] !== 255 || suppressed[offset + 3] !== 255)
      throw new Error("CONFORMANCE_TEXT_PAINT_MASK_NON_OPAQUE");
    if (coverage[pixel]) continue;
    if (Math.abs(painted[offset]! - suppressed[offset]!) > policy.pixelDifferenceThreshold
      || Math.abs(painted[offset + 1]! - suppressed[offset + 1]!) > policy.pixelDifferenceThreshold
      || Math.abs(painted[offset + 2]! - suppressed[offset + 2]!) > policy.pixelDifferenceThreshold)
      throw new Error("CONFORMANCE_TEXT_PAINT_OUTSIDE_CAPTURED_REGIONS");
  }
  return regions.map((region) => {
    const crop = (bytes: Uint8Array) => {
      const cropped = Buffer.alloc(region.width * region.height * 4);
      for (let row = 0; row < region.height; row++) {
        const offset = ((region.top + row) * input.width + region.left) * 4;
        cropped.set(bytes.subarray(offset, offset + region.width * 4), row * region.width * 4);
      }
      return cropped;
    };
    return {elementId: region.elementId, region: {left: region.left, top: region.top, width: region.width, height: region.height},
      mask: buildTextPaintDeltaMask({painted: crop(images[0]!), suppressed: crop(images[1]!),
      width: region.width, height: region.height, channels: 4})};
  });
}

export async function verifyTextPaintMaskPair(input: Parameters<typeof deriveTextPaintMasks>[0]) {
  const capture = input.checkpoint.paintMaskCapture;
  const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  if (!capture || hash(input.paintedPng) !== capture.paintedPngSha256 || hash(input.suppressedPng) !== capture.suppressedPngSha256)
    throw new Error("CONFORMANCE_TEXT_PAINT_CAPTURE_FRAME_MISMATCH");
  for (const derived of await deriveTextPaintMasks(input)) {
    if (!isDeepStrictEqual(derived.mask, input.checkpoint.regions.find((region) => region.elementId === derived.elementId)?.paintMask))
      throw new Error("CONFORMANCE_TEXT_PAINT_MASK_RECOMPUTATION_MISMATCH");
  }
}
