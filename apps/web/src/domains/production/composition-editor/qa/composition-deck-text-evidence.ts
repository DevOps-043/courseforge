import { createHash } from "node:crypto";
import { z } from "zod";
import { hashDeckTextPlan, selectDeckTextCheckpointClips } from "../composition-deck-text-plan";
import type { CompositionConformanceContract } from "../composition-preview-render-conformance";
import { COMPOSITION_TEXT_PARITY_POLICY as policy } from "../composition-text-parity-policy";
import { deckTextCheckpointCaptureSchema } from "./composition-deck-text-capture";

export const deckTextCheckpointEvidenceSchema = deckTextCheckpointCaptureSchema.safeExtend({
  frameIndex: z.number().int().nonnegative(), timeSeconds: z.number().finite().nonnegative(),
}).strict();
export const deckTextEvidenceSchema = z.object({
  policy: z.literal("DECK_SOURCE_NODE_CAPTURE_V1"),
  scope: z.literal("PREVIEW_TEXT_CONTENT_GEOMETRY_NOT_PAINT_OR_RENDER_FONT_EVIDENCE"),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/), planSha256: z.string().regex(/^[a-f0-9]{64}$/),
  repeatability: z.literal("EXACT_DECK_TEXT_GEOMETRY_FORWARD_REVERSE_V1"),
  checkpoints: z.array(deckTextCheckpointEvidenceSchema).min(1).max(48),
}).strict().refine((evidence) => new Set(evidence.checkpoints.map((checkpoint) => checkpoint.frameIndex)).size === evidence.checkpoints.length
  && evidence.checkpoints.reduce((total, checkpoint) => total + checkpoint.regions.length + checkpoint.unavailable.length, 0)
    <= policy.maximumRegionsPerCapture);
export type DeckTextEvidence = z.infer<typeof deckTextEvidenceSchema>;
const addressKey = (entry: {clipId: string; nodePath: number[]}) => JSON.stringify([entry.clipId, entry.nodePath]);

export function validateDeckTextEvidence(input: unknown, contract: CompositionConformanceContract) {
  if (input === undefined) {
    if (contract.schemaVersion === 4 && contract.deckTextPlan) throw new Error("CONFORMANCE_DECK_TEXT_EVIDENCE_REQUIRED");
    return undefined;
  }
  if (contract.schemaVersion !== 4 || !contract.deckTextPlan) throw new Error("CONFORMANCE_DECK_TEXT_EVIDENCE_UNAUTHORIZED");
  const evidence = deckTextEvidenceSchema.parse(input), plan = contract.deckTextPlan;
  if (evidence.documentHash !== contract.documentHash || evidence.planSha256 !== hashDeckTextPlan(plan)
    || evidence.checkpoints.length !== contract.checkpoints.length) throw new Error("CONFORMANCE_DECK_TEXT_EVIDENCE_BINDING_MISMATCH");
  for (const checkpoint of contract.checkpoints) {
    const actual = evidence.checkpoints.find((entry) => entry.frameIndex === checkpoint.frameIndex);
    if (!actual || actual.timeSeconds !== checkpoint.timeSeconds) throw new Error("CONFORMANCE_DECK_TEXT_CHECKPOINT_MISMATCH");
    if (!contract.deckTextPaintMaskPolicy && actual.paintCapture)
      throw new Error("CONFORMANCE_DECK_PAINT_EVIDENCE_UNAUTHORIZED");
    if (contract.deckTextPaintMaskPolicy && actual.status === "CAPTURED" && actual.regions.length && !actual.paintCapture)
      throw new Error("CONFORMANCE_DECK_PAINT_EVIDENCE_REQUIRED");
    const clips = selectDeckTextCheckpointClips(plan, checkpoint.timeSeconds);
    const expected = new Map(clips.flatMap((clip) => clip.entries.map((entry) => [addressKey({...entry, clipId: clip.clipId}), entry.textSha256])));
    const addresses = [...actual.regions, ...actual.unavailable].map(addressKey);
    if (addresses.length !== expected.size || new Set(addresses).size !== addresses.length
      || addresses.some((address) => !expected.has(address))
      || actual.regions.some((region) => region.textSha256 !== expected.get(addressKey(region))))
      throw new Error("CONFORMANCE_DECK_TEXT_EXPECTATIONS_MISMATCH");
    if (JSON.stringify(actual.limitedClipIds) !== JSON.stringify(clips.filter((clip) => clip.limitations.length).map((clip) => clip.clipId)))
      throw new Error("CONFORMANCE_DECK_TEXT_LIMITATIONS_MISMATCH");
    if (actual.regions.some((region) => region.left + region.width > contract.canvas.width || region.top + region.height > contract.canvas.height)
      || actual.regions.reduce((total, region) => total + region.width * region.height, 0) > policy.maximumComparedPixels)
      throw new Error("CONFORMANCE_DECK_TEXT_GEOMETRY_LIMIT");
  }
  return evidence;
}

export function hashDeckTextEvidence(input: unknown) {
  return createHash("sha256").update(JSON.stringify(deckTextEvidenceSchema.parse(input))).digest("hex");
}
