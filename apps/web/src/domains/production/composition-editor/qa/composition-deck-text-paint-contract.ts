import { z } from "zod";
import { textPaintSourceRegionsSchema } from "./composition-text-paint-region-expansion";
import { TEXT_PAINT_REGION_EXPANSION_POLICY } from "../composition-text-parity-policy";

import { DECK_TEXT_PAINT_PAIR_POLICY } from "../composition-deck-text-paint-policy";
export { DECK_TEXT_PAINT_PAIR_POLICY } from "../composition-deck-text-paint-policy";
export const deckTextPaintCaptureSchema = z.object({
  policy: z.literal(DECK_TEXT_PAINT_PAIR_POLICY),
  scope: z.literal("JOINT_DECK_TEXT_FILL_DELTA_NOT_PER_NODE_CAUSALITY"),
  // Same deterministic nearest-original-ROI algorithm; the policy is not a native glyph claim.
  regionExpansionPolicy: z.literal(TEXT_PAINT_REGION_EXPANSION_POLICY),
  sourceRegions: textPaintSourceRegionsSchema,
  paintedPngSha256: z.string().regex(/^[a-f0-9]{64}$/),
  suppressedPngSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
