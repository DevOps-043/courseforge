import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { z } from "zod";
import { deckTextNodeMetricId } from "../composition-deck-text-plan";
import { COMPOSITION_TEXT_PARITY_POLICY as policy, TEXT_PAINT_REGION_EXPANSION_POLICY } from "../composition-text-parity-policy";
import { deckTextCheckpointEvidenceSchema } from "./composition-deck-text-evidence";
import { deriveTextPaintMasks } from "./composition-text-paint-mask-derivation";
import { DECK_TEXT_PAINT_PAIR_POLICY } from "./composition-deck-text-paint-contract";

export function suppressedDeckTextFrameName(frameIndex: number) {
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) throw new Error("CONFORMANCE_DECK_PAINT_FRAME_INVALID");
  return `deck-text-suppressed-${frameIndex}.png`;
}
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Mechanical ROI adapter only; no native-text evidence or glyph identity is persisted. */
async function derive(input: {checkpoint: z.infer<typeof deckTextCheckpointEvidenceSchema>;
  paintedPng: Uint8Array; suppressedPng: Uint8Array; width: number; height: number}) {
  const checkpoint = deckTextCheckpointEvidenceSchema.parse(input.checkpoint);
  if (checkpoint.status !== "CAPTURED" || !checkpoint.regions.length) throw new Error("CONFORMANCE_DECK_PAINT_CHECKPOINT_INVALID");
  const source = checkpoint.paintCapture?.sourceRegions ?? checkpoint.regions.map((region) => ({
    elementId: deckTextNodeMetricId(region), left: region.left, top: region.top, width: region.width, height: region.height}));
  const originals = new Map(source.map((region) => [region.elementId, region]));
  const regions = checkpoint.regions.map((region) => ({...originals.get(deckTextNodeMetricId(region))!, textSha256: region.textSha256}));
  return deriveTextPaintMasks({...input, expandRegions: true, checkpoint: {
    policy: policy.id, frameIndex: checkpoint.frameIndex, timeSeconds: checkpoint.timeSeconds, status: "CAPTURED",
    unavailable: [], expectedTexts: regions.map(({elementId, textSha256}) => ({elementId, textSha256})), regions,
  }});
}

export async function attachDeckTextPaintMasks(input: Parameters<typeof derive>[0]) {
  if (input.checkpoint.paintCapture) throw new Error("CONFORMANCE_DECK_PAINT_CAPTURE_ALREADY_PRESENT");
  const masks = new Map((await derive(input)).map((entry) => [entry.elementId, entry]));
  return deckTextCheckpointEvidenceSchema.parse({...input.checkpoint,
    paintCapture: {policy: DECK_TEXT_PAINT_PAIR_POLICY, scope: "JOINT_DECK_TEXT_FILL_DELTA_NOT_PER_NODE_CAUSALITY",
      regionExpansionPolicy: TEXT_PAINT_REGION_EXPANSION_POLICY,
      paintedPngSha256: hash(input.paintedPng), suppressedPngSha256: hash(input.suppressedPng),
      sourceRegions: input.checkpoint.regions.map((region) => ({elementId: deckTextNodeMetricId(region),
        left: region.left, top: region.top, width: region.width, height: region.height}))},
    regions: input.checkpoint.regions.map((region) => {
      const derived = masks.get(deckTextNodeMetricId(region))!;
      return {...region, ...derived.region, paintMask: derived.mask};
    })});
}

export async function verifyDeckTextPaintPair(input: Parameters<typeof derive>[0]) {
  if (!input.paintedPng.length || !input.suppressedPng.length
    || input.paintedPng.length > policy.maximumPaintCapturePngBytes || input.suppressedPng.length > policy.maximumPaintCapturePngBytes)
    throw new Error("CONFORMANCE_DECK_PAINT_PAIR_LIMIT");
  const checkpoint = deckTextCheckpointEvidenceSchema.parse(input.checkpoint), capture = checkpoint.paintCapture;
  if (!capture || hash(input.paintedPng) !== capture.paintedPngSha256 || hash(input.suppressedPng) !== capture.suppressedPngSha256)
    throw new Error("CONFORMANCE_DECK_PAINT_PAIR_MISMATCH");
  for (const entry of await derive({...input, checkpoint})) {
    const region = checkpoint.regions.find((region) => deckTextNodeMetricId(region) === entry.elementId)!;
    if (!isDeepStrictEqual(entry.region, {left: region.left, top: region.top, width: region.width, height: region.height})
      || !isDeepStrictEqual(entry.mask, region.paintMask)) throw new Error("CONFORMANCE_DECK_PAINT_RECOMPUTATION_MISMATCH");
  }
}
