import { z } from "zod";
import { compositionEditorDocumentSchema, type CompositionEditorDocument, type CompositionClip } from "./composition-document.types";
import { resolveAvatarAudioLink } from "./composition-avatar-audio-link.service";
import { resolveNarrativeRangePreview, type NarrativeRangeSelection } from "./composition-narrative-range.service";
import { buildNarrativeVoiceExtractionPlan } from "./composition-narrative-extraction.service";
import { extractNarrativeCaptionInterval } from "./composition-narrative-caption-extraction";
import { resolveNarrativeFragmentAsset } from "./composition-narrative-fragment-assets";
import { selectNarrativeFragmentClips } from "./composition-narrative-fragment-selection";
import { NARRATIVE_FRAGMENT_MAX_CLIPS, narrativeFragmentIntentSchema, type NarrativeFragmentPlanResult, type NarrativeFragmentPlan } from "./composition-narrative-fragment.types";
import { compositionEditorPatchRequestSchema, type CompositionEditorPatchOperation } from "./editor-patch.types";
import { applyCompositionEditorPatches, CompositionEditorPatchError } from "./editor-patch.service";

const TIME_TOLERANCE_SECONDS = 0.000001;
const MAX_LABEL_CODE_POINTS = 85;
const MAX_GROUP_LABEL_CODE_POINTS = 50;

/** Pure all-or-nothing append planner. Selected tracks never imply permission or a verified binary. */
export function buildNarrativeFragmentPlan(params: {
  document: CompositionEditorDocument; documentHash: string; selection: NarrativeRangeSelection;
  selectedTrackIds: readonly string[]; commandId: string; organizationId: string; componentId: string;
  linkedAssetIds: readonly string[]; registryAssets: ReadonlyMap<string, unknown>;
}): NarrativeFragmentPlanResult {
  const parsed = compositionEditorDocumentSchema.safeParse(params.document);
  if (!parsed.success) return { ok: false, reason: "INVALID_DOCUMENT" };
  const intent = narrativeFragmentIntentSchema.safeParse({ selectedTrackIds: params.selectedTrackIds, commandId: params.commandId });
  if (!intent.success) return { ok: false, reason: "INVALID_TRACK_SELECTION" };
  const document = parsed.data;
  const resolved = resolveNarrativeRangePreview(document, params.documentHash, params.selection);
  if (!resolved.ok) return { ok: false, reason: "INVALID_RANGE" };
  const range = resolved.range;
  const selectedTracks = new Set(intent.data.selectedTrackIds);
  const tracks = new Map(document.tracks.map(track => [track.id, track]));
  if (intent.data.selectedTrackIds.some(id => !tracks.has(id))) return { ok: false, reason: "INVALID_TRACK_SELECTION" };
  if (intent.data.selectedTrackIds.some(id => tracks.get(id)!.locked || tracks.get(id)!.hidden)) return { ok: false, reason: "LOCKED_TRACK" };
  const candidates = selectNarrativeFragmentClips(document, intent.data.selectedTrackIds, range.startSeconds, range.endSeconds);
  if (candidates.length > NARRATIVE_FRAGMENT_MAX_CLIPS) return { ok: false, reason: "TOO_MANY_CLIPS" };
  const included = new Set(candidates.map(clip => clip.id));
  if (!included.has(range.clipId)) return { ok: false, reason: "MISSING_REQUIRED_CLIP" };
  if (!candidates.some(clip => ["VIDEO", "IMAGE", "DECK_SLIDE", "TEXT"].includes(clip.kind))) return { ok: false, reason: "NO_VISUAL_CONTENT" };
  const copiedGroups = (document.groups ?? []).filter(group => group.clipIds.some(id => included.has(id)));
  if (copiedGroups.some(group => group.clipIds.some(id => !included.has(id)))) return { ok: false, reason: "MISSING_REQUIRED_CLIP" };
  for (const clip of candidates) {
    const link = resolveAvatarAudioLink(document, clip.id);
    if (link.status === "AMBIGUOUS") return { ok: false, reason: "DEPENDENCIES_UNSUPPORTED" };
    if (link.status === "LINKED") {
      if (!included.has(link.avatar.id) || !included.has(link.voice.id)) return { ok: false, reason: "MISSING_REQUIRED_CLIP" };
      if (Math.abs(link.avatar.startSeconds - link.voice.startSeconds) > TIME_TOLERANCE_SECONDS
        || Math.abs(link.avatar.durationSeconds - link.voice.durationSeconds) > TIME_TOLERANCE_SECONDS
        || Math.abs((link.avatar.sourceOffsetSeconds ?? 0) - (link.voice.sourceOffsetSeconds ?? 0)) > TIME_TOLERANCE_SECONDS) return { ok: false, reason: "LINK_TIMING_MISMATCH" };
    }
    if ((clip.playbackRate ?? 1) !== 1 || clip.freezeTailSeconds || (clip.fadeInSeconds ?? 0) > 0 || (clip.fadeOutSeconds ?? 0) > 0
      || document.motion.animations.some(animation => animation.target.clipId === clip.id)
      || document.transitions?.items.some(transition => transition.fromClipId === clip.id || transition.toClipId === clip.id)) return { ok: false, reason: "DEPENDENCIES_UNSUPPORTED" };
  }
  const anchorClip = candidates.find(clip => clip.id === range.clipId)!;
  if (anchorClip.source.type !== "PRODUCTION_ASSET") return { ok: false, reason: "CLIP_NOT_ELIGIBLE" };
  const anchor = buildNarrativeVoiceExtractionPlan({ ...params, document, registryAsset: params.registryAssets.get(anchorClip.source.productionAssetId),
    newClipId: `voice-extract-${params.commandId}`, newHfId: `hf-voice-extract-${params.commandId}`, dependencyClipIds: [...included] });
  if (!anchor.ok) return anchor;
  const destinationStartSeconds = document.canvas.durationSeconds;
  const destinationEndSeconds = destinationStartSeconds + range.endSeconds - range.startSeconds;
  const operations: CompositionEditorPatchOperation[] = [{ type: "composition.canvas-duration", clipId: "canvas", durationSeconds: destinationEndSeconds, durationMode: "USER_EDITED" }];
  const copies: NarrativeFragmentPlan["copies"] = [];
  const assets = new Map<string, NarrativeFragmentPlan["assets"][number]>();
  const fonts = new Set<string>();
  const warnings: NarrativeFragmentPlan["warnings"] = [];
  const sceneIds = new Map<string, string>();
  for (const [ordinal, clip] of candidates.entries()) {
    const start = Math.max(range.startSeconds, clip.startSeconds);
    const end = Math.min(range.endSeconds, clip.startSeconds + clip.durationSeconds);
    const copied: CompositionClip = { ...structuredClone(clip), id: clip.id === range.clipId ? anchor.plan.newClipId : `fragment-${params.commandId}-${ordinal}`,
      hfId: `hf-fragment-${params.commandId}-${ordinal}`, startSeconds: destinationStartSeconds + start - range.startSeconds,
      durationSeconds: end - start, timingSource: "USER_EDITED", label: `${Array.from(clip.label).slice(0, MAX_LABEL_CODE_POINTS).join("")} · fragmento` };
    delete copied.sceneId;
    const link = resolveAvatarAudioLink(document, clip.id);
    if (link.status === "LINKED") {
      if (!sceneIds.has(link.sceneId)) sceneIds.set(link.sceneId, `fragment-scene-${params.commandId}-${sceneIds.size}`);
      copied.sceneId = sceneIds.get(link.sceneId)!;
      if (document.narrativeScenes?.some(scene => scene.id === copied.sceneId)
        || document.clips.some(original => original.sceneId === copied.sceneId)) return { ok: false, reason: "INVALID_OPERATIONS" };
    }
    if (clip.source.type === "PRODUCTION_ASSET") {
      const sourceStart = (clip.sourceOffsetSeconds ?? 0) + start - clip.startSeconds;
      const asset = resolveNarrativeFragmentAsset({ ...params, clip, registryAsset: params.registryAssets.get(clip.source.productionAssetId), sourceEndSeconds: sourceStart + copied.durationSeconds });
      if (!asset) return { ok: false, reason: "ASSET_BINDING_UNAVAILABLE" };
      assets.set(asset.assetId, asset);
      if (clip.kind !== "IMAGE") {
        copied.sourceOffsetSeconds = sourceStart;
        copied.sourceDurationSeconds = asset.durationMilliseconds! / 1000;
      }
    } else if (clip.source.type === "NATIVE_CAPTIONS") {
      const captions = extractNarrativeCaptionInterval({ source: clip.source, startSeconds: start - clip.startSeconds,
        endSeconds: end - clip.startSeconds, commandId: params.commandId, clipOrdinal: ordinal });
      if (!captions.source) continue;
      copied.source = captions.source;
      warnings.push(...captions.warnings.map(warning => ({ ...warning, clipId: clip.id })));
      if (captions.source.style.fontAssetId) fonts.add(captions.source.style.fontAssetId);
    } else if (clip.source.type === "NATIVE_TEXT") {
      if (clip.source.style.fontAssetId) fonts.add(clip.source.style.fontAssetId);
    } else return { ok: false, reason: "SOURCE_KIND_UNSUPPORTED" };
    copies.push({ sourceClipId: clip.id, newClipId: copied.id, newHfId: copied.hfId });
    operations.push({ type: "clip.add", clipId: copied.id, clip: copied });
  }
  const copyIds = new Map(copies.map(copy => [copy.sourceClipId, copy.newClipId]));
  for (const [ordinal, group] of copiedGroups.entries()) {
    if (group.clipIds.some(id => !copyIds.has(id))) return { ok: false, reason: "MISSING_REQUIRED_CLIP" };
    operations.push({ type: "group.create", clipIds: group.clipIds.map(id => copyIds.get(id)!), groupId: `fragment-group-${params.commandId}-${ordinal}`,
      label: group.label ? `${Array.from(group.label).slice(0, MAX_GROUP_LABEL_CODE_POINTS).join("")} · fragmento` : "Fragmento extraído" });
  }
  const patch = compositionEditorPatchRequestSchema.safeParse({ operations, source: "USER", summary: "Extraer fragmento audiovisual al final" });
  if (!patch.success) return { ok: false, reason: "INVALID_OPERATIONS" };
  try { applyCompositionEditorPatches(document, patch.data.operations, "USER"); }
  catch (error) {
    if (error instanceof CompositionEditorPatchError || error instanceof z.ZodError) return { ok: false, reason: "INVALID_OPERATIONS" };
    throw error;
  }
  return { ok: true, plan: { contract: "NARRATIVE_AUDIOVISUAL_FRAGMENT_PLAN_V1", scope: "AUDIOVISUAL", binding: "REGISTRY_METADATA_MATCH_ONLY",
    documentHash: params.documentHash, anchor: anchor.plan, selectedTrackIds: [...selectedTracks].sort(), candidateClipIds: candidates.map(clip => clip.id), sourceStartSeconds: range.startSeconds,
    sourceEndSeconds: range.endSeconds, destinationStartSeconds, destinationEndSeconds, copies, assets: [...assets.values()], fontAssetIds: [...fonts].sort(), fontBindings: [], warnings, operations: patch.data.operations } };
}
