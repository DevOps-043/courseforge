import type {
  CompositionClip,
  CompositionEditorDocument,
} from "./composition-document.types";
import { compositionClipHasConfigurableAudio } from "./composition-clip-audio.service";
import { resolveCompositionAnimationWindow } from "./composition-motion-scheduling.service";
import {
  COMPOSITION_TRANSITION_MAX_DURATION_SECONDS,
  type CompositionTransition,
  type CompositionTransitionAlignment,
} from "./composition-transition.types";

const TRANSITION_EPSILON_SECONDS = 0.001;

export type CompositionTransitionIssueCode =
  | "ADJACENCY_REQUIRED"
  | "ANIMATION_CONFLICT"
  | "AUDIO_CROSSFADE_UNAVAILABLE"
  | "CLIP_HIDDEN"
  | "CLIP_NOT_FOUND"
  | "DUPLICATE_EDIT_POINT"
  | "DURATION_EXCEEDS_AVAILABLE"
  | "DURATION_NOT_FRAME_ALIGNED"
  | "INSUFFICIENT_MEDIA_HANDLES"
  | "LAYOUT_DEPTH_MISMATCH"
  | "SOURCE_DURATION_REQUIRED"
  | "THIRD_CLIP_CONFLICT"
  | "TRACK_HIDDEN"
  | "TRACK_LOCKED"
  | "TRACK_MISMATCH"
  | "VISUAL_CLIP_REQUIRED"
  | "WINDOW_OUTSIDE_CANVAS";

export interface CompositionTransitionIssue {
  code: CompositionTransitionIssueCode;
  message: string;
}

export interface CompositionTransitionWindow {
  cutSeconds: number;
  endSeconds: number;
  incomingHeadHandleSeconds: number;
  outgoingTailHandleSeconds: number;
  requiredIncomingHeadSeconds: number;
  requiredOutgoingTailSeconds: number;
  startSeconds: number;
}

export interface CompositionTransitionEligibility {
  available: boolean;
  issues: CompositionTransitionIssue[];
  maximumDurationSeconds: number;
  window: CompositionTransitionWindow | null;
}

export interface CompositionTransitionEditPoint {
  cutSeconds: number;
  existingTransitionId: string | null;
  fromClip: CompositionClip;
  toClip: CompositionClip;
}

/** Canonical adjacent visual cuts exposed by the editor. */
export function listCompositionTransitionEditPoints(
  document: CompositionEditorDocument,
): CompositionTransitionEditPoint[] {
  const frameSeconds = 1 / document.canvas.fps;
  const visualClips = document.clips
    .filter((clip) => clip.kind !== "AUDIO" && !clip.hidden)
    .slice()
    .sort((left, right) => (
      left.trackId.localeCompare(right.trackId)
      || left.layout.zIndex - right.layout.zIndex
      || left.startSeconds - right.startSeconds
      || left.id.localeCompare(right.id)
    ));
  const points: CompositionTransitionEditPoint[] = [];
  for (let index = 0; index < visualClips.length - 1; index += 1) {
    const fromClip = visualClips[index]!;
    const toClip = visualClips[index + 1]!;
    if (fromClip.trackId !== toClip.trackId || fromClip.layout.zIndex !== toClip.layout.zIndex) continue;
    const fromEndSeconds = fromClip.startSeconds + fromClip.durationSeconds;
    if (Math.abs(fromEndSeconds - toClip.startSeconds) > frameSeconds + TRANSITION_EPSILON_SECONDS) continue;
    points.push({
      cutSeconds: roundSeconds((fromEndSeconds + toClip.startSeconds) / 2),
      existingTransitionId: document.transitions?.items.find((transition) => (
        transition.fromClipId === fromClip.id && transition.toClipId === toClip.id
      ))?.id || null,
      fromClip,
      toClip,
    });
  }
  return points.sort((left, right) => left.cutSeconds - right.cutSeconds || left.fromClip.id.localeCompare(right.fromClip.id));
}

export function resolveCompositionTransitionEligibility(params: {
  document: CompositionEditorDocument;
  transition: CompositionTransition;
  excludeTransitionId?: string;
}): CompositionTransitionEligibility {
  const { document, transition } = params;
  const issues: CompositionTransitionIssue[] = [];
  const fromClip = document.clips.find((clip) => clip.id === transition.fromClipId);
  const toClip = document.clips.find((clip) => clip.id === transition.toClipId);
  if (!fromClip || !toClip) {
    issues.push(issue("CLIP_NOT_FOUND", "La transición apunta a un clip que ya no existe."));
    return { available: false, issues, maximumDurationSeconds: 0, window: null };
  }
  if (fromClip.kind === "AUDIO" || toClip.kind === "AUDIO") {
    issues.push(issue("VISUAL_CLIP_REQUIRED", "Las transiciones V1 solo pueden unir dos clips visuales."));
  }
  if (fromClip.hidden || toClip.hidden) {
    issues.push(issue("CLIP_HIDDEN", "Muestra ambos clips antes de crear la transición."));
  }

  const fromTrack = document.tracks.find((track) => track.id === fromClip.trackId);
  const toTrack = document.tracks.find((track) => track.id === toClip.trackId);
  if (!fromTrack || !toTrack || fromClip.trackId !== toClip.trackId) {
    issues.push(issue("TRACK_MISMATCH", "Los dos clips deben pertenecer a la misma pista visual."));
  }
  if (fromTrack?.hidden || toTrack?.hidden) {
    issues.push(issue("TRACK_HIDDEN", "Muestra la pista antes de crear la transición."));
  }
  if (fromTrack?.locked || toTrack?.locked) {
    issues.push(issue("TRACK_LOCKED", "Desbloquea la pista antes de editar la transición."));
  }
  if (fromClip.layout.zIndex !== toClip.layout.zIndex) {
    issues.push(issue("LAYOUT_DEPTH_MISMATCH", "Los clips deben compartir la misma profundidad visual."));
  }
  if (
    transition.audioMode === "CROSSFADE"
    && (
      !compositionClipHasConfigurableAudio(fromClip, fromTrack)
      || !compositionClipHasConfigurableAudio(toClip, toTrack)
    )
  ) {
    issues.push(issue(
      "AUDIO_CROSSFADE_UNAVAILABLE",
      "El crossfade de audio requiere que ambos videos tengan audio confirmado.",
    ));
  }

  const frameSeconds = 1 / document.canvas.fps;
  const fromEndSeconds = fromClip.startSeconds + fromClip.durationSeconds;
  const adjacencyDelta = Math.abs(fromEndSeconds - toClip.startSeconds);
  if (adjacencyDelta > frameSeconds + TRANSITION_EPSILON_SECONDS) {
    issues.push(issue("ADJACENCY_REQUIRED", "El final del primer clip debe coincidir con el inicio del segundo."));
  }
  const cutSeconds = roundSeconds((fromEndSeconds + toClip.startSeconds) / 2);

  const fromHandles = resolveClipMediaHandles(fromClip);
  const toHandles = resolveClipMediaHandles(toClip);
  if (fromHandles.requiresSourceDuration || toHandles.requiresSourceDuration) {
    issues.push(issue("SOURCE_DURATION_REQUIRED", "Verifica la duración original de ambos videos antes de crear la transición."));
  }

  const handleLimit = resolveHandleDurationLimit(
    transition.alignment,
    fromHandles.tailSeconds,
    toHandles.headSeconds,
  );
  const canvasLimit = resolveCanvasDurationLimit(
    transition.alignment,
    cutSeconds,
    document.canvas.durationSeconds,
  );
  const maximumDurationSeconds = quantizeDurationDown(Math.max(0, Math.min(
    COMPOSITION_TRANSITION_MAX_DURATION_SECONDS,
    fromClip.durationSeconds,
    toClip.durationSeconds,
    Math.min(fromClip.durationSeconds, toClip.durationSeconds) * 0.25,
    handleLimit,
    canvasLimit,
  )), document.canvas.fps);

  const window = resolveCompositionTransitionWindow({
    alignment: transition.alignment,
    cutSeconds,
    durationSeconds: transition.durationSeconds,
    incomingHeadHandleSeconds: toHandles.headSeconds,
    outgoingTailHandleSeconds: fromHandles.tailSeconds,
  });

  if (maximumDurationSeconds < frameSeconds - TRANSITION_EPSILON_SECONDS) {
    issues.push(issue("INSUFFICIENT_MEDIA_HANDLES", "No hay al menos un frame de handles disponible para esta alineación."));
  } else if (transition.durationSeconds > maximumDurationSeconds + TRANSITION_EPSILON_SECONDS) {
    issues.push(issue(
      "DURATION_EXCEEDS_AVAILABLE",
      `La transición puede durar como máximo ${maximumDurationSeconds.toFixed(3)} s con los handles actuales.`,
    ));
  }
  if (!isFrameAligned(transition.durationSeconds, document.canvas.fps)) {
    issues.push(issue("DURATION_NOT_FRAME_ALIGNED", "La duración de la transición debe coincidir con frames completos."));
  }
  if (
    window.startSeconds < -TRANSITION_EPSILON_SECONDS
    || window.endSeconds > document.canvas.durationSeconds + TRANSITION_EPSILON_SECONDS
  ) {
    issues.push(issue("WINDOW_OUTSIDE_CANVAS", "La ventana de transición queda fuera de la composición."));
  }

  const duplicate = document.transitions?.items.find((candidate) => (
    candidate.id !== (params.excludeTransitionId || transition.id)
    && candidate.fromClipId === transition.fromClipId
    && candidate.toClipId === transition.toClipId
  ));
  if (duplicate) {
    issues.push(issue("DUPLICATE_EDIT_POINT", "Ya existe una transición en este punto de edición."));
  }

  if (hasThirdClipConflict(document, transition, window)) {
    issues.push(issue("THIRD_CLIP_CONFLICT", "Otro clip de la misma capa ocupa la ventana de transición."));
  }
  if (hasEdgeAnimationConflict(document, transition, window)) {
    issues.push(issue("ANIMATION_CONFLICT", "Una animación de entrada o salida compite con la transición en el mismo borde."));
  }

  return {
    available: issues.length === 0,
    issues,
    maximumDurationSeconds,
    window,
  };
}

export function assertCompositionTransitionsValid(document: CompositionEditorDocument) {
  for (const transition of document.transitions?.items || []) {
    const eligibility = resolveCompositionTransitionEligibility({
      document,
      excludeTransitionId: transition.id,
      transition,
    });
    if (!eligibility.available) {
      throw new Error(eligibility.issues[0]?.message || "La transición no es válida.");
    }
  }
}

export function resolveCompositionTransitionWindow(params: {
  alignment: CompositionTransitionAlignment;
  cutSeconds: number;
  durationSeconds: number;
  incomingHeadHandleSeconds: number;
  outgoingTailHandleSeconds: number;
}): CompositionTransitionWindow {
  const beforeSeconds = params.alignment === "CENTER_AT_CUT"
    ? params.durationSeconds / 2
    : params.alignment === "END_AT_CUT" ? params.durationSeconds : 0;
  const afterSeconds = params.durationSeconds - beforeSeconds;
  return {
    cutSeconds: params.cutSeconds,
    endSeconds: roundSeconds(params.cutSeconds + afterSeconds),
    incomingHeadHandleSeconds: params.incomingHeadHandleSeconds,
    outgoingTailHandleSeconds: params.outgoingTailHandleSeconds,
    requiredIncomingHeadSeconds: roundSeconds(beforeSeconds),
    requiredOutgoingTailSeconds: roundSeconds(afterSeconds),
    startSeconds: roundSeconds(params.cutSeconds - beforeSeconds),
  };
}

export function removeTransitionsConnectedToClips(
  transitions: CompositionEditorDocument["transitions"],
  clipIds: ReadonlySet<string>,
) {
  if (!transitions) return;
  transitions.items = transitions.items.filter((transition) => (
    !clipIds.has(transition.fromClipId) && !clipIds.has(transition.toClipId)
  ));
}

export function transferOutgoingTransitionsToDerivedClip(
  transitions: CompositionEditorDocument["transitions"],
  sourceClipId: string,
  derivedClipId: string,
) {
  if (!transitions) return;
  for (const transition of transitions.items) {
    if (transition.fromClipId === sourceClipId) transition.fromClipId = derivedClipId;
  }
}

function resolveClipMediaHandles(clip: CompositionClip) {
  if (clip.kind !== "VIDEO") {
    return { headSeconds: Number.POSITIVE_INFINITY, requiresSourceDuration: false, tailSeconds: Number.POSITIVE_INFINITY };
  }
  if (!clip.sourceDurationSeconds) {
    return { headSeconds: 0, requiresSourceDuration: true, tailSeconds: 0 };
  }
  const sourceOffsetSeconds = clip.sourceOffsetSeconds || 0;
  return {
    headSeconds: Math.max(0, sourceOffsetSeconds),
    requiresSourceDuration: false,
    tailSeconds: Math.max(0, clip.sourceDurationSeconds - sourceOffsetSeconds - clip.durationSeconds),
  };
}

function resolveHandleDurationLimit(
  alignment: CompositionTransitionAlignment,
  outgoingTailSeconds: number,
  incomingHeadSeconds: number,
) {
  if (alignment === "START_AT_CUT") return outgoingTailSeconds;
  if (alignment === "END_AT_CUT") return incomingHeadSeconds;
  return Math.min(outgoingTailSeconds, incomingHeadSeconds) * 2;
}

function resolveCanvasDurationLimit(
  alignment: CompositionTransitionAlignment,
  cutSeconds: number,
  canvasDurationSeconds: number,
) {
  if (alignment === "START_AT_CUT") return canvasDurationSeconds - cutSeconds;
  if (alignment === "END_AT_CUT") return cutSeconds;
  return Math.min(cutSeconds, canvasDurationSeconds - cutSeconds) * 2;
}

function hasThirdClipConflict(
  document: CompositionEditorDocument,
  transition: CompositionTransition,
  window: Pick<CompositionTransitionWindow, "endSeconds" | "startSeconds">,
) {
  const fromClip = document.clips.find((clip) => clip.id === transition.fromClipId)!;
  return document.clips.some((clip) => (
    clip.id !== transition.fromClipId
    && clip.id !== transition.toClipId
    && clip.kind !== "AUDIO"
    && !clip.hidden
    && clip.trackId === fromClip.trackId
    && clip.layout.zIndex === fromClip.layout.zIndex
    && clip.startSeconds < window.endSeconds - TRANSITION_EPSILON_SECONDS
    && clip.startSeconds + clip.durationSeconds > window.startSeconds + TRANSITION_EPSILON_SECONDS
  ));
}

function hasEdgeAnimationConflict(
  document: CompositionEditorDocument,
  transition: CompositionTransition,
  window: Pick<CompositionTransitionWindow, "endSeconds" | "startSeconds">,
) {
  const fromClip = document.clips.find((clip) => clip.id === transition.fromClipId)!;
  const toClip = document.clips.find((clip) => clip.id === transition.toClipId)!;
  return document.motion.animations.some((animation) => {
    if (animation.target.clipId !== fromClip.id && animation.target.clipId !== toClip.id) return false;
    const clip = animation.target.clipId === fromClip.id ? fromClip : toClip;
    const relative = resolveCompositionAnimationWindow(animation, clip.durationSeconds);
    const absoluteStart = clip.startSeconds + relative.start;
    const absoluteEnd = clip.startSeconds + relative.end;
    if (animation.target.clipId === fromClip.id && animation.timing.anchor === "CLIP_END") {
      return absoluteEnd > window.startSeconds + TRANSITION_EPSILON_SECONDS;
    }
    if (animation.target.clipId === toClip.id && animation.timing.anchor === "CLIP_START") {
      return absoluteStart < window.endSeconds - TRANSITION_EPSILON_SECONDS;
    }
    return false;
  });
}

function quantizeDurationDown(value: number, fps: number) {
  if (!Number.isFinite(value)) return COMPOSITION_TRANSITION_MAX_DURATION_SECONDS;
  return roundSeconds(Math.floor((value + TRANSITION_EPSILON_SECONDS) * fps) / fps);
}

function isFrameAligned(value: number, fps: number) {
  return Math.abs(value * fps - Math.round(value * fps)) <= TRANSITION_EPSILON_SECONDS;
}

function issue(code: CompositionTransitionIssueCode, message: string): CompositionTransitionIssue {
  return { code, message };
}

function roundSeconds(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
