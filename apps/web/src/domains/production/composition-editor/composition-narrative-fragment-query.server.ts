import { z } from "zod";
import type { NarrativeExtractionReadRepository } from "./composition-narrative-extraction-query";
import { narrativeFragmentQuerySchema, narrativeFragmentSummarySchema, type NarrativeFragmentQuery } from "./composition-narrative-fragment-contract";
import { resolveNarrativeRangePreview } from "./composition-narrative-range.service";
import { selectNarrativeFragmentClips } from "./composition-narrative-fragment-selection";
import { NARRATIVE_FRAGMENT_MAX_CLIPS } from "./composition-narrative-fragment.types";
import { buildNarrativeFragmentPlan } from "./composition-narrative-fragment.service";
import { fingerprintNarrativeFragmentPlan } from "./composition-narrative-fragment-review.server";
import { assertDocumentConformanceFontBindings, conformanceFontManifestSchema, CONFORMANCE_FONT_BINDING_LIMITS } from "./composition-conformance-font-bindings";

type Scope = { draftId: string; organizationId: string; componentId: string };
export interface NarrativeFragmentReadRepository extends Pick<NarrativeExtractionReadRepository, "readComponentId" | "readDocument"> {
  /** Batch must verify draft links and return only matching organization/component records. */
  readAssets(scope: Scope, ids: readonly string[], anchorAssetId: string): Promise<unknown[]>;
  readFonts(organizationId: string, ids: readonly string[]): Promise<unknown[]>;
}
const fontBinding = conformanceFontManifestSchema.element;
const fontRowSchema = z.object({ id: fontBinding.shape.fontAssetId, organization_id: z.string().uuid(), source: z.literal("uploaded"), status: z.literal("READY"),
  family: fontBinding.shape.family, checksum_sha256: fontBinding.shape.checksumSha256,
  file_size_bytes: fontBinding.shape.fileSizeBytes, mime_type: fontBinding.shape.mimeType }).strict();

/** Caller supplies authenticated tenant; client may only provide selection and chosen tracks. No writes. */
export async function loadNarrativeFragmentPlan(params: { draftId: string; organizationId: string;
  request: NarrativeFragmentQuery; commandId: string; repository: NarrativeFragmentReadRepository; signal: AbortSignal }) {
  const uuid = z.string().uuid(); uuid.parse(params.draftId); uuid.parse(params.organizationId); uuid.parse(params.commandId);
  const request = narrativeFragmentQuerySchema.parse(params.request);
  const check = () => params.signal.throwIfAborted(); check();
  const componentId = await params.repository.readComponentId(params.draftId, params.organizationId); check();
  if (!componentId) return { ok: false, reason: "DRAFT_NOT_FOUND" } as const;
  uuid.parse(componentId);
  const current = await params.repository.readDocument(params.draftId, params.organizationId); check();
  if (current.documentHash !== request.selection.documentHash) return { ok: false, reason: "STALE_DOCUMENT" } as const;
  const range = resolveNarrativeRangePreview(current.document, current.documentHash, request.selection);
  if (!range.ok) return { ok: false, reason: "INVALID_RANGE" } as const;
  const tracks = new Map(current.document.tracks.map(track => [track.id, track]));
  if (request.selectedTrackIds.some(id => !tracks.has(id))) return { ok: false, reason: "INVALID_TRACK_SELECTION" } as const;
  if (request.selectedTrackIds.some(id => tracks.get(id)!.locked || tracks.get(id)!.hidden)) return { ok: false, reason: "LOCKED_TRACK" } as const;
  const clips = selectNarrativeFragmentClips(current.document, request.selectedTrackIds, range.range.startSeconds, range.range.endSeconds);
  if (clips.length > NARRATIVE_FRAGMENT_MAX_CLIPS) return { ok: false, reason: "TOO_MANY_CLIPS" } as const;
  const anchor = clips.find(clip => clip.id === range.range.clipId);
  if (!anchor || anchor.source.type !== "PRODUCTION_ASSET") return { ok: false, reason: "MISSING_REQUIRED_CLIP" } as const;
  const ids = [...new Set(clips.flatMap(clip => clip.source.type === "PRODUCTION_ASSET" ? [clip.source.productionAssetId] : []))].sort();
  const rows = await params.repository.readAssets({ draftId: params.draftId, organizationId: params.organizationId, componentId }, ids, anchor.source.productionAssetId); check();
  const assetIdSchema = z.object({ id: z.string().uuid() });
  const registryAssets = new Map<string, unknown>();
  if (rows.length !== ids.length) return { ok: false, reason: "ASSET_BINDING_UNAVAILABLE" } as const;
  for (const row of rows) {
    const parsed = assetIdSchema.safeParse(row);
    if (!parsed.success || !ids.includes(parsed.data.id) || registryAssets.has(parsed.data.id)) return { ok: false, reason: "ASSET_BINDING_UNAVAILABLE" } as const;
    registryAssets.set(parsed.data.id, row);
  }
  const planned = buildNarrativeFragmentPlan({ ...current, selection: request.selection, selectedTrackIds: request.selectedTrackIds,
    commandId: params.commandId, organizationId: params.organizationId, componentId, linkedAssetIds: ids, registryAssets });
  if (!planned.ok) return planned;
  if (planned.plan.fontAssetIds.length > CONFORMANCE_FONT_BINDING_LIMITS.maximumFonts) return { ok: false, reason: "FONT_BINDING_UNAVAILABLE" } as const;
  if (planned.plan.fontAssetIds.length) {
    const fonts = await params.repository.readFonts(params.organizationId, planned.plan.fontAssetIds); check();
    const parsed = z.array(fontRowSchema).max(CONFORMANCE_FONT_BINDING_LIMITS.maximumFonts).safeParse(fonts);
    if (!parsed.success || parsed.data.length !== planned.plan.fontAssetIds.length
      || parsed.data.some(font => font.organization_id !== params.organizationId || !planned.plan.fontAssetIds.includes(font.id))) return { ok: false, reason: "FONT_BINDING_UNAVAILABLE" } as const;
    try {
      const copyClips = planned.plan.operations.flatMap(operation => operation.type === "clip.add" ? [operation.clip] : []);
      planned.plan.fontBindings = assertDocumentConformanceFontBindings({ ...current.document, clips: copyClips }, parsed.data.map(font => ({
        fontAssetId: font.id, family: font.family, checksumSha256: font.checksum_sha256, fileSizeBytes: font.file_size_bytes, mimeType: font.mime_type })));
    } catch (error) {
      if ((error instanceof Error && error.message.startsWith("CONFORMANCE_")) || error instanceof z.ZodError) return { ok: false, reason: "FONT_BINDING_UNAVAILABLE" } as const;
      throw error;
    }
  }
  check(); return planned;
}

export async function queryNarrativeFragment(params: Parameters<typeof loadNarrativeFragmentPlan>[0]) {
  const result = await loadNarrativeFragmentPlan(params);
  if (!result.ok) return result;
  const plan = result.plan;
  return { ok: true, summary: narrativeFragmentSummarySchema.parse({ contract: "NARRATIVE_FRAGMENT_ELIGIBILITY_V1",
    documentHash: plan.documentHash, reviewFingerprint: fingerprintNarrativeFragmentPlan(plan), scope: plan.scope, binding: plan.binding,
    requiresRevalidationBeforeApply: true, sourceStartSeconds: plan.sourceStartSeconds, sourceEndSeconds: plan.sourceEndSeconds,
    destinationStartSeconds: plan.destinationStartSeconds, destinationEndSeconds: plan.destinationEndSeconds,
    clipCount: plan.copies.length, trackCount: plan.selectedTrackIds.length,
    captionCuts: plan.warnings.filter(warning => warning.kind === "CUE_CUT").length, wordCuts: plan.warnings.filter(warning => warning.kind === "WORD_CUT").length }) } as const;
}
