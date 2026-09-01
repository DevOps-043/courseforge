import type { HyperframesAnimatedDeckSource } from "../hyperframes/hyperframes.types";
import type { HyperframesProjectAsset } from "../hyperframes/hyperframes-project-builder.service";
import type { HyperframesPlan } from "../hyperframes/hyperframes-plan.service";
import {
  COMPOSITION_DOCUMENT_FORMAT,
  DEFAULT_COMPOSITION_DUCKING_SETTINGS,
  compositionEditorDocumentSchema,
  type CompositionClip,
  type CompositionEditorDocument,
} from "./composition-document.types";
import {
  resolveCompositionDuration,
  type CompositionDurationResolution,
} from "./composition-duration.service";
import {
  getCompositionTrackDefinition,
  resolveCompositionTrackDefinition,
} from "./composition-track-registry";
import {
  resolveDefaultCompositionClipLayout,
  resolveDefaultCompositionMediaFit,
} from "./composition-default-layout.service";
import { DEFAULT_COMPOSITION_LAYER } from "./composition-layer-depth";
import { DEFAULT_COMPOSITION_RENDER_FPS } from "./composition-document.types.constants";

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
  const duration = resolveCanvasDuration(params);
  const durationSeconds = duration.durationSeconds;
  const timelineAssets = selectAuthoritativeTimelineAssets(params.assets);
  const tracks = buildTracks(timelineAssets, params.animatedDeck);
  const clips = [
    ...buildDeckClips(params.animatedDeck, durationSeconds),
    ...buildAssetClips(timelineAssets, durationSeconds, 0, params.animatedDeck?.width || 1920, params.animatedDeck?.height || 1080),
  ];
  if (clips.length === 0) throw new Error("No hay fuentes internas para crear la composición.");
  return compositionEditorDocumentSchema.parse({
    audioMix: {
      ducking: {
        ...DEFAULT_COMPOSITION_DUCKING_SETTINGS,
        triggerRoles: [...DEFAULT_COMPOSITION_DUCKING_SETTINGS.triggerRoles],
      },
    },
    canvas: {
      durationMode: "AUTO",
      durationSeconds,
      durationSource: duration.source,
      fps: DEFAULT_COMPOSITION_RENDER_FPS,
      height: params.animatedDeck?.height || 1080,
      width: params.animatedDeck?.width || 1920,
    },
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
  voiceAppendStartSeconds = document.canvas.durationSeconds,
) {
  assets = selectAuthoritativeTimelineAssets(assets);
  const existingAssetIds = new Set(document.clips.flatMap((clip) => (
    clip.source.type === "PRODUCTION_ASSET" ? [clip.source.productionAssetId] : []
  )));
  const missingAssets = assets.filter((asset) => !existingAssetIds.has(asset.productionAssetId));
  if (missingAssets.length === 0) return { changed: false, document };

  const tracks = [...document.tracks];
  for (const requiredTrack of buildTracks(missingAssets, null)) {
    if (!tracks.some((track) => track.id === requiredTrack.id)) {
      tracks.push(requiredTrack);
    }
  }

  const sceneTimingByAssetId = buildSceneAssetTimings(assets, document.canvas.durationSeconds);
  const hasExistingVoiceAsset = document.clips.some((clip) => (
    clip.trackId === "voice" && clip.source.type === "PRODUCTION_ASSET"
  ));
  const missingStandaloneVoices = missingAssets.filter((candidate) => (
    candidate.timelineRole === "VOICE" && !candidate.sceneOrder
  ));
  const voicesToAppend = hasExistingVoiceAsset || missingStandaloneVoices.length > 1
    ? missingStandaloneVoices
    : [];
  let extendedVoiceCursor = voiceAppendStartSeconds;
  for (const asset of voicesToAppend) {
    const durationSeconds = roundSeconds(asset.durationSeconds && asset.durationSeconds > 0
      ? asset.durationSeconds
      : 5);
    sceneTimingByAssetId.set(asset.productionAssetId, {
      durationSeconds,
      startSeconds: roundSeconds(extendedVoiceCursor),
    });
    extendedVoiceCursor += durationSeconds;
  }
  const clips = [
    ...document.clips,
    ...buildAssetClips(
      missingAssets,
      extendedVoiceCursor,
      document.clips.length,
      document.canvas.width,
      document.canvas.height,
      sceneTimingByAssetId,
    ),
  ];
  return {
    changed: true,
    document: compositionEditorDocumentSchema.parse({
      ...document,
      canvas: extendedVoiceCursor > document.canvas.durationSeconds ? {
        ...document.canvas,
        durationMode: "USER_EDITED",
        durationSeconds: roundSeconds(extendedVoiceCursor),
        durationSource: "voice",
      } : document.canvas,
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
  animatedDeck?: HyperframesAnimatedDeckSource | null;
  deckDependencyAssetIds: ReadonlySet<string>;
  document: CompositionEditorDocument;
  productionAssets: HyperframesProjectAsset[];
}) {
  const productionAssets = selectAuthoritativeTimelineAssets(params.productionAssets);
  const automaticDuration = params.document.canvas.durationMode === "AUTO"
    ? resolveCompositionDuration({
        assets: productionAssets,
        // A deck can be generated after a draft has been opened. Use the
        // freshly resolved source instead of the persisted clip count so the
        // new slides receive a valid canvas on their first synchronization.
        slideCount: params.animatedDeck?.slides.length
          ?? params.document.clips.filter((clip) => clip.kind === "DECK_SLIDE").length,
      })
    : null;
  const productionAssetById = new Map(productionAssets.map((asset) => [asset.productionAssetId, asset]));
  const withoutDeckDependencies = params.document.clips.filter((clip) => (
    clip.source.type !== "PRODUCTION_ASSET" || !params.deckDependencyAssetIds.has(clip.source.productionAssetId)
  ));
  const removedDeckDependencyCount = params.document.clips.length - withoutDeckDependencies.length;
  const withoutInactiveProductionAssets = withoutDeckDependencies.filter((clip) => (
    clip.source.type !== "PRODUCTION_ASSET" || productionAssetById.has(clip.source.productionAssetId)
  ));
  const removedInactiveProductionAssetCount = withoutDeckDependencies.length - withoutInactiveProductionAssets.length;
  // Reconciliation must never make retained authored content invalid. A newly
  // resolved duration source may be shorter than deck clips or manual edits
  // that still belong to the document, so it can expand the canvas but cannot
  // shrink it below the last surviving clip.
  const retainedClipEndSeconds = withoutInactiveProductionAssets.reduce(
    (latestEnd, clip) => Math.max(latestEnd, clip.startSeconds + clip.durationSeconds),
    0,
  );
  const canvasDurationSeconds = Math.max(
    automaticDuration?.durationSeconds || params.document.canvas.durationSeconds,
    retainedClipEndSeconds,
  );
  let clipSynchronizationChanged = false;
  const sceneTimingByAssetId = buildSceneAssetTimings(
    productionAssets,
    canvasDurationSeconds,
  );
  const synchronizedClips = withoutInactiveProductionAssets.map((clip) => {
    if (clip.source.type !== "PRODUCTION_ASSET") return clip;
    const source = productionAssetById.get(clip.source.productionAssetId);
    if (!source) return clip;
    const track = resolveCompositionTrackDefinition(source);
    const sourceDimensions = source.sourceWidth && source.sourceHeight
      ? { height: source.sourceHeight, width: source.sourceWidth }
      : null;
    const isUnframedLegacyBroll = (clip.kind === "VIDEO" || clip.kind === "IMAGE")
      && (track.semanticRole === "BROLL" || track.id === "broll")
      && clip.mediaFit === undefined
      && clip.crop === undefined;
    const usesGeneratedCanvasLayout = clip.layout.x === 0
      && clip.layout.y === 0
      && clip.layout.width === params.document.canvas.width
      && clip.layout.height === params.document.canvas.height;
    const sourceDimensionsChanged = Boolean(sourceDimensions) && (
      clip.source.sourceHeight !== sourceDimensions?.height
      || clip.source.sourceWidth !== sourceDimensions?.width
    );
    const sourceAudioChanged = clip.source.hasAudio !== source.hasAudio;
    const synchronizedLabel = resolveProductionAssetClipLabel(source, clip.label);
    const labelChanged = clip.label !== synchronizedLabel;
    const synchronizedSceneTiming = clip.timingSource === "ESTIMATED"
      ? sceneTimingByAssetId.get(source.productionAssetId)
      : undefined;
    const sceneTimingChanged = Boolean(synchronizedSceneTiming) && (
      clip.startSeconds !== synchronizedSceneTiming?.startSeconds
      || clip.durationSeconds !== synchronizedSceneTiming?.durationSeconds
    );
    clipSynchronizationChanged ||= clip.trackId !== track.id
      || isUnframedLegacyBroll
      || sourceDimensionsChanged
      || sourceAudioChanged
      || labelChanged
      || sceneTimingChanged;
    return {
      ...clip,
      label: synchronizedLabel,
      ...(synchronizedSceneTiming ? synchronizedSceneTiming : {}),
      ...(isUnframedLegacyBroll ? { mediaFit: "CONTAIN" as const } : {}),
      ...(isUnframedLegacyBroll && sourceDimensions && usesGeneratedCanvasLayout ? {
        layout: resolveDefaultCompositionClipLayout({
          canvas: params.document.canvas,
          clipKind: clip.kind,
          sourceDimensions,
          track,
        }),
      } : {}),
      source: {
        ...clip.source,
        ...(source.hasAudio !== undefined ? { hasAudio: source.hasAudio } : {}),
        ...(sourceDimensions ? { sourceHeight: sourceDimensions.height, sourceWidth: sourceDimensions.width } : {}),
      },
      trackId: track.id,
    };
  });
  const synchronizedTracks = [...params.document.tracks];
  for (const requiredTrack of buildTracks(productionAssets, params.animatedDeck || null)) {
    if (!synchronizedTracks.some((track) => track.id === requiredTrack.id)) {
      synchronizedTracks.push(requiredTrack);
    }
  }
  const synchronizedCanvas = {
    ...params.document.canvas,
    ...(automaticDuration ? {
      durationSeconds: canvasDurationSeconds,
      durationSource: automaticDuration.source,
    } : {}),
    fps: DEFAULT_COMPOSITION_RENDER_FPS,
  };
  const deckReconciliation = reconcileDeckSlideClips({
    animatedDeck: params.animatedDeck,
    canvasDurationSeconds: synchronizedCanvas.durationSeconds,
    clips: synchronizedClips,
  });
  const synchronizedClipIds = new Set(synchronizedClips.map((clip) => clip.id));
  const synchronizedAnimations = params.document.motion.animations.filter((animation) => (
    synchronizedClipIds.has(animation.target.clipId)
  ));
  const removedOrphanAnimationCount = params.document.motion.animations.length - synchronizedAnimations.length;
  const nextDurationSource = automaticDuration?.source || params.document.canvas.durationSource;
  const documentWithoutDeckDependencies = compositionEditorDocumentSchema.parse({
    ...params.document,
    canvas: synchronizedCanvas,
    clips: deckReconciliation.clips,
    deckStyles: params.animatedDeck ? {
      css: params.animatedDeck.css,
      fontUrls: params.animatedDeck.fonts.map((font) => font.href),
    } : params.document.deckStyles,
    motion: {
      ...params.document.motion,
      animations: synchronizedAnimations,
    },
    tracks: synchronizedTracks.filter((track) => (
      track.kind === "DECK" || synchronizedClips.some((clip) => clip.trackId === track.id)
    )),
  });
  const appended = appendMissingProductionAssetClips(
    documentWithoutDeckDependencies,
    productionAssets,
    params.document.canvas.durationSeconds,
  );
  return {
    addedProductionAssetCount: appended.document.clips.length - documentWithoutDeckDependencies.clips.length,
    changed: removedDeckDependencyCount > 0
      || removedInactiveProductionAssetCount > 0
      || removedOrphanAnimationCount > 0
      || clipSynchronizationChanged
      || deckReconciliation.changed
      || canvasDurationSeconds !== params.document.canvas.durationSeconds
      || nextDurationSource !== params.document.canvas.durationSource
      || params.document.canvas.fps !== DEFAULT_COMPOSITION_RENDER_FPS
      || appended.changed,
    document: appended.document,
    removedDeckDependencyCount,
    removedInactiveProductionAssetCount,
    removedOrphanAnimationCount,
  };
}

/**
 * Adds a prepared deck to an existing draft without resetting authored timing,
 * layout, visibility, or motion. Existing slides are refreshed in place so a
 * regenerated deck cannot leave stale HTML behind; slides not yet represented
 * in the document are inserted with the standard estimated timing.
 */
function reconcileDeckSlideClips(params: {
  animatedDeck: HyperframesAnimatedDeckSource | null | undefined;
  canvasDurationSeconds: number;
  clips: CompositionClip[];
}) {
  if (!params.animatedDeck) return { changed: false, clips: params.clips };

  const generatedClips = buildDeckClips(params.animatedDeck, params.canvasDurationSeconds);
  const existingBySlideIndex = new Map(
    params.clips.flatMap((clip) => (
      isDeckSlideClip(clip) ? [[clip.source.slideIndex, clip] as const] : []
    )),
  );
  let changed = false;
  const refreshedById = new Map<string, CompositionClip>();

  for (const generated of generatedClips) {
    if (!isDeckSlideClip(generated)) continue;
    const existing = existingBySlideIndex.get(generated.source.slideIndex);
    if (!existing) {
      refreshedById.set(generated.id, generated);
      changed = true;
      continue;
    }
    const sourceChanged = existing.source.html !== generated.source.html
      || existing.source.classes !== generated.source.classes
      || existing.label !== generated.label;
    if (!sourceChanged) continue;
    refreshedById.set(existing.id, {
      ...existing,
      label: generated.label,
      source: generated.source,
    });
    changed = true;
  }

  if (!changed) return { changed: false, clips: params.clips };
  const refreshedClips = params.clips.map((clip) => refreshedById.get(clip.id) || clip);
  const newClips = generatedClips.filter((clip) => (
    isDeckSlideClip(clip) && !existingBySlideIndex.has(clip.source.slideIndex)
  ));
  return { changed: true, clips: [...refreshedClips, ...newClips] };
}

function isDeckSlideClip(
  clip: CompositionClip,
): clip is CompositionClip & { source: Extract<CompositionClip["source"], { type: "DECK_SLIDE" }> } {
  return clip.source.type === "DECK_SLIDE";
}

export function resolveCanvasDuration(params: {
  animatedDeck: HyperframesAnimatedDeckSource | null;
  assets: HyperframesProjectAsset[];
  plan: HyperframesPlan;
}): CompositionDurationResolution {
  return resolveCompositionDuration({
    assets: params.assets,
    slideCount: params.animatedDeck?.slides.length || 0,
  });
}

function buildTracks(assets: HyperframesProjectAsset[], deck: HyperframesAnimatedDeckSource | null) {
  const tracks = [];
  if (deck) tracks.push(getCompositionTrackDefinition("DECK"));
  for (const asset of assets) {
    const definition = resolveCompositionTrackDefinition(asset);
    if (!tracks.some((track) => track.id === definition.id)) {
      tracks.push(definition);
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
      layout: { height: deck.height, opacity: 1, rotation: 0, width: deck.width, x: 0, y: 0, zIndex: DEFAULT_COMPOSITION_LAYER.DECK },
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

function buildAssetClips(
  assets: HyperframesProjectAsset[],
  durationSeconds: number,
  initialIndex = 0,
  canvasWidth = 1920,
  canvasHeight = 1080,
  initialTimingByAssetId?: ReadonlyMap<string, { durationSeconds: number; startSeconds: number }>,
): CompositionClip[] {
  const assetsByTrack = new Map<string, HyperframesProjectAsset[]>();
  for (const asset of assets) {
    const trackId = resolveTrackId(asset);
    assetsByTrack.set(trackId, [...(assetsByTrack.get(trackId) || []), asset]);
  }
  const timingByAssetId = new Map(
    initialTimingByAssetId || buildSceneAssetTimings(assets, durationSeconds),
  );
  for (const [trackId, groupedAssets] of assetsByTrack) {
    const unpositionedAssets = groupedAssets.filter(
      (asset) => !timingByAssetId.has(asset.productionAssetId),
    );
    if (unpositionedAssets.length === 0) continue;
    const preferredDurations = unpositionedAssets.map((asset) => resolveInitialAssetDuration(asset, durationSeconds, trackId));
    const totalPreferredDuration = preferredDurations.reduce((total, value) => total + value, 0);
    const durationScale = trackId !== "music" && totalPreferredDuration > durationSeconds
      ? durationSeconds / totalPreferredDuration
      : 1;
    let cursor = 0;
    for (let index = 0; index < unpositionedAssets.length; index++) {
      const asset = unpositionedAssets[index]!;
      const preferredDuration = preferredDurations[index]!;
      const isSequential = trackId !== "music";
      const duration = isSequential
        ? Math.max(0.05, Math.min(preferredDuration * durationScale, durationSeconds - cursor))
        : preferredDuration;
      timingByAssetId.set(asset.productionAssetId, {
        durationSeconds: roundSeconds(duration),
        startSeconds: roundSeconds(isSequential ? cursor : 0),
      });
      if (isSequential) cursor += duration;
    }
  }

  return assets.map((asset, index) => {
    const kind = asset.mimeType.startsWith("audio/")
      ? "AUDIO" as const
      : asset.mimeType.startsWith("video/")
        ? "VIDEO" as const
        : "IMAGE" as const;
    const trackId = resolveTrackId(asset);
    const timing = timingByAssetId.get(asset.productionAssetId)!;
    const track = resolveCompositionTrackDefinition(asset);
    const sourceDimensions = asset.sourceWidth && asset.sourceHeight
      ? { height: asset.sourceHeight, width: asset.sourceWidth }
      : null;
    return {
      durationSeconds: timing.durationSeconds,
      hfId: `asset-${asset.productionAssetId}`,
      hidden: false,
      id: `asset-${asset.productionAssetId}`,
      kind,
      label: resolveProductionAssetClipLabel(asset, `Asset ${initialIndex + index + 1}`),
      layout: resolveDefaultCompositionClipLayout({
        canvas: { height: canvasHeight, width: canvasWidth },
        clipKind: kind,
        sourceDimensions,
        track,
      }),
      mediaFit: resolveDefaultCompositionMediaFit({ clipKind: kind, track }),
      source: {
        ...(asset.hasAudio !== undefined ? { hasAudio: asset.hasAudio } : {}),
        productionAssetId: asset.productionAssetId,
        ...(sourceDimensions ? { sourceHeight: sourceDimensions.height, sourceWidth: sourceDimensions.width } : {}),
        type: "PRODUCTION_ASSET" as const,
      },
      ...(asset.durationSeconds && asset.durationSeconds > 0 ? { sourceDurationSeconds: roundSeconds(asset.durationSeconds) } : {}),
      sourceOffsetSeconds: 0,
      startSeconds: timing.startSeconds,
      timingSource: "ESTIMATED" as const,
      trackId,
      ...(kind === "VIDEO" && (track.semanticRole === "BROLL" || track.id === "broll")
        ? { volume: 0 }
        : {}),
    };
  });
}

function resolveProductionAssetClipLabel(asset: HyperframesProjectAsset, fallback: string) {
  return (asset.label?.trim() || fallback).slice(0, 120);
}

/**
 * Scene media is authored on one shared clock. An avatar and its independent
 * voice overlap in the same slot, while a voice-only scene intentionally leaves
 * a visual gap. This preserves interleaved patterns such as avatar/voice/avatar.
 */
export function buildSceneAssetTimings(
  assets: HyperframesProjectAsset[],
  canvasDurationSeconds: number,
) {
  const sceneAssets = assets.filter((asset) => (
    Number.isInteger(asset.sceneOrder)
    && (asset.sceneOrder || 0) > 0
    && (asset.timelineRole === "AVATAR" || asset.timelineRole === "VOICE")
  ));
  if (sceneAssets.length === 0) {
    return new Map<string, { durationSeconds: number; startSeconds: number }>();
  }

  const assetsBySceneOrder = new Map<number, HyperframesProjectAsset[]>();
  for (const asset of sceneAssets) {
    const order = asset.sceneOrder!;
    assetsBySceneOrder.set(order, [...(assetsBySceneOrder.get(order) || []), asset]);
  }

  const scenes = [...assetsBySceneOrder.entries()]
    .sort(([left], [right]) => left - right)
    .map(([order, groupedAssets]) => {
      const voiceDuration = groupedAssets
        .filter((asset) => asset.timelineRole === "VOICE")
        .map((asset) => asset.durationSeconds || 0)
        .find((duration) => duration > 0);
      const measuredDuration = Math.max(
        0,
        ...groupedAssets.map((asset) => asset.durationSeconds || 0),
      );
      return {
        assets: groupedAssets,
        durationSeconds: voiceDuration || measuredDuration || 5,
        order,
      };
    });
  const preferredTotalDuration = scenes.reduce(
    (total, scene) => total + scene.durationSeconds,
    0,
  );
  const durationScale = preferredTotalDuration > canvasDurationSeconds
    ? canvasDurationSeconds / preferredTotalDuration
    : 1;
  const timingByAssetId = new Map<string, { durationSeconds: number; startSeconds: number }>();
  let cursor = 0;
  for (const scene of scenes) {
    const remainingDuration = Math.max(0.05, canvasDurationSeconds - cursor);
    const durationSeconds = roundSeconds(Math.max(
      0.05,
      Math.min(scene.durationSeconds * durationScale, remainingDuration),
    ));
    for (const asset of scene.assets) {
      timingByAssetId.set(asset.productionAssetId, {
        durationSeconds,
        startSeconds: roundSeconds(cursor),
      });
    }
    cursor += durationSeconds;
  }
  return timingByAssetId;
}

function resolveInitialAssetDuration(asset: HyperframesProjectAsset, canvasDuration: number, trackId: string) {
  const measuredDuration = asset.durationSeconds && asset.durationSeconds > 0 ? asset.durationSeconds : null;
  const fallbackDuration = trackId === "avatar" || trackId === "voice" || trackId === "music"
    ? canvasDuration
    : asset.mimeType.startsWith("image/") ? 5 : 8;
  return Math.min(canvasDuration, measuredDuration || fallbackDuration);
}

function resolveTrackId(asset: HyperframesProjectAsset) {
  return resolveCompositionTrackDefinition(asset).id;
}

/** A complete avatar is authoritative and must not overlap generated avatar fragments. */
export function selectAuthoritativeTimelineAssets(assets: HyperframesProjectAsset[]) {
  const authoritativeFullAvatar = assets
    .filter((asset) => asset.timelineRole === "AVATAR" && asset.timelineVariant === "FULL")
    .sort((left, right) => (right.durationSeconds || 0) - (left.durationSeconds || 0))[0];
  if (!authoritativeFullAvatar) return assets;
  return assets.filter((asset) => (
    asset.timelineRole !== "AVATAR" || asset.productionAssetId === authoritativeFullAvatar.productionAssetId
  ));
}

function roundSeconds(value: number) {
  return Math.round(value * 1000) / 1000;
}
