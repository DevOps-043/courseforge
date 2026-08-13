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
    ...buildAssetClips(params.assets, durationSeconds),
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
  if (
    missingAssets.some((asset) => asset.mimeType.startsWith("video/") || asset.mimeType.startsWith("image/"))
    && !tracks.some((track) => track.id === "visual")
  ) {
    tracks.push({ id: "visual", kind: "VISUAL" as const, label: "Medios visuales", locked: false, order: nextTrackOrder(tracks) });
  }
  if (missingAssets.some((asset) => asset.mimeType.startsWith("audio/")) && !tracks.some((track) => track.id === "audio")) {
    tracks.push({ id: "audio", kind: "AUDIO" as const, label: "Audio", locked: false, order: nextTrackOrder(tracks) });
  }

  const clips = [
    ...document.clips,
    ...buildAssetClips(missingAssets, document.canvas.durationSeconds, document.clips.length),
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

function resolveCanvasDuration(params: {
  animatedDeck: HyperframesAnimatedDeckSource | null;
  assets: HyperframesProjectAsset[];
  plan: HyperframesPlan;
}) {
  const deckMinimum = params.animatedDeck ? params.animatedDeck.slides.length * 5 : 0;
  return Math.min(COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS, Math.max(params.plan.durationSeconds, deckMinimum, 3));
}

function buildTracks(assets: HyperframesProjectAsset[], deck: HyperframesAnimatedDeckSource | null) {
  const tracks = [];
  if (deck) tracks.push({ id: "deck", kind: "DECK" as const, label: "Deck HTML", locked: false, order: 0 });
  if (assets.some((asset) => asset.mimeType.startsWith("video/") || asset.mimeType.startsWith("image/"))) {
    tracks.push({ id: "visual", kind: "VISUAL" as const, label: "Medios visuales", locked: false, order: 1 });
  }
  if (assets.some((asset) => asset.mimeType.startsWith("audio/"))) {
    tracks.push({ id: "audio", kind: "AUDIO" as const, label: "Audio", locked: false, order: 2 });
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

function buildAssetClips(assets: HyperframesProjectAsset[], durationSeconds: number, initialIndex = 0): CompositionClip[] {
  return assets.map((asset, index) => {
    const kind = asset.mimeType.startsWith("audio/")
      ? "AUDIO" as const
      : asset.mimeType.startsWith("video/")
        ? "VIDEO" as const
        : "IMAGE" as const;
    const isAudio = kind === "AUDIO";
    return {
      durationSeconds,
      hfId: `asset-${asset.productionAssetId}`,
      hidden: false,
      id: `asset-${asset.productionAssetId}`,
      kind,
      label: asset.label?.trim() || `Asset ${initialIndex + index + 1}`,
      layout: {
        height: isAudio ? 1 : 1080,
        opacity: 1,
        rotation: 0,
        width: isAudio ? 1 : 1920,
        x: 0,
        y: 0,
        zIndex: isAudio ? 0 : -1,
      },
      source: { productionAssetId: asset.productionAssetId, type: "PRODUCTION_ASSET" as const },
      startSeconds: 0,
      timingSource: "ESTIMATED" as const,
      trackId: isAudio ? "audio" : "visual",
    };
  });
}

function nextTrackOrder(tracks: CompositionEditorDocument["tracks"]) {
  return tracks.reduce((highest, track) => Math.max(highest, track.order), -1) + 1;
}

function roundSeconds(value: number) {
  return Math.round(value * 1000) / 1000;
}
