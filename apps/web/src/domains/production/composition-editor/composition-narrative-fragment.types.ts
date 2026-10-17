import { z } from "zod";
import type { CompositionEditorPatchOperation } from "./editor-patch.types";
import type { NarrativeCaptionExtractionWarning } from "./composition-narrative-caption-extraction";
import type { NarrativeVoiceExtractionPlan, NarrativeExtractionFailure } from "./composition-narrative-extraction.service";
import type { ConformanceFontManifest } from "./composition-conformance-font-bindings";

export const NARRATIVE_FRAGMENT_MAX_CLIPS = 48;
export const NARRATIVE_FRAGMENT_MAX_TRACKS = 20;
export const narrativeFragmentIntentSchema = z.object({
  selectedTrackIds: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,127}$/i)).min(2).max(NARRATIVE_FRAGMENT_MAX_TRACKS),
  commandId: z.string().uuid(),
}).strict().refine(value => new Set(value.selectedTrackIds).size === value.selectedTrackIds.length, "Duplicate tracks");

export interface NarrativeFragmentAssetBinding {
  assetId: string; checksum: string; qaStatus: string; durationMilliseconds: number | null;
}
export interface NarrativeFragmentPlan {
  contract: "NARRATIVE_AUDIOVISUAL_FRAGMENT_PLAN_V1"; scope: "AUDIOVISUAL";
  binding: "REGISTRY_METADATA_MATCH_ONLY"; documentHash: string;
  anchor: NarrativeVoiceExtractionPlan; selectedTrackIds: string[];
  candidateClipIds: string[];
  sourceStartSeconds: number; sourceEndSeconds: number;
  destinationStartSeconds: number; destinationEndSeconds: number;
  copies: { sourceClipId: string; newClipId: string; newHfId: string }[];
  assets: NarrativeFragmentAssetBinding[];
  fontAssetIds: string[];
  fontBindings: ConformanceFontManifest;
  warnings: (NarrativeCaptionExtractionWarning & { clipId: string })[];
  operations: CompositionEditorPatchOperation[];
}
export type NarrativeFragmentFailure = NarrativeExtractionFailure | "INVALID_TRACK_SELECTION" | "MISSING_REQUIRED_CLIP"
  | "TOO_MANY_CLIPS" | "NO_VISUAL_CONTENT" | "SOURCE_KIND_UNSUPPORTED" | "LINK_TIMING_MISMATCH";
export type NarrativeFragmentPlanResult = { ok: true; plan: NarrativeFragmentPlan } | { ok: false; reason: NarrativeFragmentFailure };
