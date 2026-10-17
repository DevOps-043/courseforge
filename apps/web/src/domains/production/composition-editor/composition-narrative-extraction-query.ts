import { createHash, randomUUID } from "node:crypto";
import type { CompositionEditorDocument } from "./composition-document.types";
import { buildNarrativeVoiceExtractionPlan, type NarrativeVoiceExtractionPlan } from "./composition-narrative-extraction.service";
import { resolveNarrativeRangePreview } from "./composition-narrative-range.service";
import { narrativeExtractionQuerySchema, type NarrativeExtractionQuery } from "./composition-narrative-extraction-contract";
export { narrativeExtractionQuerySchema, NARRATIVE_EXTRACTION_QUERY_MAX_BYTES } from "./composition-narrative-extraction-contract";
export type { NarrativeExtractionQuery } from "./composition-narrative-extraction-contract";

/** Implementations must scope every read to the authenticated organization. */
export interface NarrativeExtractionReadRepository {
  readComponentId(draftId: string, organizationId: string): Promise<string | null>;
  readDocument(draftId: string, organizationId: string): Promise<{ document: CompositionEditorDocument; documentHash: string }>;
  readLinkedAsset(draftId: string, organizationId: string, componentId: string, assetId: string): Promise<unknown | null>;
}

/** Reconstructs an eligible internal plan from scoped reads; callers must not expose its operations as authorization. */
export async function loadNarrativeVoiceExtractionPlan(params: {
  draftId: string;
  organizationId: string;
  selection: NarrativeExtractionQuery;
  repository: NarrativeExtractionReadRepository;
  identity: string;
}) {
  const selection = narrativeExtractionQuerySchema.parse(params.selection);
  const componentId = await params.repository.readComponentId(params.draftId, params.organizationId);
  if (!componentId) return { ok: false, reason: "DRAFT_NOT_FOUND" } as const;
  const current = await params.repository.readDocument(params.draftId, params.organizationId);
  if (current.documentHash !== selection.documentHash) return { ok: false, reason: "STALE_DOCUMENT" } as const;
  const range = resolveNarrativeRangePreview(current.document, current.documentHash, selection);
  if (!range.ok) return { ok: false, reason: "INVALID_RANGE" } as const;
  const clip = current.document.clips.find((candidate) => candidate.id === range.range.clipId)!;
  if (clip.source.type !== "PRODUCTION_ASSET") return { ok: false, reason: "CLIP_NOT_ELIGIBLE" } as const;
  const assetId = clip.source.productionAssetId;
  const registryAsset = await params.repository.readLinkedAsset(params.draftId, params.organizationId, componentId, assetId);
  if (!registryAsset) return { ok: false, reason: "ASSET_BINDING_UNAVAILABLE" } as const;
  return buildNarrativeVoiceExtractionPlan({ ...current, selection, organizationId: params.organizationId,
    componentId, registryAsset, linkedAssetIds: [assetId], newClipId: `voice-extract-${params.identity}`, newHfId: `hf-voice-extract-${params.identity}` });
}

/** Opaque review binding, not proof of authorization or immutable Storage bytes. */
export function fingerprintNarrativeVoiceExtractionPlan(plan: NarrativeVoiceExtractionPlan) {
  return createHash("sha256").update(JSON.stringify(["NARRATIVE_EXTRACTION_REVIEW_V1", plan.documentHash,
    plan.sourceAssetId, plan.sourceClipId, plan.sourceChecksum, plan.sourceScriptHash, plan.sourceQaStatus, plan.sourceDurationMilliseconds,
    plan.sourceStartSeconds, plan.sourceEndSeconds, plan.destinationStartSeconds, plan.destinationEndSeconds,
    plan.scope, plan.binding])).digest("hex");
}

/** Returns only a review summary; does not persist or grant permission to apply. */
export async function queryNarrativeVoiceExtraction(params: {
  draftId: string; organizationId: string; selection: NarrativeExtractionQuery; repository: NarrativeExtractionReadRepository;
}) {
  const result = await loadNarrativeVoiceExtractionPlan({ ...params, identity: randomUUID() });
  if (!result.ok) return result;
  const plan = result.plan;
  return { ok: true, summary: {
    contract: "NARRATIVE_VOICE_EXTRACTION_ELIGIBILITY_V2" as const,
    reviewFingerprint: fingerprintNarrativeVoiceExtractionPlan(plan),
    documentHash: plan.documentHash, scope: plan.scope, binding: plan.binding,
    sourceStartSeconds: plan.sourceStartSeconds, sourceEndSeconds: plan.sourceEndSeconds,
    destinationStartSeconds: plan.destinationStartSeconds, destinationEndSeconds: plan.destinationEndSeconds,
    requiresRevalidationBeforeApply: true as const,
  } } as const;
}
