import type { HyperframesAnimatedDeckSource } from "../hyperframes/hyperframes.types";
import type { HyperframesProjectAsset } from "../hyperframes/hyperframes-project-builder.service";
import type { HyperframesPlan } from "../hyperframes/hyperframes-plan.service";
import {
  COMPOSITION_DOCUMENT_FORMAT,
  COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS,
  compositionEditorDocumentSchema,
  type CompositionClip,
  type CompositionEditorDocument,
} from "./composition-document.types";

/**
 * Creates the first editable document from internal Production sources.
 * Slide timing is explicitly ESTIMATED because the persisted deck contract has
 * no authored slide duration; user edits become the render source of truth.
 */
export function createInitialCompositionDocument(params: {
  animatedDeck: HyperframesAnimatedDeckSource | null;
  assets: HyperframesProjectAsset[];
  plan: HyperframesPlan;
}): CompositionEditorDocument {
  const durationSeconds = resolveCanvasDuration(params);
  const tracks = buildTracks(params.assets, params.animatedDeck);
  const clips = [
    ...buildDeckClips(params.animatedDeck, durationSeconds),
    ...buildAssetClips(params.assets, durationSeconds, 0, params.animatedDeck?.width || 1920, params.animatedDeck?.height || 1080),
  ];
  if (clips.length === 0) throw new Error("No hay fuentes internas para crear la composición.");
  return compositionEditorDocumentSchema.parse({
    canvas: { durationSeconds, fps: 30, height: params.animatedDeck?.height || 1080, width: params.animatedDeck?.width || 1920 },
    clips,
    deckStyles: params.animatedDeck ? {
      css: params.animatedDeck.css,
      fontUrls: params.animatedDeck.fonts.map((font) => font.href),
    } : null,
    format: COMPOSITION_DOCUMENT_FORMAT,
    tracks,
    variables: { accent: params.plan.accentColor, subtitle: params.plan.subtitle, title: params.plan.title },
  });
}

export function appendMissingProductionAssetClips(
  document: CompositionEditorDocument,
  assets: HyperframesProjectAsset[],
) {
  const existingAssetIds = new Set(document.clips.flatMap((clip) => (
    clip.source.type === "PRODUCTION_ASSET" ? [clip.source.productionAssetId] : []
  )));
  const missingAssets = assets.filter((asset) => !existingAssetIds.has(asset.productionAssetId));
  if (missingAssets.length === 0) return { changed: false, document };

  const tracks = [...document.tracks];
  for (const requiredTrack of buildTracks(missingAssets, null)) {
    if (!tracks.some((track) => track.id === requiredTrack.id)) {
      tracks.push({ ...requiredTrack, order: nextTrackOrder(tracks) });
    }
  }

  const clips = [
    ...document.clips,
    ...buildAssetClips(missingAssets, document.canvas.durationSeconds, document.clips.length, document.canvas.width, document.canvas.height),
  ];
  return {
    changed: true,
    document: compositionEditorDocumentSchema.parse({
      ...document,
      clips,
      tracks: tracks.sort((left, right) => left.order - right.order),
    }),
  };
}

/**
 * Reconciles an existing document without touching its history. Dependencies
 * used by the deck HTML are not independently editable timeline media.
 */
export function reconcileCompositionDocument(params: {
  deckDependencyAssetIds: ReadonlySet<string>;
  document: CompositionEditorDocument;
  productionAssets: HyperframesProjectAsset[];
}) {
  const withoutDeckDependencies = params.document.clips.filter((clip) => (
    clip.source.type !== "PRODUCTION_ASSET" || !params.deckDependencyAssetIds.has(clip.source.productionAssetId)
  ));
  const removedDeckDependencyCount = params.document.clips.length - withoutDeckDependencies.length;
  const productionAssetById = new Map(params.productionAssets.map((asset) => [asset.productionAssetId, asset]));
  const synchronizedClips = withoutDeckDependencies.map((clip) => {
    if (clip.source.type !== "PRODUCTION_ASSET") return clip;
    const source = productionAssetById.get(clip.source.productionAssetId);
    return source ? { ...clip, trackId: resolveTrackId(source) } : clip;
  });
  const trackAssignmentChanged = synchronizedClips.some((clip, index) => clip.trackId !== withoutDeckDependencies[index]?.trackId);
  const synchronizedTracks = [...params.document.tracks];
  for (const requiredTrack of buildTracks(params.productionAssets, null)) {
    if (!synchronizedTracks.some((track) => track.id === requiredTrack.id)) {
      synchronizedTracks.push({ ...requiredTrack, order: nextTrackOrder(synchronizedTracks) });
    }
  }
  const documentWithoutDeckDependencies = compositionEditorDocumentSchema.parse({
    ...params.document,
    clips: synchronizedClips,
    tracks: synchronizedTracks.filter((track) => (
      track.kind === "DECK" || synchronizedClips.some((clip) => clip.trackId === track.id)
    )),
  });
  const appended = appendMissingProductionAssetClips(documentWithoutDeckDependencies, params.productionAssets);
  return {
    addedProductionAssetCount: appended.document.clips.length - documentWithoutDeckDependencies.clips.length,
    changed: removedDeckDependencyCount > 0 || trackAssignmentChanged || appended.changed,
    document: appended.document,
    removedDeckDependencyCount,
  };
}

function resolveCanvasDuration(params: {
  animatedDeck: HyperframesAnimatedDeckSource | null;
  assets: HyperframesProjectAsset[];
  plan: HyperframesPlan;
}) {
  const deckMinimum = params.animatedDeck ? params.animatedDeck.slides.length * 5 : 0;
  const sourceDuration = params.assets.reduce((longest, asset) => Math.max(longest, asset.durationSeconds || 0), 0);
  return Math.min(COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS, Math.max(params.plan.durationSeconds, deckMinimum, sourceDuration, 3));
}

function buildTracks(assets: HyperframesProjectAsset[], deck: HyperframesAnimatedDeckSource | null) {
  const tracks = [];
  if (deck) tracks.push({ id: "deck", kind: "DECK" as const, label: "Deck HTML", locked: false, order: 0 });
  const definitions = [
    { id: "avatar", kind: "VISUAL" as const, label: "Avatar" },
    { id: "broll", kind: "VISUAL" as const, label: "B-roll" },
    { id: "visual", kind: "VISUAL" as const, label: "Medios visuales" },
    { id: "audio", kind: "AUDIO" as const, label: "Audio" },
  ];
  for (const definition of definitions) {
    if (assets.some((asset) => resolveTrackId(asset) === definition.id)) {
      tracks.push({ ...definition, locked: false, order: tracks.length });
    }
  }
  return tracks;
}

function buildDeckClips(deck: HyperframesAnimatedDeckSource | null, durationSeconds: number): CompositionClip[] {
  if (!deck) return [];
  const estimatedSlideDuration = durationSeconds / deck.slides.length;
  return deck.slides.map((slide, position) => {
    const startSeconds = roundSeconds(position * estimatedSlideDuration);
    const remainingDuration = durationSeconds - startSeconds;
    return {
      durationSeconds: roundSeconds(position === deck.slides.length - 1 ? remainingDuration : estimatedSlideDuration),
      hfId: `deck-slide-${slide.index}`,
      hidden: false,
      id: `deck-slide-${slide.index}`,
      kind: "DECK_SLIDE" as const,
      label: slide.label || `Diapositiva ${position + 1}`,
      layout: { height: deck.height, opacity: 1, rotation: 0, width: deck.width, x: 0, y: 0, zIndex: 0 },
      source: {
        classes: slide.classes,
        html: slide.html,
        slideIndex: slide.index,
        type: "DECK_SLIDE" as const,
      },
      startSeconds,
      timingSource: "ESTIMATED" as const,
      trackId: "deck",
    };
  });
}

function buildAssetClips(assets: HyperframesProjectAsset[], durationSeconds: number, initialIndex = 0, canvasWidth = 1920, canvasHeight = 1080): CompositionClip[] {
  const assetsByTrack = new Map<string, HyperframesProjectAsset[]>();
  for (const asset of assets) {
    const trackId = resolveTrackId(asset);
    assetsByTrack.set(trackId, [...(assetsByTrack.get(trackId) || []), asset]);
  }
  const timingByAssetId = new Map<string, { durationSeconds: number; startSeconds: number }>();
  for (const [trackId, groupedAssets] of assetsByTrack) {
    let cursor = 0;
    for (let index = 0; index < groupedAssets.length; index++) {
      const asset = groupedAssets[index]!;
      const remainingAssets = groupedAssets.length - index;
      const preferredDuration = resolveInitialAssetDuration(asset, durationSeconds, trackId);
      const duration = trackId === "avatar" || trackId === "audio"
        ? preferredDuration
        : Math.max(0.05, Math.min(preferredDuration, (durationSeconds - cursor) / remainingAssets));
      timingByAssetId.set(asset.productionAssetId, {
        durationSeconds: roundSeconds(duration),
        startSeconds: roundSeconds(trackId === "avatar" || trackId === "audio" ? 0 : cursor),
      });
      if (trackId !== "avatar" && trackId !== "audio") cursor += duration;
    }
  }

  return assets.map((asset, index) => {
    const kind = asset.mimeType.startsWith("audio/")
      ? "AUDIO" as const
      : asset.mimeType.startsWith("video/")
        ? "VIDEO" as const
        : "IMAGE" as const;
    const trackId = resolveTrackId(asset);
    const isAudio = trackId === "audio";
    const timing = timingByAssetId.get(asset.productionAssetId)!;
    const avatarWidth = Math.round(canvasWidth * 0.32);
    const avatarHeight = Math.round(canvasHeight * 0.65);
    return {
      durationSeconds: timing.durationSeconds,
      hfId: `asset-${asset.productionAssetId}`,
      hidden: false,
      id: `asset-${asset.productionAssetId}`,
      kind,
      label: asset.label?.trim() || `Asset ${initialIndex + index + 1}`,
      layout: {
        height: isAudio ? 1 : trackId === "avatar" ? avatarHeight : canvasHeight,
        opacity: 1,
        rotation: 0,
        width: isAudio ? 1 : trackId === "avatar" ? avatarWidth : canvasWidth,
        x: trackId === "avatar" ? canvasWidth - avatarWidth - 48 : 0,
        y: trackId === "avatar" ? canvasHeight - avatarHeight - 48 : 0,
        zIndex: isAudio ? 0 : trackId === "avatar" ? 10 : trackId === "broll" ? 5 : -1,
      },
      source: { productionAssetId: asset.productionAssetId, type: "PRODUCTION_ASSET" as const },
      startSeconds: timing.startSeconds,
      timingSource: "ESTIMATED" as const,
      trackId,
    };
  });
}

function resolveInitialAssetDuration(asset: HyperframesProjectAsset, canvasDuration: number, trackId: string) {
  const measuredDuration = asset.durationSeconds && asset.durationSeconds > 0 ? asset.durationSeconds : null;
  const fallbackDuration = trackId === "avatar" || trackId === "audio"
    ? canvasDuration
    : asset.mimeType.startsWith("image/") ? 5 : 8;
  return Math.min(canvasDuration, measuredDuration || fallbackDuration);
}

function resolveTrackId(asset: HyperframesProjectAsset) {
  if (asset.mimeType.startsWith("audio/") || asset.timelineRole === "AUDIO") return "audio";
  if (asset.timelineRole === "AVATAR") return "avatar";
  if (asset.timelineRole === "BROLL") return "broll";
  return "visual";
}

function nextTrackOrder(tracks: CompositionEditorDocument["tracks"]) {
  return tracks.reduce((highest, track) => Math.max(highest, track.order), -1) + 1;
}

function roundSeconds(value: number) {
  return Math.round(value * 1000) / 1000;
}
