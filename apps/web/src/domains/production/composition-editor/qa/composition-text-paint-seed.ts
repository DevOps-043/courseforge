import { z } from "zod";
import { OFFCANVAS_TEXT_PAINT_SEED_POLICY } from "../composition-text-parity-policy";

/** A visible-canvas allocation seed, explicitly not the measured DOM text rectangle. */
export const offcanvasTextPaintSeedSchema = z.object({
  policy: z.literal(OFFCANVAS_TEXT_PAINT_SEED_POLICY),
  originalBounds: z.object({left: z.number().finite(), top: z.number().finite(),
    right: z.number().finite(), bottom: z.number().finite()}).strict()
    .refine((bounds) => bounds.right > bounds.left && bounds.bottom > bounds.top),
}).strict();

export function validateOffcanvasTextPaintSeed(input: z.infer<typeof offcanvasTextPaintSeedSchema>, width: number, height: number) {
  const {originalBounds: bounds} = offcanvasTextPaintSeedSchema.parse(input);
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0
    || !(bounds.right <= 0 || bounds.bottom <= 0 || bounds.left >= width || bounds.top >= height))
    throw new Error("CONFORMANCE_TEXT_PAINT_SEED_INVALID");
  return {left: Math.min(width - 1, Math.max(0, Math.floor(bounds.left))),
    top: Math.min(height - 1, Math.max(0, Math.floor(bounds.top))), width: 1, height: 1};
}
