import { captureCompositionQaScreenshot, type CompositionQaCdpClient } from "./composition-qa-browser";
import { captureDeckTextPaintPair } from "./composition-deck-text-paint-capture";
import { attachDeckTextPaintMasks } from "./composition-deck-text-paint-derivation";
import { deckTextCheckpointEvidenceSchema } from "./composition-deck-text-evidence";
import type { z } from "zod";

/** Incomplete DOM reads cannot acquire a paint witness; restoration precedes retention. */
export async function captureDeckTextPaintMasks(client: CompositionQaCdpClient, input: {
  checkpoint: z.infer<typeof deckTextCheckpointEvidenceSchema>; paintedPng: Uint8Array; width: number; height: number;
}, retainSuppressed: (png: Uint8Array) => Promise<void>, screenshot = captureCompositionQaScreenshot) {
  const checkpoint = deckTextCheckpointEvidenceSchema.parse(input.checkpoint);
  if (checkpoint.status !== "CAPTURED" || !checkpoint.regions.length) return checkpoint;
  const pair = await captureDeckTextPaintPair(client, [...new Set(checkpoint.regions.map((region) => region.clipId))], input.paintedPng, screenshot);
  const result = await attachDeckTextPaintMasks({...input, checkpoint, suppressedPng: pair.suppressedPng});
  await retainSuppressed(pair.suppressedPng);
  return result;
}
