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
import type { CompositionNarrativeScene } from "./composition-narrative.types";
import { compositionSlideKey, narrativeFingerprint } from "./composition-narrative-source.service";
import { isCompositionClipExcluded } from "./composition-source-selection";

/**
 * Creates the first editable document from internal Production sources.
 * Slide timing is explicitly ESTIMATED because the persisted deck contract has
 * no authored slide duration; user edits become the render source of truth.
 */
export function createInitialCompositionDocument(params: {
  narrativeScenes?: CompositionNarrativeScene[];
  animatedDeck: HyperframesAnimatedDeckSource | null;
  assets: HyperframesProjectAsset[];
  plan: HyperframesPlan;
}): CompositionEditorDocument {
  const duration = resolveCanvasDuration(params);
  const durationSeconds = duration.durationSeconds;
  const timelineAssets = selectAuthoritativeTimelineAssets(params.assets);
  const tracks = buildTracks(timelineAssets, params.animatedDeck);
  const clips = [
    ...buildNarrativeDeckClips(params.animatedDeck, durationSeconds, timelineAssets, params.narrativeScenes),
    ...buildAssetClips(timelineAssets, durationSeconds, 0, params.animatedDeck?.width || 1920, params.animatedDeck?.height || 1080),
  ];
  if (clips.length === 0) throw new Error("No hay fuentes internas para crear la composición.");
  return compositionEditorDocumentSchema.parse({
    ...(params.narrativeScenes?.length ? { narrativeScenes: params.narrativeScenes } : {}),
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
      appearance: params.animatedDeck.appearance || "light",
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
  const missingAssets = assets.filter((asset) => !existingAssetIds.has(asset.productionAssetId)
    && !document.excludedSources?.includes(`asset:${asset.productionAssetId}`));
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
      Math.max(document.canvas.durationSeconds, extendedVoiceCursor),
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
  narrativeScenes?: CompositionNarrativeScene[];
  replaceNarrativeTiming?: boolean;
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
    const synchronizedSourceDuration = source.durationSeconds && source.durationSeconds > 0
      ? roundSeconds(source.durationSeconds)
      : clip.sourceDurationSeconds;
    const synchronizedSourceOffset = synchronizedSourceDuration !== undefined
      && (clip.sourceOffsetSeconds || 0) >= synchronizedSourceDuration
      ? Math.max(0, roundSeconds(synchronizedSourceDuration - 0.001))
      : clip.sourceOffsetSeconds;
    const proposedDuration = synchronizedSceneTiming?.durationSeconds || clip.durationSeconds;
    const synchronizedDuration = clip.kind === "AUDIO" && synchronizedSourceDuration !== undefined
      ? Math.max(0.001, roundSeconds(Math.min(
          proposedDuration,
          synchronizedSourceDuration - (synchronizedSourceOffset || 0),
        )))
      : proposedDuration;
    const sceneTimingChanged = Boolean(synchronizedSceneTiming) && (
      clip.startSeconds !== synchronizedSceneTiming?.startSeconds
      || clip.durationSeconds !== synchronizedDuration
    );
    clipSynchronizationChanged ||= clip.trackId !== track.id
      || clip.sceneId !== source.sceneClipId
      || isUnframedLegacyBroll
      || sourceDimensionsChanged
      || sourceAudioChanged
      || labelChanged
      || sceneTimingChanged;
    clipSynchronizationChanged ||= clip.sourceDurationSeconds !== synchronizedSourceDuration
      || clip.sourceOffsetSeconds !== synchronizedSourceOffset;
    return {
      ...clip,
      sceneId: source.sceneClipId,
      label: synchronizedLabel,
      ...(synchronizedSceneTiming ? {
        durationSeconds: synchronizedDuration,
        startSeconds: synchronizedSceneTiming.startSeconds,
      } : clip.kind === "AUDIO" && synchronizedDuration !== clip.durationSeconds
        ? { durationSeconds: synchronizedDuration }
        : {}),
      ...(synchronizedSourceDuration !== undefined ? { sourceDurationSeconds: synchronizedSourceDuration } : {}),
      ...(synchronizedSourceOffset !== undefined ? { sourceOffsetSeconds: synchronizedSourceOffset } : {}),
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
    excludedSources: params.document.excludedSources,
    assets: productionAssets,
    narrativeScenes: params.narrativeScenes,
    replaceNarrativeTiming: params.replaceNarrativeTiming,
  });
  const synchronizedClipIds = new Set(deckReconciliation.clips.map((clip) => clip.id));
  const synchronizedAnimations = params.document.motion.animations.filter((animation) => (
    synchronizedClipIds.has(animation.target.clipId)
  ));
  const removedOrphanAnimationCount = params.document.motion.animations.length - synchronizedAnimations.length;
  const nextDurationSource = automaticDuration?.source || params.document.canvas.durationSource;
  const documentWithoutDeckDependencies = compositionEditorDocumentSchema.parse({
    ...params.document,
    ...(params.narrativeScenes !== undefined ? { narrativeScenes: params.narrativeScenes } : {}),
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
    changed: (params.narrativeScenes !== undefined && JSON.stringify(params.narrativeScenes) !== JSON.stringify(params.document.narrativeScenes))
      || removedDeckDependencyCount > 0
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
  excludedSources?: string[];
  assets: HyperframesProjectAsset[];
  narrativeScenes?: CompositionNarrativeScene[];
  replaceNarrativeTiming?: boolean;
}) {
  if (!params.animatedDeck) return { changed: false, clips: params.clips };

  const generatedClips = buildNarrativeDeckClips(params.animatedDeck, params.canvasDurationSeconds, params.assets, params.narrativeScenes)
    .filter((clip) => params.replaceNarrativeTiming || !isCompositionClipExcluded(clip, params.excludedSources));
  const hasNarrativePlan = canPreassembleScenes(params.narrativeScenes, params.assets);
  const existingDeck = params.clips.filter(isDeckSlideClip);
  // Never rebuild authored timing automatically. A changed or incomplete plan
  // also keeps its last arrangement until it can be reviewed against real media.
  if (existingDeck.some((clip) => clip.sceneId) && !hasNarrativePlan) return { changed: false, clips: params.clips };
  if (hasNarrativePlan) {
    if (!params.replaceNarrativeTiming && existingDeck.length > 0) return { changed: false, clips: params.clips };
    const authoredById = new Map(existingDeck.map((clip) => [clip.id, clip]));
    const nextDeck = generatedClips.map((clip) => {
      const authored = authoredById.get(clip.id);
      return authored ? { ...clip, hidden: authored.hidden, layout: authored.layout } : clip;
    });
    const clips = [...params.clips.filter((clip) => !isDeckSlideClip(clip)), ...nextDeck];
    return { changed: JSON.stringify(existingDeck) !== JSON.stringify(nextDeck), clips };
  }
  const existingBySlideIndex = new Map(
    params.clips.flatMap((clip) => (
      isDeckSlideClip(clip) ? [[clip.source.slideKey || String(clip.source.slideIndex), clip] as const] : []
    )),
  );
  let changed = false;
  const refreshedById = new Map<string, CompositionClip>();

  for (const generated of generatedClips) {
    if (!isDeckSlideClip(generated)) continue;
    const existing = existingBySlideIndex.get(generated.source.slideKey!)
      || existingBySlideIndex.get(String(generated.source.slideIndex))
      || params.clips.find((clip) => isDeckSlideClip(clip) && clip.source.slideIndex === generated.source.slideIndex);
    if (!existing || !isDeckSlideClip(existing)) {
      refreshedById.set(generated.id, generated);
      changed = true;
      continue;
    }
    const sourceChanged = existing.source.html !== generated.source.html
      || existing.source.slideKey !== generated.source.slideKey
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
    isDeckSlideClip(clip) && !existingBySlideIndex.has(clip.source.slideKey!) && !existingBySlideIndex.has(String(clip.source.slideIndex))
      && !params.clips.some((existing) => isDeckSlideClip(existing) && existing.source.slideIndex === clip.source.slideIndex)
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
        slideKey: compositionSlideKey(slide),
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

export function canPreassembleScenes(scenes: CompositionNarrativeScene[] | undefined, assets: HyperframesProjectAsset[]) {
  return Boolean(scenes?.length && scenes.every((scene) => !scene.needsReview && scene.visualPlan
    && assets.some((asset) => asset.sceneClipId === scene.id && (asset.durationSeconds || 0) > 0
      && Number.isInteger(asset.sceneOrder) && asset.sceneOrder! > 0
      && (asset.timelineRole === "VOICE" || asset.timelineRole === "AVATAR"))));
}

function buildNarrativeDeckClips(deck: HyperframesAnimatedDeckSource | null, durationSeconds: number,
  assets: HyperframesProjectAsset[], scenes?: CompositionNarrativeScene[]): CompositionClip[] {
  const defaults = buildDeckClips(deck, durationSeconds);
  if (!deck || !canPreassembleScenes(scenes, assets)) return defaults;
  const byKey = new Map(defaults.map((clip) => [clip.source.type === "DECK_SLIDE" ? clip.source.slideKey : "", clip]));
  const timings = buildSceneAssetTimings(assets, durationSeconds);
  return scenes!.flatMap((scene) => {
    const sceneTimings = assets.flatMap((candidate) => {
      const timing = candidate.sceneClipId === scene.id
        ? timings.get(candidate.productionAssetId)
        : undefined;
      return timing ? [timing] : [];
    });
    if (sceneTimings.length === 0) return [];
    const sceneStartSeconds = Math.min(...sceneTimings.map((timing) => timing.startSeconds));
    const sceneEndSeconds = Math.max(...sceneTimings.map((timing) => timing.startSeconds + timing.durationSeconds));
    const timing = {
      durationSeconds: roundSeconds(sceneEndSeconds - sceneStartSeconds),
      startSeconds: roundSeconds(sceneStartSeconds),
    };
    const selections = scene.visualPlan!.slides;
    const totalWeight = selections.reduce((sum, slide) => sum + slide.weight, 0);
    let consumedWeight = 0;
    return selections.flatMap((selection, index) => {
      const base = byKey.get(selection.key);
      if (!base) return [];
      const startSeconds = roundSeconds(timing.startSeconds + timing.durationSeconds * consumedWeight / totalWeight);
      consumedWeight += selection.weight;
      const end = roundSeconds(timing.startSeconds + timing.durationSeconds * consumedWeight / totalWeight);
      const id = `scene-slide-${narrativeFingerprint(scene.id).slice(0, 16)}-${selection.key.slice(0, 16)}-${index}`;
      return [{ ...base, id, hfId: id, sceneId: scene.id, startSeconds, durationSeconds: roundSeconds(end - startSeconds) }];
    });
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
      ...(asset.sceneClipId ? { sceneId: asset.sceneClipId } : {}),
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

  const sceneGroups = new Map<string, {
    assets: HyperframesProjectAsset[];
    firstSeenIndex: number;
    order: number;
  }>();
  for (const [index, asset] of sceneAssets.entries()) {
    // sceneClipId is the narrative identity used by resolveCompositionDuration.
    // sceneOrder is presentation metadata and may temporarily collide while a
    // manual scene is being reconciled with its originating storyboard.
    const identity = asset.sceneClipId
      ? `scene:${asset.sceneClipId}`
      : `legacy-order:${asset.sceneOrder}`;
    const existing = sceneGroups.get(identity);
    if (existing) {
      existing.assets.push(asset);
      continue;
    }
    sceneGroups.set(identity, {
      assets: [asset],
      firstSeenIndex: index,
      order: asset.sceneOrder!,
    });
  }

  const scenes = [...sceneGroups.values()]
    .sort((left, right) => left.order - right.order || left.firstSeenIndex - right.firstSeenIndex)
    .map((group) => {
      const voiceDuration = Math.max(
        0,
        ...group.assets
          .filter((asset) => asset.timelineRole === "VOICE")
          .map((asset) => asset.durationSeconds || 0),
      );
      const measuredDuration = Math.max(
        0,
        ...group.assets.map((asset) => asset.durationSeconds || 0),
      );
      return {
        assets: group.assets,
        durationSeconds: voiceDuration || measuredDuration || 5,
      };
    });
  const preferredTotalDuration = scenes.reduce(
    (total, scene) => total + scene.durationSeconds,
    0,
  );
  const durationScale = preferredTotalDuration > canvasDurationSeconds
    ? canvasDurationSeconds / preferredTotalDuration
    : 1;
  const allocatedDurations = allocateSceneDurations(
    scenes.map((scene) => scene.durationSeconds * durationScale),
    canvasDurationSeconds,
  );
  const timingByAssetId = new Map<string, { durationSeconds: number; startSeconds: number }>();
  let cursor = 0;
  for (const [sceneIndex, scene] of scenes.entries()) {
    const sceneDurationSeconds = allocatedDurations[sceneIndex]!;
    for (const asset of scene.assets) {
      // Audio cannot be extended beyond its media boundary. This defensive
      // cap also keeps legacy duplicate registry rows readable during repair.
      const assetDurationSeconds = asset.mimeType.startsWith("audio/")
        && asset.durationSeconds
        ? Math.min(sceneDurationSeconds, asset.durationSeconds)
        : sceneDurationSeconds;
      timingByAssetId.set(asset.productionAssetId, {
        durationSeconds: roundSeconds(assetDurationSeconds),
        startSeconds: roundSeconds(cursor),
      });
    }
    cursor = roundSeconds(cursor + sceneDurationSeconds);
  }
  return timingByAssetId;
}

/**
 * Quantizes scene durations once, reserving at least one millisecond for every
 * remaining scene. Independent floating-point rounding could otherwise make
 * the last clip cross the canvas boundary and invalidate the whole document.
 */
function allocateSceneDurations(durations: number[], canvasDurationSeconds: number) {
  const canvasMilliseconds = Math.max(1, Math.round(canvasDurationSeconds * 1_000));
  let remainingMilliseconds = canvasMilliseconds;
  return durations.map((duration, index) => {
    const remainingSceneCount = durations.length - index - 1;
    const maximumMilliseconds = Math.max(1, remainingMilliseconds - remainingSceneCount);
    const durationMilliseconds = index === durations.length - 1
      ? Math.max(1, Math.min(Math.round(duration * 1_000), remainingMilliseconds))
      : Math.max(1, Math.min(Math.round(duration * 1_000), maximumMilliseconds));
    remainingMilliseconds = Math.max(0, remainingMilliseconds - durationMilliseconds);
    return durationMilliseconds / 1_000;
  });
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
