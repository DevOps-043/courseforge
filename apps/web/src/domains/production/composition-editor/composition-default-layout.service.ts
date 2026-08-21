import type { CompositionClip, CompositionEditorDocument, CompositionTrack } from "./composition-document.types";
import { DEFAULT_COMPOSITION_LAYER } from "./composition-layer-depth";

/** Canonical initial layout shared by document creation and explicit asset reset. */
export function resolveDefaultCompositionClipLayout(params: {
  canvas: Pick<CompositionEditorDocument["canvas"], "height" | "width">;
  clipKind: CompositionClip["kind"];
  sourceDimensions?: { height: number; width: number } | null;
  track: Pick<CompositionTrack, "id" | "semanticRole">;
}): CompositionClip["layout"] {
  const { canvas, clipKind, sourceDimensions, track } = params;
  if (clipKind === "AUDIO") {
    return { height: 1, opacity: 1, rotation: 0, width: 1, x: 0, y: 0, zIndex: DEFAULT_COMPOSITION_LAYER.AUDIO };
  }
  if (track.semanticRole === "AVATAR" || track.id === "avatar") {
    const width = Math.round(canvas.width * 0.32);
    const height = Math.round(canvas.height * 0.65);
    return {
      height,
      opacity: 1,
      rotation: 0,
      width,
      x: canvas.width - width - 48,
      y: canvas.height - height - 48,
      zIndex: DEFAULT_COMPOSITION_LAYER.AVATAR,
    };
  }
  if (
    (track.semanticRole === "BROLL" || track.id === "broll")
    && sourceDimensions
  ) {
    const scale = Math.min(
      canvas.width / sourceDimensions.width,
      canvas.height / sourceDimensions.height,
    );
    const width = Math.max(1, Math.round(sourceDimensions.width * scale));
    const height = Math.max(1, Math.round(sourceDimensions.height * scale));
    return {
      height,
      opacity: 1,
      rotation: 0,
      width,
      x: Math.round((canvas.width - width) / 2),
      y: Math.round((canvas.height - height) / 2),
      zIndex: DEFAULT_COMPOSITION_LAYER.BROLL,
    };
  }
  return {
    height: canvas.height,
    opacity: 1,
    rotation: 0,
    width: canvas.width,
    x: 0,
    y: 0,
    zIndex: track.semanticRole === "BROLL" || track.id === "broll"
      ? DEFAULT_COMPOSITION_LAYER.BROLL
      : DEFAULT_COMPOSITION_LAYER.VISUAL,
  };
}

/** Canonical source fitting shared by document creation, reset and UI. */
export function resolveDefaultCompositionMediaFit(params: {
  clipKind: CompositionClip["kind"];
  track: Pick<CompositionTrack, "id" | "semanticRole">;
}): CompositionClip["mediaFit"] {
  if (params.clipKind === "AUDIO" || params.clipKind === "DECK_SLIDE") return undefined;
  if (
    params.track.semanticRole === "AVATAR"
    || params.track.id === "avatar"
    || params.track.semanticRole === "BROLL"
    || params.track.id === "broll"
  ) {
    return "CONTAIN";
  }
  return "COVER";
}
