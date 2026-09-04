import {
  compositionEditorDocumentSchema,
  type CompositionClip,
  type CompositionEditorDocument,
} from "./composition-document.types";
import {
  resolveDefaultCompositionClipLayout,
  resolveDefaultCompositionMediaFit,
} from "./composition-default-layout.service";
import { getCompositionTrackDefinition } from "./composition-track-registry";

export type ProductionIntroAsset = {
  durationSeconds: number;
  hasAudio?: boolean;
  id: string;
  label: string;
  mimeType: string;
  sourceHeight?: number;
  sourceWidth?: number;
};

/**
 * Replaces the per-video Production intro and preserves all authored content.
 * Content is shifted as one transaction so it always begins after the intro.
 */
export function reconcileProductionIntroDocument(
  document: CompositionEditorDocument,
  intro: ProductionIntroAsset | null,
): CompositionEditorDocument {
  const previousIntroIds = new Set(document.clips.flatMap((clip) => (
    clip.source.type === "PRODUCTION_ASSET" && clip.source.placement === "INTRO" ? [clip.id] : []
  )));
  const content = document.clips.filter((clip) => !previousIntroIds.has(clip.id));
  if (content.length === 0) throw new Error("La composición debe conservar contenido además de la intro.");

  const introDuration = intro ? roundSeconds(intro.durationSeconds) : 0;
  if (intro && (!Number.isFinite(introDuration) || introDuration <= 0)) {
    throw new Error("La intro debe tener una duración válida.");
  }
  const contentStart = Math.min(...content.map((clip) => clip.startSeconds));
  const shift = roundSeconds(introDuration - contentStart);
  const shiftedContent = content.map((clip) => ({
    ...clip,
    startSeconds: roundSeconds(clip.startSeconds + shift),
  }));
  const contentEnd = Math.max(...shiftedContent.map((clip) => clip.startSeconds + clip.durationSeconds));
  const introTrack = getCompositionTrackDefinition("VISUAL");
  const tracks = document.tracks.some((track) => track.id === introTrack.id)
    ? document.tracks
    : [...document.tracks, introTrack];
  const clips: CompositionClip[] = intro
    ? [buildIntroClip(document, intro), ...shiftedContent]
    : shiftedContent;

  return compositionEditorDocumentSchema.parse({
    ...document,
    canvas: { ...document.canvas, durationMode: "AUTO", durationSeconds: roundSeconds(contentEnd) },
    clips,
    motion: {
      ...document.motion,
      animations: document.motion.animations.filter((animation) => !previousIntroIds.has(animation.target.clipId)),
    },
    tracks,
  });
}

function buildIntroClip(document: CompositionEditorDocument, intro: ProductionIntroAsset): CompositionClip {
  const dimensions = intro.sourceWidth && intro.sourceHeight
    ? { height: intro.sourceHeight, width: intro.sourceWidth }
    : null;
  const kind: CompositionClip["kind"] = intro.mimeType.startsWith("video/") ? "VIDEO" : "IMAGE";
  const track = getCompositionTrackDefinition("VISUAL");
  return {
    durationSeconds: roundSeconds(intro.durationSeconds),
    hfId: "production-intro-media",
    hidden: false,
    id: "production-intro",
    kind,
    label: `Intro · ${intro.label}`,
    layout: resolveDefaultCompositionClipLayout({ canvas: document.canvas, clipKind: kind, sourceDimensions: dimensions, track }),
    mediaFit: resolveDefaultCompositionMediaFit({ clipKind: kind, track }),
    source: {
      ...(intro.hasAudio !== undefined ? { hasAudio: intro.hasAudio } : {}),
      placement: "INTRO",
      productionAssetId: intro.id,
      ...(dimensions ? { sourceHeight: dimensions.height, sourceWidth: dimensions.width } : {}),
      type: "PRODUCTION_ASSET",
    },
    sourceDurationSeconds: roundSeconds(intro.durationSeconds),
    sourceOffsetSeconds: 0,
    startSeconds: 0,
    timingSource: "ESTIMATED",
    trackId: track.id,
    volume: intro.hasAudio ? 1 : 0,
  };
}

function roundSeconds(value: number) {
  return Math.round(value * 1_000) / 1_000;
}
