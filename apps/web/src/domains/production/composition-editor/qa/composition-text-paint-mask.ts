import { z } from "zod";
import { COMPOSITION_TEXT_PARITY_POLICY as policy } from "../composition-text-parity-policy";

const MAX_PAINT_MASK_RUNS = 65_536;
export const textPaintMaskSchema = z.object({
  scope: z.literal("SUPPLEMENTAL_PREVIEW_PAINT_PIXELS_NOT_GLYPH_IDENTITY"),
  width: z.number().int().positive(), height: z.number().int().positive(),
  pixelCount: z.number().int().nonnegative().max(policy.maximumComparedPixels),
  runs: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().positive()])).max(MAX_PAINT_MASK_RUNS),
}).strict().superRefine((mask, context) => {
  const area = mask.width * mask.height;
  let end = -1, count = 0;
  const invalid = mask.runs.some(([start, length]) => {
    const overlap = start <= end || start + length > area;
    end = start + length; count += length;
    return overlap;
  });
  if (!Number.isSafeInteger(area) || area > policy.maximumComparedPixels || invalid || count !== mask.pixelCount)
    context.addIssue({code: "custom", message: "CONFORMANCE_TEXT_PAINT_MASK_INVALID"});
});
export type TextPaintMask = z.infer<typeof textPaintMaskSchema>;

/** Difference against an independently captured text-suppressed frame; not inferred from contrast or OCR. */
export function buildTextPaintDeltaMask(input: {
  painted: Uint8Array; suppressed: Uint8Array; width: number; height: number; channels: number;
}) {
  const {painted, suppressed, width, height, channels} = input;
  const area = width * height;
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0
    || !Number.isSafeInteger(area) || area > policy.maximumComparedPixels || channels !== 3 && channels !== 4
    || painted.length !== area * channels || suppressed.length !== painted.length)
    throw new Error("CONFORMANCE_TEXT_PAINT_MASK_FRAME_INVALID");
  const runs: Array<[number, number]> = [];
  let runStart = -1, pixelCount = 0;
  const finishRun = (end: number) => {
    if (runStart < 0) return;
    if (runs.length >= MAX_PAINT_MASK_RUNS) throw new Error("CONFORMANCE_TEXT_PAINT_MASK_RUN_LIMIT");
    runs.push([runStart, end - runStart]); runStart = -1;
  };
  for (let pixel = 0; pixel < area; pixel++) {
    const offset = pixel * channels;
    if (channels === 4 && (painted[offset + 3] !== 255 || suppressed[offset + 3] !== 255))
      throw new Error("CONFORMANCE_TEXT_PAINT_MASK_ALPHA_INVALID");
    let changed = false;
    for (let channel = 0; channel < 3; channel++) {
      if (Math.abs(painted[offset + channel]! - suppressed[offset + channel]!) > policy.pixelDifferenceThreshold) changed = true;
    }
    if (changed) {pixelCount++; if (runStart < 0) runStart = pixel;}
    else finishRun(pixel);
  }
  finishRun(area);
  return textPaintMaskSchema.parse({scope: "SUPPLEMENTAL_PREVIEW_PAINT_PIXELS_NOT_GLYPH_IDENTITY", width, height, pixelCount, runs});
}

/** Only supplements full-ROI parity. Ignoring non-mask pixels is never allowed for the overall text gate. */
export function measureTextPaintMask(input: {mask: TextPaintMask; preview: Uint8Array; rendered: Uint8Array;
  frameWidth: number; channels: number; left: number; top: number; shiftX: number; shiftY: number}) {
  let absoluteError = 0, mismatchedPixels = 0;
  const mask = textPaintMaskSchema.parse(input.mask);
  const frameHeight = input.preview.length / (input.frameWidth * input.channels);
  if (![input.frameWidth, frameHeight, input.left, input.top, input.shiftX, input.shiftY].every(Number.isSafeInteger)
    || input.frameWidth <= 0 || frameHeight <= 0 || input.channels !== 3 && input.channels !== 4
    || input.preview.length !== input.rendered.length || input.frameWidth * frameHeight > policy.maximumFramePixels
    || Math.abs(input.shiftX) > policy.maximumDisplacementPixels || Math.abs(input.shiftY) > policy.maximumDisplacementPixels
    || input.left < 0 || input.top < 0 || input.left + mask.width > input.frameWidth || input.top + mask.height > frameHeight
    || input.left + input.shiftX < 0 || input.top + input.shiftY < 0
    || input.left + input.shiftX + mask.width > input.frameWidth || input.top + input.shiftY + mask.height > frameHeight)
    throw new Error("CONFORMANCE_TEXT_PAINT_MASK_FRAME_INVALID");
  if (mask.pixelCount === 0) return null;
  for (const [start, length] of mask.runs) for (let pixel = start; pixel < start + length; pixel++) {
    const x = input.left + pixel % mask.width, y = input.top + Math.floor(pixel / mask.width);
    const first = (y * input.frameWidth + x) * input.channels;
    const second = ((y + input.shiftY) * input.frameWidth + x + input.shiftX) * input.channels;
    if (input.channels === 4 && (input.preview[first + 3] !== 255 || input.rendered[second + 3] !== 255))
      throw new Error("CONFORMANCE_TEXT_PAINT_MASK_ALPHA_INVALID");
    let mismatch = false;
    for (let channel = 0; channel < 3; channel++) {
      const difference = Math.abs(input.preview[first + channel]! - input.rendered[second + channel]!);
      absoluteError += difference; if (difference > policy.pixelDifferenceThreshold) mismatch = true;
    }
    if (mismatch) mismatchedPixels++;
  }
  return {pixelCount: mask.pixelCount, meanAbsoluteError: absoluteError / (3 * mask.pixelCount),
    mismatchedPixelRatio: mismatchedPixels / mask.pixelCount};
}
