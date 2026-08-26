import type { CompositionEditorDocument } from "./composition-document.types";
import type { CompositionEditorPatchOperation } from "./editor-patch.types";
import {
  resolveCompositionDuration,
  type CompositionDurationAsset,
  type CompositionDurationResolution,
} from "./composition-duration.service";

export interface CompositionAutoOrganizeAsset extends CompositionDurationAsset {
  id: string;
  label: string;
}

export class CompositionAutoOrganizeError extends Error {}

/** Builds a minimal timing diff. Existing layout and user-authored timing are immutable inputs. */
export function buildCompositionAutoOrganizePatch(params: {
  assets: CompositionAutoOrganizeAsset[];
  document: CompositionEditorDocument;
  /** A caller that already recalculated duration can organize timing only. */
  includeCanvasDuration?: boolean;
}): { operations: CompositionEditorPatchOperation[]; resolution: CompositionDurationResolution } {
  const { assets, document } = params;
  const sourceById = new Map(assets.map((asset) => [asset.id, asset]));
  const editableAssetIds = new Set(sourceById.keys());
  const deckClips = document.clips
    .filter((clip) => clip.source.type === "DECK_SLIDE")
    .sort((left, right) => (left.source.type === "DECK_SLIDE" ? left.source.slideIndex : 0) - (right.source.type === "DECK_SLIDE" ? right.source.slideIndex : 0));
  const resolution = resolveCompositionDuration({ assets, slideCount: deckClips.length });
  const manualTimelineEnd = document.clips
    .filter((clip) => clip.timingSource === "USER_EDITED")
    .reduce((latest, clip) => Math.max(latest, clip.startSeconds + clip.durationSeconds), 0);
  const canvasDuration = params.includeCanvasDuration === false
    ? document.canvas.durationSeconds
    : Math.max(resolution.durationSeconds, manualTimelineEnd);
  const timelineAssetIds = new Set(document.clips.flatMap((clip) => clip.source.type === "PRODUCTION_ASSET" ? [clip.source.productionAssetId] : []));
  const requiredDurationAssets = resolution.source === "voice"
    ? assets.filter((asset) => asset.timelineRole === "VOICE")
    : resolution.source === "avatar_full"
      ? assets.filter((asset) => asset.timelineRole === "AVATAR" && asset.timelineVariant === "FULL").sort(longestFirst).slice(0, 1)
      : resolution.source === "avatar_clips"
        ? assets.filter((asset) => asset.timelineRole === "AVATAR" && asset.timelineVariant !== "FULL")
        : resolution.source === "b_roll" ? assets.filter((asset) => asset.timelineRole === "BROLL") : [];
  const missing = requiredDurationAssets.filter((asset) => !timelineAssetIds.has(asset.id));
  if (missing.length > 0) {
    throw new CompositionAutoOrganizeError(`Agrega primero al timeline ${missing.map((asset) => asset.label).join(", ")}.`);
  }

  const clipOperations: CompositionEditorPatchOperation[] = [];
  const authoritativeFullAvatar = assets.filter((asset) => asset.timelineRole === "AVATAR" && asset.timelineVariant === "FULL").sort(longestFirst)[0];
  for (const clip of document.clips) {
    if (clip.source.type !== "PRODUCTION_ASSET") continue;
    if (!editableAssetIds.has(clip.source.productionAssetId) || (
      authoritativeFullAvatar
      && clip.trackId === "avatar"
      && clip.source.productionAssetId !== authoritativeFullAvatar.id
    )) clipOperations.push({ clipId: clip.id, type: "clip.remove" });
  }

  for (let index = 0; index < deckClips.length; index += 1) {
    const clip = deckClips[index]!;
    if (clip.timingSource === "USER_EDITED") continue;
    const startSeconds = roundSeconds(canvasDuration * index / deckClips.length);
    const endSeconds = index === deckClips.length - 1 ? canvasDuration : roundSeconds(canvasDuration * (index + 1) / deckClips.length);
    clipOperations.push({ clipId: clip.id, durationSeconds: Math.max(0.05, endSeconds - startSeconds), startSeconds, type: "clip.estimated-timing" });
  }

  for (const trackId of ["avatar", "voice", "music", "broll", "visual"]) {
    const clips = document.clips.filter((clip) => clip.source.type === "PRODUCTION_ASSET" && clip.trackId === trackId && editableAssetIds.has(clip.source.productionAssetId) && !(trackId === "avatar" && authoritativeFullAvatar && clip.source.productionAssetId !== authoritativeFullAvatar.id));
    const preferredDurations = clips.map((clip) => {
      if (clip.source.type !== "PRODUCTION_ASSET") return clip.durationSeconds;
      const asset = sourceById.get(clip.source.productionAssetId);
      return Math.min(canvasDuration, asset?.durationSeconds || (trackId === "voice" || trackId === "music" || trackId === "avatar" ? canvasDuration : clip.kind === "IMAGE" ? 5 : 8));
    });
    const totalPreferredDuration = preferredDurations.reduce((total, value) => total + value, 0);
    const durationScale = trackId !== "music" && totalPreferredDuration > canvasDuration ? canvasDuration / totalPreferredDuration : 1;
    let cursor = 0;
    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index]!;
      if (clip.timingSource === "USER_EDITED") {
        if (trackId !== "music") cursor = Math.max(cursor, clip.startSeconds + clip.durationSeconds);
        continue;
      }
      const sequential = trackId !== "music";
      const durationSeconds = sequential
        ? Math.max(0.05, Math.min(preferredDurations[index]! * durationScale, canvasDuration - cursor))
        : preferredDurations[index]!;
      clipOperations.push({ clipId: clip.id, durationSeconds, startSeconds: sequential ? cursor : 0, type: "clip.estimated-timing" });
      if (sequential) cursor += durationSeconds;
    }
  }

  const canvasOperation: CompositionEditorPatchOperation = {
    clipId: "canvas",
    durationMode: canvasDuration > resolution.durationSeconds + 0.001 ? "USER_EDITED" : "AUTO",
    durationSeconds: canvasDuration,
    durationSource: resolution.source,
    type: "composition.canvas-duration",
  };
  const operations = params.includeCanvasDuration === false
    ? clipOperations
    : canvasDuration < document.canvas.durationSeconds
      ? [...clipOperations, canvasOperation]
      : [canvasOperation, ...clipOperations];
  if (operations.length > 100) throw new CompositionAutoOrganizeError("La composición tiene demasiados clips para calcularla en una sola operación.");
  return { operations, resolution };
}

function longestFirst(left: CompositionAutoOrganizeAsset, right: CompositionAutoOrganizeAsset) {
  return (right.durationSeconds || 0) - (left.durationSeconds || 0);
}

function roundSeconds(value: number) {
  return Math.round(value * 20) / 20;
}
