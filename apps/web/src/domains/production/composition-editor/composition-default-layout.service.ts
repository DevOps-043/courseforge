import type { CompositionClip, CompositionEditorDocument, CompositionTrack } from "./composition-document.types";

/** Canonical initial layout shared by document creation and explicit asset reset. */
export function resolveDefaultCompositionClipLayout(params: {
  canvas: Pick<CompositionEditorDocument["canvas"], "height" | "width">;
  clipKind: CompositionClip["kind"];
  track: Pick<CompositionTrack, "id" | "semanticRole">;
}): CompositionClip["layout"] {
  const { canvas, clipKind, track } = params;
  if (clipKind === "AUDIO") {
    return { height: 1, opacity: 1, rotation: 0, width: 1, x: 0, y: 0, zIndex: 0 };
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
      zIndex: 10,
    };
  }
  return {
    height: canvas.height,
    opacity: 1,
    rotation: 0,
    width: canvas.width,
    x: 0,
    y: 0,
    zIndex: track.semanticRole === "BROLL" || track.id === "broll" ? 5 : -1,
  };
}
