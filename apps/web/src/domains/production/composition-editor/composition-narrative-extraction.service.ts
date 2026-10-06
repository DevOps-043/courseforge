import { z } from "zod";
import { PRODUCTION_ASSET_TYPES, PRODUCTION_QA_STATUSES } from "../types/production.types";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "./composition-document.types";
import { resolveAvatarAudioLink } from "./composition-avatar-audio-link.service";
import { resolveNarrativeRangePreview, type NarrativeRangeSelection } from "./composition-narrative-range.service";
import { compositionEditorPatchRequestSchema, type CompositionEditorPatchOperation } from "./editor-patch.types";
import { applyCompositionEditorPatches, CompositionEditorPatchError } from "./editor-patch.service";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
// 90 Unicode code points fit the 200 UTF-16-unit label contract, including the suffix.
const MAX_SOURCE_LABEL_CODE_POINTS = 90;
const bindingRecordSchema = z.object({
  id: z.string().uuid(), organization_id: z.string().uuid(), material_component_id: z.string().uuid(),
  asset_type: z.literal(PRODUCTION_ASSET_TYPES.VOICE_AUDIO), mime_type: z.string().regex(/^audio\//),
  checksum: sha256Schema, qa_status: z.enum([PRODUCTION_QA_STATUSES.READY_FOR_QA, PRODUCTION_QA_STATUSES.APPROVED,
    PRODUCTION_QA_STATUSES.EXPORTED, PRODUCTION_QA_STATUSES.PUBLISHED]),
  duration_milliseconds: z.number().int().positive(),
  metadata: z.object({ script_hash: sha256Schema, word_timestamps: z.array(z.object({
    word: z.string().min(1).max(500), start: z.number().finite().nonnegative(), end: z.number().finite().nonnegative(),
  }).strict()).min(1).max(20_000) }),
});

export type NarrativeExtractionFailure = "INVALID_DOCUMENT" | "INVALID_RANGE" | "ASSET_BINDING_UNAVAILABLE"
  | "ASSET_SCOPE_MISMATCH" | "TIMESTAMPS_MISMATCH" | "CLIP_NOT_ELIGIBLE" | "LOCKED_TRACK"
  | "DEPENDENCIES_UNSUPPORTED" | "SOURCE_WINDOW_INVALID" | "INVALID_OPERATIONS";
export interface NarrativeVoiceExtractionPlan {
  contract: "NARRATIVE_VOICE_EXTRACTION_PLAN_V1";
  documentHash: string;
  sourceAssetId: string;
  sourceClipId: string;
  sourceChecksum: string;
  sourceScriptHash: string;
  sourceQaStatus: string;
  sourceDurationMilliseconds: number;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  destinationStartSeconds: number;
  destinationEndSeconds: number;
  newClipId: string;
  operations: CompositionEditorPatchOperation[];
  scope: "VOICE_ONLY";
  binding: "REGISTRY_METADATA_MATCH_ONLY";
}
export type NarrativeExtractionPlanResult = { ok: true; plan: NarrativeVoiceExtractionPlan }
  | { ok: false; reason: NarrativeExtractionFailure };

/** Pure planning over server-loaded records. Does not authenticate callers, pin bytes or persist. */
export function buildNarrativeVoiceExtractionPlan(params: {
  document: CompositionEditorDocument; documentHash: string; selection: NarrativeRangeSelection;
  organizationId: string; componentId: string; linkedAssetIds: readonly string[]; registryAsset: unknown;
  newClipId: string; newHfId: string;
  /** Internal multitrack planner only: every dependent copy must be included in its final validated batch. */
  dependencyClipIds?: readonly string[];
}): NarrativeExtractionPlanResult {
  const parsedDocument = compositionEditorDocumentSchema.safeParse(params.document);
  if (!parsedDocument.success) return { ok: false, reason: "INVALID_DOCUMENT" };
  if (!sha256Schema.safeParse(params.documentHash).success) return { ok: false, reason: "INVALID_RANGE" };
  const document = parsedDocument.data;
  const resolved = resolveNarrativeRangePreview(document, params.documentHash, params.selection);
  if (!resolved.ok) return { ok: false, reason: "INVALID_RANGE" };
  const clip = document.clips.find((candidate) => candidate.id === resolved.range.clipId)!;
  const track = document.tracks.find((candidate) => candidate.id === clip.trackId)!;
  if (clip.kind !== "AUDIO" || clip.source.type !== "PRODUCTION_ASSET" || track.semanticRole !== "VOICE") {
    return { ok: false, reason: "CLIP_NOT_ELIGIBLE" };
  }
  if (track.locked) return { ok: false, reason: "LOCKED_TRACK" };
  const included = new Set(params.dependencyClipIds ?? []);
  const link = resolveAvatarAudioLink(document, clip.id);
  const hasDependencies = link.status === "AMBIGUOUS"
    || (link.status === "LINKED" && (!included.has(link.avatar.id) || !included.has(link.voice.id)))
    || document.groups?.some((group) => group.clipIds.includes(clip.id) && group.clipIds.some(id => !included.has(id)))
    || document.motion.animations.some((animation) => animation.target.clipId === clip.id)
    || document.transitions?.items.some((transition) => transition.fromClipId === clip.id || transition.toClipId === clip.id)
    || (clip.fadeInSeconds ?? 0) > 0 || (clip.fadeOutSeconds ?? 0) > 0;
  if (hasDependencies) return { ok: false, reason: "DEPENDENCIES_UNSUPPORTED" };
  const parsedAsset = bindingRecordSchema.safeParse(params.registryAsset);
  if (!parsedAsset.success) return { ok: false, reason: "ASSET_BINDING_UNAVAILABLE" };
  const asset = parsedAsset.data;
  if (asset.id !== clip.source.productionAssetId || asset.organization_id !== params.organizationId
    || asset.material_component_id !== params.componentId || !params.linkedAssetIds.includes(asset.id)) {
    return { ok: false, reason: "ASSET_SCOPE_MISMATCH" };
  }
  const scene = document.narrativeScenes?.find((candidate) => candidate.id === clip.sceneId);
  if (!scene || scene.scriptHash !== asset.metadata.script_hash
    || scene.wordTimestamps?.length !== asset.metadata.word_timestamps.length
    || scene.wordTimestamps.some((word, index) => {
      const registered = asset.metadata.word_timestamps[index]!;
      return word.word !== registered.word || word.start !== registered.start || word.end !== registered.end;
    })) {
    return { ok: false, reason: "TIMESTAMPS_MISMATCH" };
  }
  const sourceStartSeconds = (clip.sourceOffsetSeconds ?? 0) + resolved.range.startSeconds - clip.startSeconds;
  const durationSeconds = resolved.range.endSeconds - resolved.range.startSeconds;
  const sourceEndSeconds = sourceStartSeconds + durationSeconds;
  if (sourceStartSeconds < 0 || sourceEndSeconds > asset.duration_milliseconds / 1_000) {
    return { ok: false, reason: "SOURCE_WINDOW_INVALID" };
  }
  const copiedClip = { ...structuredClone(clip), id: params.newClipId, hfId: params.newHfId,
    label: `${Array.from(clip.label).slice(0, MAX_SOURCE_LABEL_CODE_POINTS).join("")} · fragmento de voz`, startSeconds: document.canvas.durationSeconds,
    durationSeconds, sourceOffsetSeconds: sourceStartSeconds, sourceDurationSeconds: asset.duration_milliseconds / 1_000,
    timingSource: "USER_EDITED" as const };
  // A standalone voice fragment must not inherit a scene approval or become another linked anchor.
  delete copiedClip.sceneId;
  const destinationEndSeconds = copiedClip.startSeconds + durationSeconds;
  const operations: CompositionEditorPatchOperation[] = [
    { type: "composition.canvas-duration", clipId: "canvas", durationSeconds: destinationEndSeconds, durationMode: "USER_EDITED" },
    { type: "clip.add", clipId: copiedClip.id, clip: copiedClip },
  ];
  const patch = compositionEditorPatchRequestSchema.safeParse({ operations, source: "USER", summary: "Extraer fragmento de voz al final" });
  if (!patch.success) return { ok: false, reason: "INVALID_OPERATIONS" };
  try { applyCompositionEditorPatches(document, patch.data.operations, "USER"); }
  catch (error) {
    if (error instanceof CompositionEditorPatchError || error instanceof z.ZodError) {
      return { ok: false, reason: "INVALID_OPERATIONS" };
    }
    throw error;
  }
  return { ok: true, plan: { contract: "NARRATIVE_VOICE_EXTRACTION_PLAN_V1", documentHash: params.documentHash,
    sourceAssetId: asset.id, sourceClipId: clip.id, sourceChecksum: asset.checksum, sourceScriptHash: asset.metadata.script_hash,
    sourceQaStatus: asset.qa_status, sourceDurationMilliseconds: asset.duration_milliseconds,
    sourceStartSeconds, sourceEndSeconds, destinationStartSeconds: copiedClip.startSeconds, destinationEndSeconds,
    newClipId: copiedClip.id, operations: patch.data.operations, scope: "VOICE_ONLY", binding: "REGISTRY_METADATA_MATCH_ONLY" } };
}
