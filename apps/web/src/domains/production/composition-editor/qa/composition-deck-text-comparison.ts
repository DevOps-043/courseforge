import { z } from "zod";
import { deckTextNodeMetricId, selectDeckTextCheckpointClips, type DeckTextPlan } from "../composition-deck-text-plan";
import { textRegionReportSchema } from "../composition-text-parity-contract";
import { compareTextParityRegions } from "./composition-text-region-comparison";
import { deckTextCheckpointEvidenceSchema } from "./composition-deck-text-evidence";

/** Strict padded ROI measurement only. No deck paint-mask/font/occlusion claim is made. */
export function compareDeckTextRegions(input: {
  preview: Uint8Array; rendered: Uint8Array; width: number; height: number; channels: number;
  plan: DeckTextPlan; checkpoint: z.infer<typeof deckTextCheckpointEvidenceSchema>;
}) {
  const checkpoint = deckTextCheckpointEvidenceSchema.parse(input.checkpoint);
  const expectedTexts = selectDeckTextCheckpointClips(input.plan, checkpoint.timeSeconds).flatMap((clip) =>
    clip.entries.map((entry) => ({elementId: deckTextNodeMetricId({clipId: clip.clipId, nodePath: entry.nodePath}), textSha256: entry.textSha256})));
  const regions = checkpoint.regions.map(({clipId, nodePath, ...region}) => ({...region, elementId: deckTextNodeMetricId({clipId, nodePath})}));
  return textRegionReportSchema.parse(compareTextParityRegions({...input, regions, expectedTexts}));
}
