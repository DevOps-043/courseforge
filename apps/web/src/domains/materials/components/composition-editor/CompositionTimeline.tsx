"use client";

import { stepCompositionFrame } from "@/domains/production/composition-editor/composition-timecode";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
import { CheckSquare2, ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from "lucide-react";
import type { CompositionClip, CompositionEditorDocument, CompositionGroup } from "@/domains/production/composition-editor/composition-document.types";
import type { CompositionAnimation } from "@/domains/production/composition-editor/composition-motion.types";
import {
  COMPOSITION_GROUP_COLORS,
  resolveCompositionGroupColors,
} from "@/domains/production/composition-editor/composition-group-color.service";
import { resolveCompositionGroupBounds } from "@/domains/production/composition-editor/composition-group.service";
import { resolveCompositionTimelineSelectionSync } from "@/domains/production/composition-editor/composition-timeline-selection.service";
import { buildCompositionTimelineLayout } from "@/domains/production/composition-editor/composition-timeline-layout.service";
import {
  buildTimelineSnapTargets,
  resolveTimelineSnap,
  type TimelineSnapMatch,
} from "@/domains/production/composition-editor/composition-timeline-snap.service";
import {
  resolveCompositionTimelineTrimStartMinimum,
  resolveCompositionTimelineTrimStartSourceOffset,
} from "@/domains/production/composition-editor/composition-timeline-trim.service";
import { TrackControls } from "./TrackControls";
import { AnimationTimelineBand } from "./AnimationTimelineBand";
import type { CompositionTrackUpdateHandler } from "./composition-studio.types";

type TimelineGesture = {
  clip: CompositionClip;
  durationSeconds: number;
  groupId: string | null;
  groupStartSeconds: number | null;
  kind: "move" | "trim-end" | "trim-start";
  originalGroupStartSeconds: number | null;
  pointerStartX: number;
  snapMatch: TimelineSnapMatch | null;
  sourceOffsetSeconds: number;
  startSeconds: number;
};

const PLAYHEAD_SNAP_DISTANCE_PX = 10;
const MIN_TIMELINE_ZOOM = 1;
const MAX_TIMELINE_ZOOM = 8;
const TIMELINE_ZOOM_STEP = 0.5;

interface CompositionTimelineProps {
  assetLabels: Record<string, string>;
  currentTime: number;
  document: CompositionEditorDocument;
  editingGroupId: string | null;
  onClearSelection: () => void;
  onDurationChange: (clip: CompositionClip, durationSeconds: number) => void;
  onAnimationSelect: (animationId: string, clipHfId: string) => void;
  onAnimationTimingChange: (animation: CompositionAnimation, timing: CompositionAnimation["timing"]) => void;
  onEditingGroupChange: (groupId: string | null) => void;
  onInspectSelection: () => void;
  onMove: (clip: CompositionClip, startSeconds: number) => void;
  onMoveGroup: (groupId: string, startSeconds: number) => void;
  onSeek: (seconds: number) => void;
  onSelect: (hfId: string) => void;
  onSelectedClipIdsChange: (clipIds: Set<string>) => void;
  onSelectedGroupChange: (groupId: string | null) => void;
  onTrackUpdate: CompositionTrackUpdateHandler;
  onTransitionSelect: (transitionId: string | null) => void;
  onTrim: (clip: CompositionClip, startSeconds: number, durationSeconds: number, sourceOffsetSeconds: number) => void;
  saving: boolean;
  selectedAnimationId: string | null;
  selectedClipIds: ReadonlySet<string>;
  selectedGroupId: string | null;
  selectedHfId: string | null;
  selectedTransitionId: string | null;
  snapEnabled?: boolean;
  trimMode?: boolean;
}

export function CompositionTimeline({ assetLabels, currentTime, document, editingGroupId, onAnimationSelect, onAnimationTimingChange, onClearSelection, onDurationChange, onEditingGroupChange, onInspectSelection, onMove, onMoveGroup, onSeek, onSelect, onSelectedClipIdsChange, onSelectedGroupChange, onTrackUpdate, onTransitionSelect, onTrim, saving, selectedAnimationId, selectedClipIds, selectedGroupId, selectedHfId, selectedTransitionId, snapEnabled = true, trimMode = false }: CompositionTimelineProps) {
  const [gesture, setGesture] = useState<TimelineGesture | null>(null);
  const [motionEditError, setMotionEditError] = useState<string | null>(null);
  const [multiSelectEnabled, setMultiSelectEnabled] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(MIN_TIMELINE_ZOOM);
  const [timelineScroll, setTimelineScroll] = useState(0);
  const [timelineScrollMax, setTimelineScrollMax] = useState(0);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(() => new Set());
  const didDragRef = useRef(false);
  const timelineViewportRef = useRef<HTMLDivElement>(null);
  const timelineLayout = useMemo(() => buildCompositionTimelineLayout(document), [document]);
  const groups = timelineLayout.groups;
  const logicalGroups = useMemo(() => document.groups || [], [document.groups]);
  const groupColorsById = useMemo(() => resolveCompositionGroupColors(document), [document]);
  const logicalGroupsByClipId = useMemo(() => new Map(logicalGroups.flatMap((group) => (
    group.clipIds.map((clipId) => [clipId, group] as const)
  ))), [logicalGroups]);
  const editingGroup = logicalGroups.find((group) => group.id === editingGroupId) || null;
  const maxDuration = document.canvas.durationSeconds;
  const fps = document.canvas.fps;
  const ruler = useMemo(() => buildTimelineRuler(maxDuration, timelineZoom), [maxDuration, timelineZoom]);
  const snappedToPlayhead = gesture?.snapMatch?.source === "PLAYHEAD";
  const clipSnapMatch = gesture?.snapMatch?.source === "CLIP_START" || gesture?.snapMatch?.source === "CLIP_END"
    ? gesture.snapMatch
    : null;

  useEffect(() => {
    const availableClipIds = new Set(document.clips.map((clip) => clip.id));
    const availableSelection = new Set([...selectedClipIds].filter((clipId) => availableClipIds.has(clipId)));
    if (availableSelection.size !== selectedClipIds.size) onSelectedClipIdsChange(availableSelection);
    if (selectedGroupId && !logicalGroups.some((group) => group.id === selectedGroupId)) onSelectedGroupChange(null);
    if (editingGroupId && !logicalGroups.some((group) => group.id === editingGroupId)) onEditingGroupChange(null);
  }, [document.clips, editingGroupId, logicalGroups, onEditingGroupChange, onSelectedClipIdsChange, onSelectedGroupChange, selectedClipIds, selectedGroupId]);

  useEffect(() => {
    if (editingGroupId || selectedGroupId || selectedClipIds.size < 2) return;
    const exactGroup = logicalGroups.find((group) => (
      group.clipIds.length === selectedClipIds.size
      && group.clipIds.every((clipId) => selectedClipIds.has(clipId))
    ));
    if (exactGroup) onSelectedGroupChange(exactGroup.id);
  }, [editingGroupId, logicalGroups, onSelectedGroupChange, selectedClipIds, selectedGroupId]);

  useEffect(() => {
    const decision = resolveCompositionTimelineSelectionSync({
      clips: document.clips,
      selectedClipIds,
      selectedGroupId,
      selectedHfId,
    });
    if (decision.nextClipIds !== null) onSelectedClipIdsChange(new Set(decision.nextClipIds));
    if (decision.shouldClearGroup) onSelectedGroupChange(null);
  }, [document.clips, onSelectedClipIdsChange, onSelectedGroupChange, selectedClipIds, selectedGroupId, selectedHfId]);

  const selectLogicalGroup = (group: CompositionGroup, preferredHfId?: string) => {
    onSelectedGroupChange(group.id);
    onSelectedClipIdsChange(new Set(group.clipIds));
    const preferredClip = preferredHfId
      ? document.clips.find((clip) => clip.hfId === preferredHfId)
      : null;
    const representative = preferredClip || document.clips.find((clip) => group.clipIds.includes(clip.id));
    if (representative) onSelect(representative.hfId);
    onInspectSelection();
  };

  const selectTimelineClip = (clip: CompositionClip, event?: Pick<MouseEvent<HTMLElement>, "ctrlKey" | "metaKey" | "shiftKey">) => {
    const group = logicalGroupsByClipId.get(clip.id);
    if (group && editingGroupId !== group.id) {
      selectLogicalGroup(group, clip.hfId);
      return;
    }
    onSelectedGroupChange(null);
    if (multiSelectEnabled || event?.ctrlKey || event?.metaKey || event?.shiftKey) {
      const next = new Set(selectedClipIds);
      if (next.has(clip.id)) next.delete(clip.id);
      else next.add(clip.id);
      onSelectedClipIdsChange(next);
      const representative = document.clips.find((candidate) => next.has(candidate.id));
      if (next.has(clip.id)) onSelect(clip.hfId);
      else if (representative) onSelect(representative.hfId);
      else onClearSelection();
      if (next.size > 0) onInspectSelection();
    } else {
      onSelectedClipIdsChange(new Set([clip.id]));
      onSelect(clip.hfId);
    }
  };

  const clearTimelineSelection = () => {
    onSelectedClipIdsChange(new Set());
    onSelectedGroupChange(null);
    onClearSelection();
  };

  const enterSelectedGroup = (group: CompositionGroup, preferredClip?: CompositionClip) => {
    onEditingGroupChange(group.id);
    onSelectedGroupChange(null);
    const clip = preferredClip || document.clips.find((candidate) => group.clipIds.includes(candidate.id));
    if (!clip) return;
    onSelectedClipIdsChange(new Set([clip.id]));
    onSelect(clip.hfId);
  };

  const beginGesture = (event: PointerEvent<HTMLElement>, clip: CompositionClip, kind: TimelineGesture["kind"]) => {
    if (
      saving
      || document.tracks.find((track) => track.id === clip.trackId)?.locked
      || (editingGroup && !editingGroup.clipIds.includes(clip.id))
    ) return;
    event.preventDefault();
    event.stopPropagation();
    const captureTarget = kind === "move" ? event.currentTarget : event.currentTarget.parentElement;
    captureTarget?.setPointerCapture?.(event.pointerId);
    didDragRef.current = false;
    const logicalGroup = logicalGroupsByClipId.get(clip.id);
    const movesLogicalGroup = kind === "move" && logicalGroup && editingGroupId !== logicalGroup.id;
    const groupBounds = movesLogicalGroup
      ? resolveCompositionGroupBounds(document, logicalGroup.id)
      : null;
    if (movesLogicalGroup) selectLogicalGroup(logicalGroup, clip.hfId);
    else if (!event.ctrlKey && !event.metaKey && !event.shiftKey) selectTimelineClip(clip);
    setGesture({
      clip,
      durationSeconds: clip.durationSeconds,
      groupId: movesLogicalGroup ? logicalGroup.id : null,
      groupStartSeconds: groupBounds?.startSeconds ?? null,
      kind,
      originalGroupStartSeconds: groupBounds?.startSeconds ?? null,
      pointerStartX: event.clientX,
      snapMatch: null,
      sourceOffsetSeconds: clip.sourceOffsetSeconds || 0,
      startSeconds: clip.startSeconds,
    });
  };

  const updateGesture = (event: PointerEvent<HTMLButtonElement>) => {
    if (!gesture || gesture.clip.id !== event.currentTarget.dataset.clipId) return;
    const lane = event.currentTarget.parentElement;
    if (!lane) return;
    const laneWidth = Math.max(lane.getBoundingClientRect().width, 1);
    const deltaSeconds = ((event.clientX - gesture.pointerStartX) / laneWidth) * maxDuration;
    const playheadSnapTolerance = snapEnabled
      ? (PLAYHEAD_SNAP_DISTANCE_PX / laneWidth) * maxDuration
      : -1;
    const snapTargets = buildTimelineSnapTargets({
      clips: document.clips.filter((candidate) => (
        !document.tracks.find((track) => track.id === candidate.trackId)?.hidden
        && (!gesture.groupId || !document.groups?.find((group) => group.id === gesture.groupId)?.clipIds.includes(candidate.id))
      )),
      excludedClipId: gesture.clip.id,
      playheadSeconds: currentTime,
    });
    if (Math.abs(event.clientX - gesture.pointerStartX) >= 3) didDragRef.current = true;

    if (gesture.kind === "move") {
      if (gesture.groupId && gesture.originalGroupStartSeconds !== null) {
        const groupBounds = resolveCompositionGroupBounds(document, gesture.groupId);
        if (!groupBounds) return;
        const unclampedGroupStartSeconds = Math.max(
          0,
          Math.min(maxDuration - groupBounds.durationSeconds, gesture.originalGroupStartSeconds + deltaSeconds),
        );
        const snap = resolveTimelineSnap({
          anchors: [
            { edge: "START", timeSeconds: unclampedGroupStartSeconds },
            { edge: "END", timeSeconds: unclampedGroupStartSeconds + groupBounds.durationSeconds },
          ],
          isValidDelta: (snapDelta) => {
            const nextStart = unclampedGroupStartSeconds + snapDelta;
            return nextStart >= 0 && nextStart <= maxDuration - groupBounds.durationSeconds;
          },
          targets: snapTargets,
          toleranceSeconds: playheadSnapTolerance,
        });
        const snappedGroupStartSeconds = unclampedGroupStartSeconds + snap.deltaSeconds;
        const groupStartSeconds = snap.match
          ? snappedGroupStartSeconds
          : quantizeTimelineSeconds(snappedGroupStartSeconds, snapEnabled, fps);
        const groupDeltaSeconds = groupStartSeconds - gesture.originalGroupStartSeconds;
        setGesture((current) => current ? {
          ...current,
          groupStartSeconds,
          snapMatch: snap.match,
          startSeconds: current.clip.startSeconds + groupDeltaSeconds,
        } : current);
        return;
      }
      const unclampedStartSeconds = Math.max(0, Math.min(maxDuration - gesture.clip.durationSeconds, gesture.clip.startSeconds + deltaSeconds));
      const snap = resolveTimelineSnap({
        anchors: [
          { edge: "START", timeSeconds: unclampedStartSeconds },
          { edge: "END", timeSeconds: unclampedStartSeconds + gesture.clip.durationSeconds },
        ],
        isValidDelta: (snapDelta) => {
          const nextStart = unclampedStartSeconds + snapDelta;
          return nextStart >= 0 && nextStart <= maxDuration - gesture.clip.durationSeconds;
        },
        targets: snapTargets,
        toleranceSeconds: playheadSnapTolerance,
      });
      const snappedStartSeconds = unclampedStartSeconds + snap.deltaSeconds;
      const startSeconds = snap.match
        ? snappedStartSeconds
        : quantizeTimelineSeconds(snappedStartSeconds, snapEnabled, fps);
      setGesture((current) => current ? { ...current, snapMatch: snap.match, startSeconds } : current);
      return;
    }
    if (gesture.kind === "trim-end") {
      const sourceLimit = gesture.clip.kind === "VIDEO" || gesture.clip.sourceDurationSeconds === undefined
        ? maxDuration
        : gesture.clip.sourceDurationSeconds - (gesture.clip.sourceOffsetSeconds || 0);
      const unclampedDurationSeconds = Math.max(1 / fps, Math.min(
        maxDuration - gesture.clip.startSeconds,
        sourceLimit,
        gesture.clip.durationSeconds + deltaSeconds,
      ));
      const unclampedEndSeconds = gesture.clip.startSeconds + unclampedDurationSeconds;
      const maximumEndSeconds = gesture.clip.startSeconds + Math.min(maxDuration - gesture.clip.startSeconds, sourceLimit);
      const snap = resolveTimelineSnap({
        anchors: [{ edge: "END", timeSeconds: unclampedEndSeconds }],
        isValidDelta: (snapDelta) => {
          const nextEnd = unclampedEndSeconds + snapDelta;
          return nextEnd >= gesture.clip.startSeconds + (1 / fps) && nextEnd <= maximumEndSeconds;
        },
        targets: snapTargets,
        toleranceSeconds: playheadSnapTolerance,
      });
      const snappedDurationSeconds = unclampedDurationSeconds + snap.deltaSeconds;
      const durationSeconds = snap.match
        ? snappedDurationSeconds
        : quantizeTimelineSeconds(snappedDurationSeconds, snapEnabled, fps);
      setGesture((current) => current ? { ...current, durationSeconds, snapMatch: snap.match } : current);
      return;
    }

    const originalEnd = gesture.clip.startSeconds + gesture.clip.durationSeconds;
    const earliestStart = resolveCompositionTimelineTrimStartMinimum(gesture.clip);
    const unclampedStartSeconds = Math.max(earliestStart, Math.min(originalEnd - (1 / fps), gesture.clip.startSeconds + deltaSeconds));
    const snap = resolveTimelineSnap({
      anchors: [{ edge: "START", timeSeconds: unclampedStartSeconds }],
      isValidDelta: (snapDelta) => {
        const nextStart = unclampedStartSeconds + snapDelta;
        return nextStart >= earliestStart && nextStart <= originalEnd - (1 / fps);
      },
      targets: snapTargets,
      toleranceSeconds: playheadSnapTolerance,
    });
    const snappedStartSeconds = unclampedStartSeconds + snap.deltaSeconds;
    const startSeconds = snap.match
      ? snappedStartSeconds
      : quantizeTimelineSeconds(snappedStartSeconds, snapEnabled, fps);
    const durationSeconds = snap.match
      ? originalEnd - startSeconds
      : quantizeTimelineSeconds(originalEnd - startSeconds, snapEnabled, fps);
    const sourceOffsetSeconds = resolveCompositionTimelineTrimStartSourceOffset(
      gesture.clip,
      startSeconds,
    );
    setGesture((current) => current ? {
      ...current,
      durationSeconds,
      snapMatch: snap.match,
      sourceOffsetSeconds: Math.max(0, snap.match ? sourceOffsetSeconds : quantizeTimelineSeconds(sourceOffsetSeconds, snapEnabled, fps)),
      startSeconds,
    } : current);
  };

  const finishGesture = (event: PointerEvent<HTMLButtonElement>) => {
    if (!gesture || gesture.clip.id !== event.currentTarget.dataset.clipId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const current = gesture;
    setGesture(null);
    if (!didDragRef.current) return;
    const frameDuration = 1 / fps;
    if (
      current.kind === "move"
      && current.groupId
      && current.groupStartSeconds !== null
      && current.originalGroupStartSeconds !== null
      && Math.abs(current.groupStartSeconds - current.originalGroupStartSeconds) >= frameDuration / 2
    ) {
      onMoveGroup(current.groupId, current.groupStartSeconds);
    } else if (current.kind === "move" && Math.abs(current.startSeconds - current.clip.startSeconds) >= frameDuration / 2) {
      onMove(current.clip, current.startSeconds);
    } else if (current.kind === "trim-end" && Math.abs(current.durationSeconds - current.clip.durationSeconds) >= frameDuration / 2) {
      onDurationChange(current.clip, current.durationSeconds);
    } else if (current.kind === "trim-start") {
      onTrim(current.clip, current.startSeconds, current.durationSeconds, current.sourceOffsetSeconds);
    }
  };

  const seekFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - box.left) / Math.max(box.width, 1)));
    onSeek(quantizeTimelineSeconds(ratio * maxDuration, true, fps));
  };
  const beginScrub = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setScrubbing(true);
    seekFromPointer(event);
  };
  const continueScrub = (event: PointerEvent<HTMLDivElement>) => {
    if (scrubbing) seekFromPointer(event);
  };
  const endScrub = () => setScrubbing(false);

  const changeTimelineZoom = (nextZoom: number) => {
    setTimelineZoom(Math.max(MIN_TIMELINE_ZOOM, Math.min(MAX_TIMELINE_ZOOM, nextZoom)));
  };
  const syncTimelineScroll = () => {
    const viewport = timelineViewportRef.current;
    if (!viewport) return;
    const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    setTimelineScrollMax(maximum);
    setTimelineScroll(Math.min(viewport.scrollLeft, maximum));
  };
  const moveTimelineScroll = (nextPosition: number) => {
    const viewport = timelineViewportRef.current;
    if (!viewport) return;
    viewport.scrollLeft = Math.max(0, Math.min(timelineScrollMax, nextPosition));
    syncTimelineScroll();
  };
  const nudgeTimelineScroll = (direction: -1 | 1) => {
    const viewport = timelineViewportRef.current;
    if (!viewport) return;
    moveTimelineScroll(viewport.scrollLeft + direction * Math.max(120, viewport.clientWidth * 0.6));
  };

  useEffect(() => {
    const viewport = timelineViewportRef.current;
    if (!viewport) return;
    const frame = window.requestAnimationFrame(syncTimelineScroll);
    const observer = new ResizeObserver(syncTimelineScroll);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [timelineZoom, groups.length]);

  const toggleGroupExpanded = (groupId: string) => {
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  return <div className="space-y-2 pb-2">
    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-gray-400">
      <span>Timeline</span>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span>{formatSeconds(currentTime)} · {document.clips.length} clips · mueve el bloque o recorta sus bordes</span>
        <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-0.5 normal-case tracking-normal dark:border-white/10 dark:bg-white/5">
          <button type="button" aria-label="Alejar timeline" title="Alejar timeline" disabled={timelineZoom <= MIN_TIMELINE_ZOOM} onClick={() => changeTimelineZoom(timelineZoom - TIMELINE_ZOOM_STEP)} className="rounded p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-white/10"><ZoomOut size={13} /></button>
          <input aria-label="Zoom del timeline" aria-valuetext={`${Math.round(timelineZoom * 100)}%`} type="range" min={MIN_TIMELINE_ZOOM} max={MAX_TIMELINE_ZOOM} step={TIMELINE_ZOOM_STEP} value={timelineZoom} onChange={(event) => changeTimelineZoom(Number(event.target.value))} className="w-20 accent-[var(--engine-accent)]" />
          <span className="w-10 text-center font-mono text-[10px] tabular-nums">{Math.round(timelineZoom * 100)}%</span>
          <button type="button" aria-label="Acercar timeline" title="Acercar timeline" disabled={timelineZoom >= MAX_TIMELINE_ZOOM} onClick={() => changeTimelineZoom(timelineZoom + TIMELINE_ZOOM_STEP)} className="rounded p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-white/10"><ZoomIn size={13} /></button>
        </div>
      </div>
    </div>
    <div role="toolbar" aria-label="Controles de selección múltiple" className="flex flex-wrap items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-2 py-1.5 text-[10px] text-violet-950 dark:border-violet-400/25 dark:bg-violet-400/10 dark:text-violet-100">
      <button type="button" aria-pressed={multiSelectEnabled} disabled={saving} onClick={() => setMultiSelectEnabled((current) => !current)} className={`inline-flex items-center gap-1 rounded border px-2 py-1 font-bold disabled:opacity-40 ${multiSelectEnabled ? "border-violet-600 bg-violet-600 text-white dark:border-violet-300 dark:bg-violet-300 dark:text-violet-950" : "border-violet-300 bg-white dark:border-violet-300/30 dark:bg-white/10"}`}><CheckSquare2 size={12} /> Selección múltiple</button>
      <span className="mr-auto font-semibold">También puedes usar Ctrl/Cmd o Shift + clic sobre los clips.</span>
      {selectedClipIds.size > 0 && <button type="button" disabled={saving} onClick={clearTimelineSelection} className="inline-flex items-center gap-1 rounded border border-violet-300 bg-white px-2 py-1 font-bold disabled:opacity-40 dark:border-violet-300/30 dark:bg-white/10"><X size={12} /> Limpiar</button>}
    </div>
    <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 dark:border-white/10 dark:bg-white/5">
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-gray-400">Desplazamiento</span>
      <button type="button" aria-label="Mover timeline a la izquierda" title="Mover timeline a la izquierda" disabled={timelineScroll <= 0} onClick={() => nudgeTimelineScroll(-1)} className="rounded p-1 text-slate-600 hover:bg-slate-200 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-white/10"><ChevronLeft size={14} /></button>
      <input aria-label="Desplazamiento horizontal del timeline" aria-valuetext={timelineScrollMax > 0 ? `${Math.round((timelineScroll / timelineScrollMax) * 100)}%` : "Inicio"} type="range" min="0" max={Math.max(1, timelineScrollMax)} step="1" value={timelineScrollMax > 0 ? timelineScroll : 0} disabled={timelineScrollMax <= 0} onChange={(event) => moveTimelineScroll(Number(event.target.value))} className="min-w-24 flex-1 accent-[var(--engine-accent)] disabled:opacity-40" />
      <button type="button" aria-label="Mover timeline a la derecha" title="Mover timeline a la derecha" disabled={timelineScroll >= timelineScrollMax} onClick={() => nudgeTimelineScroll(1)} className="rounded p-1 text-slate-600 hover:bg-slate-200 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-white/10"><ChevronRight size={14} /></button>
    </div>
    {motionEditError && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-200">{motionEditError}</div>}
    <div ref={timelineViewportRef} onScroll={syncTimelineScroll} className="overflow-x-auto pb-4">
      <div className="space-y-2" style={{ minWidth: `${timelineZoom * 100}%` }}>
    <div className="grid grid-cols-[160px_minmax(0,1fr)] items-end gap-2"><span className="sticky left-0 z-40 bg-white pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:bg-[#101720] dark:text-gray-400">Tiempo</span><div role="slider" aria-label="Cursor de la composición" aria-valuemax={maxDuration} aria-valuemin={0} aria-valuenow={currentTime} tabIndex={0} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); onSeek(stepCompositionFrame(currentTime, -1, fps, maxDuration, event.shiftKey)); } if (event.key === "ArrowRight") { event.preventDefault(); onSeek(stepCompositionFrame(currentTime, 1, fps, maxDuration, event.shiftKey)); } }} onPointerDown={beginScrub} onPointerMove={continueScrub} onPointerUp={endScrub} onPointerCancel={endScrub} className="relative h-8 cursor-ew-resize select-none overflow-hidden rounded-t-md border border-b-0 border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5">{ruler.minor.map((time) => <span key={`minor-${time}`} aria-hidden="true" style={{ left: `${(time / maxDuration) * 100}%` }} className="absolute bottom-0 h-2 w-px bg-slate-300 dark:bg-white/20" />)}{ruler.major.map((time) => <span key={`major-${time}`} aria-hidden="true" style={{ left: `${(time / maxDuration) * 100}%` }} className="absolute inset-y-0 w-px bg-slate-300 dark:bg-white/20"><span className="absolute left-1 top-1 whitespace-nowrap font-mono text-[9px] text-slate-500 dark:text-gray-400">{formatSeconds(time)}</span></span>)}{clipSnapMatch && <span aria-hidden="true" style={{ left: `${(clipSnapMatch.timeSeconds / maxDuration) * 100}%` }} className="absolute inset-y-0 z-30 w-0.5 bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.9)]"><span className="absolute left-1 top-0.5 whitespace-nowrap rounded bg-amber-100 px-1 py-0.5 text-[8px] font-bold normal-case tracking-normal text-amber-900 shadow-sm">{formatSnapLabel(clipSnapMatch)}</span></span>}<span aria-hidden="true" style={{ left: `${(currentTime / maxDuration) * 100}%` }} className={`absolute inset-y-0 z-30 w-0.5 ${snappedToPlayhead ? "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.9)]" : "bg-cyan-600 shadow-[0_0_7px_rgba(8,145,178,0.75)] dark:bg-cyan-300"} ${scrubbing ? "opacity-100" : "opacity-90"}`}><span className={`absolute -left-1.5 top-0 h-3 w-3 rotate-45 border ${snappedToPlayhead ? "border-amber-600 bg-amber-100" : "border-cyan-700 bg-cyan-100 dark:border-cyan-100 dark:bg-cyan-400"}`} /></span></div></div>
    {groups.map((group) => {
      const { track } = group;
      const expanded = expandedGroupIds.has(group.id);
      const lanes = expanded
        ? group.clips.map((clip) => [clip])
        : group.lanes.map((lane) => lane.clips);
      const displayLabel = group.kind === "VISUAL"
        ? `Capa ${group.zIndex} · ${track.label}`
        : `Audio · ${track.label}`;
      return <div key={group.id} className="grid snap-start grid-cols-[160px_minmax(0,1fr)] items-stretch gap-2">
        <div className="sticky left-0 z-40 self-stretch bg-white dark:bg-[#101720]">
          <TrackControls disabled={saving} displayLabel={displayLabel} expanded={expanded} track={track} onToggleExpanded={() => toggleGroupExpanded(group.id)} onUpdate={onTrackUpdate} />
          {lanes.slice(1).map((_, continuationIndex) => <div key={`${group.id}-label-${continuationIndex + 1}`} className="mt-1 flex h-9 min-w-0 items-center gap-1 border-l-2 border-teal-400/70 bg-white px-1 dark:bg-[#101720]">
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700 dark:text-slate-200">{displayLabel}</span>
            <span className="shrink-0 text-[9px] text-slate-400">{continuationIndex + 2}</span>
          </div>)}
        </div>
        <div className="space-y-1">
          {lanes.map((lane, laneIndex) => {
            const laneClipIds = new Set(lane.map((clip) => clip.id));
            const laneTransitions = (document.transitions?.items || []).filter((transition) => laneClipIds.has(transition.fromClipId));
            const laneGroupOverlays = logicalGroups.flatMap((logicalGroup) => {
              if (!logicalGroup.clipIds.some((clipId) => laneClipIds.has(clipId))) return [];
              const bounds = resolveCompositionGroupBounds(document, logicalGroup.id);
              return bounds ? [{ bounds, logicalGroup }] : [];
            });
            return <div key={`${group.id}-${laneIndex}`} data-timeline-lane onClick={(event) => { if (event.target === event.currentTarget) clearTimelineSelection(); }} onPointerDown={(event) => { if (event.target === event.currentTarget) beginScrub(event); }} onPointerMove={(event) => { if (scrubbing) continueScrub(event); }} onPointerUp={() => { if (scrubbing) endScrub(); }} onPointerCancel={() => { if (scrubbing) endScrub(); }} className="relative h-9 overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/5">
            {ruler.minor.map((time) => <span key={`minor-${time}`} aria-hidden="true" style={{ left: `${(time / maxDuration) * 100}%` }} className="absolute inset-y-0 w-px bg-slate-300/50 dark:bg-white/5" />)}
            {ruler.major.map((time) => <span key={`major-${time}`} aria-hidden="true" style={{ left: `${(time / maxDuration) * 100}%` }} className="absolute inset-y-0 w-px bg-slate-300 dark:bg-white/15" />)}
            {clipSnapMatch && <span aria-hidden="true" style={{ left: `${(clipSnapMatch.timeSeconds / maxDuration) * 100}%` }} className="absolute inset-y-0 z-20 w-0.5 bg-amber-400 shadow-[0_0_9px_rgba(251,191,36,0.9)]" />}
            <span aria-hidden="true" style={{ left: `${(currentTime / maxDuration) * 100}%` }} className={`absolute inset-y-0 z-20 w-0.5 shadow-[0_0_5px_rgba(0,212,179,0.75)] ${snappedToPlayhead ? "bg-amber-400 shadow-[0_0_9px_rgba(251,191,36,0.9)]" : "bg-[var(--engine-accent)]"}`} />
            {laneGroupOverlays.map(({ bounds, logicalGroup }) => {
              const groupColor = groupColorsById.get(logicalGroup.id) || COMPOSITION_GROUP_COLORS[0];
              const groupGestureDelta = gesture?.groupId === logicalGroup.id
                && gesture.groupStartSeconds !== null
                && gesture.originalGroupStartSeconds !== null
                ? gesture.groupStartSeconds - gesture.originalGroupStartSeconds
                : 0;
              return <span key={`group-boundary-${logicalGroup.id}`} aria-hidden="true" style={{
                left: `${((bounds.startSeconds + groupGestureDelta) / maxDuration) * 100}%`,
                width: `${(bounds.durationSeconds / maxDuration) * 100}%`,
              }} className={`pointer-events-none absolute inset-y-0 z-10 rounded-md border border-dashed ${selectedGroupId === logicalGroup.id ? groupColor?.selectedOverlay : editingGroupId === logicalGroup.id ? "border-cyan-500 bg-cyan-300/10" : groupColor?.overlay}`} />;
            })}
            {lane.map((clip) => {
              const logicalGroup = logicalGroupsByClipId.get(clip.id) || null;
              const groupColor = logicalGroup
                ? groupColorsById.get(logicalGroup.id) || COMPOSITION_GROUP_COLORS[0]
                : null;
              const groupGestureActive = Boolean(
                gesture?.kind === "move"
                && gesture.groupId
                && logicalGroup?.id === gesture.groupId,
              );
              const groupGestureDelta = groupGestureActive
                && gesture
                && gesture.groupStartSeconds !== null
                && gesture.originalGroupStartSeconds !== null
                ? gesture.groupStartSeconds - gesture.originalGroupStartSeconds
                : 0;
              const activeGesture = gesture?.clip.id === clip.id ? gesture : null;
              const clipDuration = activeGesture?.durationSeconds ?? clip.durationSeconds;
              const clipStart = groupGestureActive
                ? clip.startSeconds + groupGestureDelta
                : activeGesture?.startSeconds ?? clip.startSeconds;
              const label = clip.source.type === "PRODUCTION_ASSET" ? assetLabels[clip.source.productionAssetId] || clip.label : clip.label;
              const animations = document.motion.animations.filter((animation) => animation.target.clipId === clip.id);
              const displayClip = activeGesture || groupGestureActive ? {
                ...clip,
                durationSeconds: clipDuration,
                startSeconds: clipStart,
              } : clip;
              const isSelected = selectedClipIds.has(clip.id);
              const isSelectedGroupMember = Boolean(logicalGroup && selectedGroupId === logicalGroup.id);
              const canEditIndividually = !logicalGroup || editingGroupId === logicalGroup.id;
              return <Fragment key={clip.id}>
                <button
                  data-clip-id={clip.id}
                  disabled={saving || track.locked || Boolean(editingGroup && !editingGroup.clipIds.includes(clip.id))}
                  type="button"
                  onClick={(event) => {
                    if (didDragRef.current) { didDragRef.current = false; return; }
                    selectTimelineClip(clip, event);
                  }}
                  onDoubleClick={() => { if (logicalGroup && editingGroupId !== logicalGroup.id) enterSelectedGroup(logicalGroup, clip); }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && logicalGroup && editingGroupId !== logicalGroup.id) {
                      event.preventDefault();
                      enterSelectedGroup(logicalGroup, clip);
                      return;
                    }
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                    event.preventDefault();
                    const direction = event.key === "ArrowLeft" ? -1 : 1;
                    if (logicalGroup && editingGroupId !== logicalGroup.id) {
                      const bounds = resolveCompositionGroupBounds(document, logicalGroup.id);
                      if (!bounds) return;
                      onMoveGroup(logicalGroup.id, stepCompositionFrame(
                        bounds.startSeconds,
                        direction,
                        fps,
                        Math.max(0, maxDuration - bounds.durationSeconds),
                        event.shiftKey,
                      ));
                      return;
                    }
                    onMove(clip, stepCompositionFrame(
                      clip.startSeconds,
                      direction,
                      fps,
                      Math.max(0, maxDuration - clip.durationSeconds),
                      event.shiftKey,
                    ));
                  }}
                  onPointerDown={(event) => { if (!trimMode) beginGesture(event, clip, "move"); }}
                  onPointerMove={updateGesture}
                  onPointerUp={finishGesture}
                  onPointerCancel={finishGesture}
                  aria-pressed={isSelected}
                  title={`${logicalGroup ? `${logicalGroup.label || "Grupo"} · ` : ""}${label}: ${formatSeconds(clipStart)} – ${formatSeconds(clipStart + clipDuration)}${logicalGroup && editingGroupId !== logicalGroup.id ? " · doble clic para editar su contenido" : ""}`}
                  style={{
                    left: `${(clipStart / maxDuration) * 100}%`,
                    width: `${(clipDuration / maxDuration) * 100}%`,
                  }}
                  className={`absolute inset-y-1 min-w-5 touch-none select-none truncate rounded-md border px-3 pb-2 text-left text-[10px] font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${activeGesture?.snapMatch || clipSnapMatch?.clipId === clip.id ? "ring-2 ring-amber-400 ring-offset-1 ring-offset-white dark:ring-offset-[#0b1119]" : ""} ${isSelectedGroupMember ? groupColor?.selectedClip : isSelected ? "border-[var(--engine-accent)] bg-[var(--engine-accent)] text-[#042119] shadow-[0_0_0_1px_rgba(13,212,183,0.25),0_6px_16px_rgba(0,0,0,0.25)]" : groupColor?.defaultClip || (clip.timingSource === "ESTIMATED" ? "border-amber-500/70 bg-amber-50 text-amber-950 hover:bg-amber-100 dark:border-amber-400/60 dark:bg-amber-400/20 dark:text-amber-100 dark:hover:bg-amber-400/30" : "border-teal-500/60 bg-teal-50 text-teal-950 hover:bg-teal-100 dark:border-[var(--engine-accent)]/45 dark:bg-[var(--engine-accent)]/15 dark:text-slate-100 dark:hover:bg-[var(--engine-accent)]/25")}`}
                >
                  {canEditIndividually && <span aria-label={`Ajustar inicio de ${label}`} onPointerDown={(event) => beginGesture(event, clip, "trim-start")} className={`absolute inset-y-0 left-0 cursor-ew-resize border-r hover:bg-black/10 ${trimMode && selectedHfId === clip.hfId ? "w-3 border-white bg-cyan-300/70" : "w-2 border-black/20"}`} />}
                  <span className="relative z-10">{logicalGroup && editingGroupId !== logicalGroup.id ? "◆ " : ""}{label}</span>
                  {canEditIndividually && <span aria-label={`Cambiar duración de ${label}`} onPointerDown={(event) => beginGesture(event, clip, "trim-end")} className={`absolute inset-y-0 right-0 cursor-ew-resize border-l hover:bg-black/10 ${trimMode && selectedHfId === clip.hfId ? "w-3 border-white bg-cyan-300/70" : "w-2 border-black/20"}`} />}
                </button>
                {animations.map((animation) => <AnimationTimelineBand
                  key={animation.id}
                  animation={animation}
                  animations={document.motion.animations}
                  clip={displayClip}
                  clips={document.clips}
                  compositionDurationSeconds={maxDuration}
                  currentTime={currentTime}
                  disabled={saving || track.locked || Boolean(activeGesture) || groupGestureActive}
                  fps={fps}
                  onCommit={onAnimationTimingChange}
                  onError={setMotionEditError}
                  onSeek={onSeek}
                  onSelect={onAnimationSelect}
                  selected={selectedAnimationId === animation.id}
                  snapEnabled={snapEnabled}
                />)}
              </Fragment>;
            })}
            {laneTransitions.map((transition) => {
              const fromClip = document.clips.find((clip) => clip.id === transition.fromClipId);
              if (!fromClip) return null;
              const cutSeconds = fromClip.startSeconds + fromClip.durationSeconds;
              return <button
                key={transition.id}
                type="button"
                aria-label={`Editar transición ${transition.type} en ${formatSeconds(cutSeconds)}`}
                aria-pressed={selectedTransitionId === transition.id}
                title={`${transition.type} · ${transition.durationSeconds.toFixed(2)} s`}
                onClick={(event) => {
                  event.stopPropagation();
                  onTransitionSelect(transition.id);
                  onSeek(cutSeconds);
                }}
                style={{ left: `${(cutSeconds / maxDuration) * 100}%` }}
                className={`absolute left-0 top-1/2 z-30 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[10px] font-black shadow-md ${selectedTransitionId === transition.id ? "border-white bg-cyan-500 text-white ring-2 ring-cyan-300" : "border-cyan-700 bg-cyan-100 text-cyan-900 hover:bg-cyan-200 dark:border-cyan-200 dark:bg-cyan-700 dark:text-white"}`}
              >↔</button>;
            })}
          </div>;
          })}
          {lanes.length === 0 && <div className="flex h-9 items-center rounded-md border border-dashed border-slate-200 px-2 text-[10px] text-slate-400 dark:border-white/10">Sin clips</div>}
        </div>
      </div>;
    })}
      </div>
    </div>
  </div>;
}

function buildTimelineRuler(durationSeconds: number, zoom = 1) {
  const safeDuration = Math.max(durationSeconds, 0.05);
  const visibleDuration = safeDuration / Math.max(zoom, 1);
  const majorCandidates = [0.5, 1, 2, 5, 10, 15, 30, 60];
  const majorInterval = majorCandidates.find((candidate) => visibleDuration / candidate <= 8) || 60;
  const minorInterval = majorInterval >= 2 ? majorInterval / 2 : majorInterval / 5;
  const major: number[] = [];
  const minor: number[] = [];
  for (let time = 0; time <= safeDuration + 0.001; time += minorInterval) {
    const rounded = Math.round(time * 100) / 100;
    if (Math.abs((rounded / majorInterval) - Math.round(rounded / majorInterval)) < 0.001) major.push(rounded);
    else minor.push(rounded);
  }
  if (major[major.length - 1] !== safeDuration) major.push(safeDuration);
  return { major, minor };
}

function quantizeTimelineSeconds(value: number, snapEnabled: boolean, fps: number) {
  return snapEnabled ? Math.round(value * fps) / fps : Math.round(value * 1_000) / 1_000;
}

function formatSnapLabel(match: TimelineSnapMatch) {
  const label = match.clipLabel || "otro clip";
  if (match.movingEdge === "START" && match.source === "CLIP_END") return `Después de ${label}`;
  if (match.movingEdge === "START" && match.source === "CLIP_START") return `Mismo inicio · ${label}`;
  if (match.movingEdge === "END" && match.source === "CLIP_END") return `Mismo final · ${label}`;
  return `Final con inicio · ${label}`;
}

function formatSeconds(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
