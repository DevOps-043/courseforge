import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { buildDeckConformanceCorpusCase } from "../qa/composition-deck-conformance-corpus";
import { attachDeckTextPaintMasks, verifyDeckTextPaintPair, suppressedDeckTextFrameName } from "../qa/composition-deck-text-paint-derivation";
import { deckTextCheckpointEvidenceSchema } from "../qa/composition-deck-text-evidence";

async function fixture(halo = true) {
  const {sourceTextPlan} = buildDeckConformanceCorpusCase("deck-basic", 25), clip = sourceTextPlan.clips[0]!;
  const width = 48, height = 24;
  const suppressed = Buffer.alloc(width * height * 4);
  for (let offset = 3; offset < suppressed.length; offset += 4) suppressed[offset] = 255;
  const painted = Buffer.from(suppressed);
  for (let y = 6; y < 10; y++) for (let x = 10; x < 14; x++) painted.fill(240, (y * width + x) * 4, (y * width + x) * 4 + 3);
  if (halo) painted.fill(240, (8 * width + 34) * 4, (8 * width + 34) * 4 + 3);
  const png = (bytes: Buffer) => sharp(bytes, {raw: {width, height, channels: 4}}).png().toBuffer();
  const checkpoint = deckTextCheckpointEvidenceSchema.parse({frameIndex: 0, timeSeconds: 0, status: "CAPTURED",
    unavailable: [], limitedClipIds: [], regions: [{clipId: clip.clipId, ...clip.entries[0]!, left: 8, top: 4, width: 20, height: 12}]});
  return {checkpoint, width, height, paintedPng: await png(painted), suppressedPng: await png(suppressed)};
}

test("deck masks retain original geometry, expand to joint halo and recompute exactly from private pair", async () => {
  const input = await fixture(), checkpoint = await attachDeckTextPaintMasks(input);
  assert.equal(checkpoint.paintCapture!.sourceRegions[0]!.width, 20);
  assert.equal(checkpoint.regions[0]!.width, 27);
  assert.equal(checkpoint.regions[0]!.paintMask!.pixelCount, 17);
  assert.equal(checkpoint.paintCapture!.scope, "JOINT_DECK_TEXT_FILL_DELTA_NOT_PER_NODE_CAUSALITY");
  await verifyDeckTextPaintPair({...input, checkpoint});
  assert.throws(() => suppressedDeckTextFrameName(-1), /FRAME_INVALID/);
  assert.equal(suppressedDeckTextFrameName(0), "deck-text-suppressed-0.png");
});

test("pair bytes, RLE or expanded geometry cannot be replaced by a self-consistent declaration", async () => {
  const input = await fixture(), original = await attachDeckTextPaintMasks(input);
  await assert.rejects(verifyDeckTextPaintPair({...input, checkpoint: original, suppressedPng: input.paintedPng}), /PAIR_MISMATCH/);
  const mask = structuredClone(original); mask.regions[0]!.paintMask!.runs = []; mask.regions[0]!.paintMask!.pixelCount = 0;
  await assert.rejects(verifyDeckTextPaintPair({...input, checkpoint: mask}), /RECOMPUTATION_MISMATCH/);
  const geometry = structuredClone(original); geometry.regions[0]!.left++;
  await assert.rejects(verifyDeckTextPaintPair({...input, checkpoint: geometry}), /RECOMPUTATION_MISMATCH/);
});

test("mask omission, reordered addresses and incomplete checkpoints cannot acquire paint evidence", async () => {
  const input = await fixture(), checkpoint = await attachDeckTextPaintMasks(input);
  const omitted = structuredClone(checkpoint); delete omitted.regions[0]!.paintMask;
  assert.equal(deckTextCheckpointEvidenceSchema.safeParse(omitted).success, false);
  const detached = structuredClone(checkpoint); delete detached.paintCapture;
  assert.equal(deckTextCheckpointEvidenceSchema.safeParse(detached).success, false);
  const address = structuredClone(checkpoint); address.paintCapture!.sourceRegions[0]!.elementId = "unrelated";
  assert.equal(deckTextCheckpointEvidenceSchema.safeParse(address).success, false);
  const incomplete = {...input.checkpoint, status: "INCOMPLETE" as const, limitedClipIds: [input.checkpoint.regions[0]!.clipId]};
  await assert.rejects(attachDeckTextPaintMasks({...input, checkpoint: incomplete}), /CHECKPOINT_INVALID/);
});
