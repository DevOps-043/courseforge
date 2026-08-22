"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { CompositionClip } from "@/domains/production/composition-editor/composition-document.types";
import {
  getCompositionMotionPhase,
  getCompositionMotionPresetDefinition,
} from "@/domains/production/composition-editor/composition-motion-preset.service";
import {
  buildCompositionAnimationTimelineEdit,
  buildCompositionAnimationTimelineSnapEdit,
  findCompositionAnimationTimingConflict,
  resolveCompositionAnimationWindow,
  type CompositionAnimationTimelineEditKind,
  type CompositionAnimationTimelineSnapEdit,
} from "@/domains/production/composition-editor/composition-motion-scheduling.service";
import type { CompositionAnimation } from "@/domains/production/composition-editor/composition-motion.types";

const BAND_DRAG_THRESHOLD_PX = 3;
const BAND_PLAYHEAD_SNAP_DISTANCE_PX = 10;

type AnimationTimelineBandProps = {
  animation: CompositionAnimation;
  animations: CompositionAnimation[];
  clip: CompositionClip;
  clips: CompositionClip[];
  compositionDurationSeconds: number;
  currentTime: number;
  disabled: boolean;
  fps: number;
  onCommit: (animation: CompositionAnimation, timing: CompositionAnimation["timing"]) => void;
  onError: (message: string | null) => void;
  onSeek: (seconds: number) => void;
  onSelect: (animationId: string, clipHfId: string) => void;
  selected: boolean;
  snapEnabled: boolean;
};

type BandGesture = {
  kind: CompositionAnimationTimelineEditKind;
  pointerStartX: number;
};

export function AnimationTimelineBand({
  animation,
  animations,
  clip,
  clips,
  compositionDurationSeconds,
  currentTime,
  disabled,
  fps,
  onCommit,
  onError,
  onSeek,
  onSelect,
  selected,
  snapEnabled,
}: AnimationTimelineBandProps) {
  const bandRef = useRef<HTMLDivElement>(null);
  const didDragRef = useRef(false);
  const [gesture, setGesture] = useState<BandGesture | null>(null);
  const [draftTiming, setDraftTiming] = useState(animation.timing);
  const [conflictingAnimationId, setConflictingAnimationId] = useState<string | null>(null);
  const [snapMatch, setSnapMatch] = useState<CompositionAnimationTimelineSnapEdit["snapMatch"]>(null);
  const draftTimingRef = useRef(animation.timing);
  const conflictingAnimationIdRef = useRef<string | null>(null);
  const definition = animation.preset
    ? getCompositionMotionPresetDefinition(animation.preset.id)
    : null;
  const phase = getCompositionMotionPhase(animation);
  const maximumDurationSeconds = Math.min(
    definition?.maxDurationSeconds ?? clip.durationSeconds,
    clip.durationSeconds,
  );
  const window = resolveCompositionAnimationWindow({ timing: draftTiming }, clip.durationSeconds);

  useEffect(() => {
    if (gesture) return;
    setDraftTiming(animation.timing);
    setConflictingAnimationId(null);
    setSnapMatch(null);
    draftTimingRef.current = animation.timing;
    conflictingAnimationIdRef.current = null;
  }, [animation.timing, gesture]);

  const beginGesture = (
    event: PointerEvent<HTMLElement>,
    kind: CompositionAnimationTimelineEditKind,
  ) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    bandRef.current?.setPointerCapture?.(event.pointerId);
    didDragRef.current = false;
    onError(null);
    onSelect(animation.id, clip.hfId);
    setGesture({ kind, pointerStartX: event.clientX });
  };

  const updateGesture = (event: PointerEvent<HTMLDivElement>) => {
    if (!gesture) return;
    event.preventDefault();
    event.stopPropagation();
    const laneWidth = Math.max(event.currentTarget.parentElement?.getBoundingClientRect().width || 0, 1);
    const deltaSeconds = ((event.clientX - gesture.pointerStartX) / laneWidth)
      * compositionDurationSeconds;
    if (Math.abs(event.clientX - gesture.pointerStartX) >= BAND_DRAG_THRESHOLD_PX) {
      didDragRef.current = true;
    }
    const snapEdit = buildCompositionAnimationTimelineSnapEdit({
      animation,
      animations,
      clips,
      clipDurationSeconds: clip.durationSeconds,
      clipStartSeconds: clip.startSeconds,
      deltaSeconds,
      fps,
      kind: gesture.kind,
      maximumDurationSeconds,
      playheadSeconds: currentTime,
      snapEnabled,
      snapToleranceSeconds: (BAND_PLAYHEAD_SNAP_DISTANCE_PX / laneWidth)
        * compositionDurationSeconds,
    });
    const { timing } = snapEdit;
    const conflict = findCompositionAnimationTimingConflict({
      animationId: animation.id,
      animations,
      clipDurationSeconds: clip.durationSeconds,
      clipId: clip.id,
      propertyGroup: animation.propertyGroup,
      timing,
    });
    setDraftTiming(timing);
    setConflictingAnimationId(conflict?.id || null);
    setSnapMatch(snapEdit.snapMatch);
    draftTimingRef.current = timing;
    conflictingAnimationIdRef.current = conflict?.id || null;
    const nextWindow = resolveCompositionAnimationWindow({ timing }, clip.durationSeconds);
    onSeek(clip.startSeconds + nextWindow.start);
  };

  const finishGesture = (event: PointerEvent<HTMLDivElement>) => {
    if (!gesture) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setGesture(null);
    setSnapMatch(null);
    if (!didDragRef.current) return;
    if (conflictingAnimationIdRef.current) {
      setDraftTiming(animation.timing);
      setConflictingAnimationId(null);
      draftTimingRef.current = animation.timing;
      conflictingAnimationIdRef.current = null;
      onError("La banda volvió a su posición anterior porque se cruzaba con otra animación de la misma propiedad.");
      return;
    }
    if (timingsDiffer(animation.timing, draftTimingRef.current, fps)) {
      onCommit(animation, draftTimingRef.current);
    }
  };

  const cancelGesture = (event: PointerEvent<HTMLDivElement>) => {
    if (!gesture) return;
    event.preventDefault();
    event.stopPropagation();
    setGesture(null);
    setDraftTiming(animation.timing);
    setConflictingAnimationId(null);
    setSnapMatch(null);
    draftTimingRef.current = animation.timing;
    conflictingAnimationIdRef.current = null;
    onError(null);
  };

  const editFromKeyboard = (
    event: KeyboardEvent<HTMLDivElement>,
    kind: CompositionAnimationTimelineEditKind,
  ) => {
    if (disabled || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    event.stopPropagation();
    const timing = buildCompositionAnimationTimelineEdit({
      animation,
      clipDurationSeconds: clip.durationSeconds,
      deltaSeconds: (event.key === "ArrowLeft" ? -1 : 1) / fps,
      fps,
      kind,
      maximumDurationSeconds,
      snapEnabled: true,
    });
    const conflict = findCompositionAnimationTimingConflict({
      animationId: animation.id,
      animations,
      clipDurationSeconds: clip.durationSeconds,
      clipId: clip.id,
      propertyGroup: animation.propertyGroup,
      timing,
    });
    if (conflict) {
      onError("No se puede mover la banda sobre otra animación de la misma propiedad.");
      return;
    }
    onError(null);
    onSelect(animation.id, clip.hfId);
    onCommit(animation, timing);
  };

  const absoluteStart = clip.startSeconds + window.start;
  const label = definition?.label || animation.propertyGroup;
  const conflict = Boolean(conflictingAnimationId);
  return (
    <Fragment>
      {snapMatch && (
        <span
          aria-hidden="true"
          data-animation-snap-source={snapMatch.source}
          title={formatAnimationSnapLabel(snapMatch)}
          style={{ left: `${(snapMatch.timeSeconds / compositionDurationSeconds) * 100}%` }}
          className="pointer-events-none absolute inset-y-0 z-40 w-0.5 bg-amber-400 shadow-[0_0_9px_rgba(251,191,36,0.9)]"
        />
      )}
      <div
        ref={bandRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${motionPhaseLabel(phase)}: ${label}`}
        aria-valuemin={0}
        aria-valuemax={clip.durationSeconds}
        aria-valuenow={window.start}
        aria-valuetext={`${window.start.toFixed(2)} a ${window.end.toFixed(2)} segundos dentro del clip`}
        data-animation-id={animation.id}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSelect(animation.id, clip.hfId);
          onSeek(absoluteStart);
        }}
        onKeyDown={(event) => editFromKeyboard(
          event,
          event.shiftKey ? "RESIZE_END" : "MOVE",
        )}
        onPointerDown={(event) => beginGesture(event, "MOVE")}
        onPointerMove={updateGesture}
        onPointerUp={finishGesture}
        onPointerCancel={cancelGesture}
        title={`${motionPhaseLabel(phase)} · ${label} · arrastra para mover; Shift + flechas cambia la duración`}
        style={{
          left: `${(absoluteStart / compositionDurationSeconds) * 100}%`,
          width: `${Math.max(0.75, (window.duration / compositionDurationSeconds) * 100)}%`,
        }}
        className={`absolute bottom-0.5 z-30 h-2.5 min-w-3 touch-none rounded-full border outline-none transition-[box-shadow,border-color] ${phaseColor(phase)} ${selected ? "ring-2 ring-white ring-offset-1 ring-offset-slate-700" : ""} ${snapMatch ? "ring-2 ring-amber-400 ring-offset-1 ring-offset-slate-700" : ""} ${conflict ? "border-red-700 bg-red-400 ring-2 ring-red-300" : ""} ${disabled ? "cursor-not-allowed opacity-60" : "cursor-grab active:cursor-grabbing"}`}
      >
        <span
          aria-hidden="true"
          onPointerDown={(event) => beginGesture(event, "RESIZE_START")}
          className="absolute inset-y-[-2px] left-0 w-2 cursor-ew-resize rounded-l-full bg-black/25 hover:bg-white/50"
        />
        <span
          aria-hidden="true"
          onPointerDown={(event) => beginGesture(event, "RESIZE_END")}
          className="absolute inset-y-[-2px] right-0 w-2 cursor-ew-resize rounded-r-full bg-black/25 hover:bg-white/50"
        />
      </div>
    </Fragment>
  );
}

function timingsDiffer(
  previous: CompositionAnimation["timing"],
  next: CompositionAnimation["timing"],
  fps: number,
) {
  const tolerance = 0.5 / fps;
  return previous.anchor !== next.anchor
    || Math.abs(previous.durationSeconds - next.durationSeconds) >= tolerance
    || Math.abs(previous.offsetSeconds - next.offsetSeconds) >= tolerance;
}

function phaseColor(phase: ReturnType<typeof getCompositionMotionPhase>) {
  if (phase === "ENTRY") return "border-emerald-700 bg-emerald-400";
  if (phase === "PLAYBACK") return "border-sky-700 bg-sky-400";
  return "border-orange-700 bg-orange-400";
}

function motionPhaseLabel(phase: ReturnType<typeof getCompositionMotionPhase>) {
  return phase === "ENTRY" ? "Entrada" : phase === "PLAYBACK" ? "Durante" : "Salida";
}

function formatAnimationSnapLabel(match: NonNullable<CompositionAnimationTimelineSnapEdit["snapMatch"]>) {
  if (match.source === "PLAYHEAD") return "Snap al cursor";
  if (match.source === "CLIP_START") return `Snap al inicio de ${match.clipLabel || "un asset"}`;
  if (match.source === "CLIP_END") return `Snap al final de ${match.clipLabel || "un asset"}`;
  const boundary = match.source === "ANIMATION_START" ? "inicio" : "final";
  return `Snap al ${boundary} de ${match.animationLabel || "otra animación"}`;
}
