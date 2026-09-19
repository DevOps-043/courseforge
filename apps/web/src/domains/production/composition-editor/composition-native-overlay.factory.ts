import type {
  CompositionClip,
  CompositionEditorDocument,
  CompositionTrack,
} from "./composition-document.types";
import {
  DEFAULT_NATIVE_TEXT_STYLE,
  DEFAULT_TRANSPARENT_CAPTION_STYLE,
} from "./composition-text-layer.types";

export type NativeOverlayKind = "CAPTION" | "TEXT";

export function createCompositionNativeOverlay(params: {
  document: CompositionEditorDocument;
  id: string;
  kind: NativeOverlayKind;
  playheadSeconds: number;
}) {
  const { document, id, kind } = params;
  const minimumDuration = 1 / document.canvas.fps;
  const startSeconds = Math.min(
    Math.max(0, params.playheadSeconds),
    Math.max(0, document.canvas.durationSeconds - minimumDuration),
  );
  const durationSeconds = Math.min(5, document.canvas.durationSeconds - startSeconds);
  if (durationSeconds < minimumDuration) {
    throw new Error("La composición no tiene espacio disponible para una capa nueva.");
  }

  const trackId = kind === "CAPTION" ? "native-captions" : "native-text";
  const existingTrack = document.tracks.find((track) => track.id === trackId);
  if (!existingTrack && document.tracks.length >= 32) {
    throw new Error("La composición alcanzó el máximo de pistas permitido.");
  }
  const track: CompositionTrack = existingTrack || {
    id: trackId,
    kind: "OVERLAY",
    label: kind === "CAPTION" ? "Captions" : "Texto",
    locked: false,
    order: nextTrackOrder(document.tracks),
    semanticRole: kind === "CAPTION" ? "CAPTIONS" : "TEXT",
  };

  const isCaption = kind === "CAPTION";
  const width = Math.min(document.canvas.width * 0.84, 1_440);
  const height = isCaption ? Math.min(220, document.canvas.height * 0.22) : Math.min(300, document.canvas.height * 0.3);
  const clip: CompositionClip = {
    durationSeconds,
    hfId: id,
    hidden: false,
    id,
    kind,
    label: isCaption ? "Caption" : "Texto",
    layout: {
      height,
      opacity: 1,
      rotation: 0,
      width,
      x: (document.canvas.width - width) / 2,
      y: isCaption
        ? Math.max(0, document.canvas.height - height - document.canvas.height * 0.06)
        : document.canvas.height * 0.12,
      zIndex: isCaption ? 9 : 8,
    },
    source: isCaption
      ? {
        cues: [{
          endSeconds: durationSeconds,
          id: `${id}-cue-1`,
          startSeconds: 0,
          text: "Escribe tu caption",
        }],
        origin: "MANUAL",
        style: { ...DEFAULT_TRANSPARENT_CAPTION_STYLE },
        type: "NATIVE_CAPTIONS",
      }
      : {
        style: { ...DEFAULT_NATIVE_TEXT_STYLE },
        text: "Escribe tu texto",
        type: "NATIVE_TEXT",
      },
    startSeconds,
    timingSource: "USER_EDITED",
    trackId,
  };

  return { clip, track: existingTrack ? undefined : track };
}

function nextTrackOrder(tracks: CompositionTrack[]) {
  const used = new Set(tracks.map((track) => track.order));
  for (let order = 0; order <= 99; order += 1) {
    if (!used.has(order)) return order;
  }
  throw new Error("No hay un orden de pista disponible.");
}
