import { createHash } from "node:crypto";
import { fingerprintNarrativeVoiceExtractionPlan } from "./composition-narrative-extraction-query";
import type { NarrativeFragmentPlan } from "./composition-narrative-fragment.types";
import { normalizeConformanceFontManifest } from "./composition-conformance-font-bindings";

/** Opaque binding of selection and every registry source; generated copy IDs do not grant authority. */
export function fingerprintNarrativeFragmentPlan(plan: NarrativeFragmentPlan): string {
  const assets = [...plan.assets].sort((left, right) => left.assetId.localeCompare(right.assetId, "en"))
    .map(asset => [asset.assetId, asset.checksum, asset.qaStatus, asset.durationMilliseconds]);
  return createHash("sha256").update(JSON.stringify(["NARRATIVE_FRAGMENT_REVIEW_V1", plan.documentHash,
    fingerprintNarrativeVoiceExtractionPlan(plan.anchor), [...plan.selectedTrackIds].sort(), plan.candidateClipIds,
    plan.sourceStartSeconds, plan.sourceEndSeconds, plan.destinationStartSeconds, plan.destinationEndSeconds,
    plan.copies.map(copy => copy.sourceClipId).sort(), assets, [...plan.fontAssetIds].sort(),
    normalizeConformanceFontManifest(plan.fontBindings), plan.scope, plan.binding])).digest("hex");
}
