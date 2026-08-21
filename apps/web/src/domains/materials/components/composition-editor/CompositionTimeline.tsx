"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import type { CompositionClip, CompositionEditorDocument } from "@/domains/production/composition-editor/composition-document.types";
import type { CompositionAnimation } from "@/domains/production/composition-editor/composition-motion.types";
import {
  buildTimelineSnapTargets,
  resolveTimelineSnap,
  type TimelineSnapMatch,
} from "@/domains/production/composition-editor/composition-timeline-snap.service";
import { TrackControls } from "./TrackControls";
import { AnimationTimelineBand } from "./AnimationTimelineBand";
import type { CompositionTrackUpdateHandler } from "./composition-studio.types";

type TimelineGesture = {
  clip: CompositionClip;
  durationSeconds: number;
  kind: "move" | "trim-end" | "trim-start";
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
  onClearSelection: () => void;
  onDurationChange: (clip: CompositionClip, durationSeconds: number) => void;
  onAnimationSelect: (animationId: string, clipHfId: string) => void;
  onAnimationTimingChange: (animation: CompositionAnimation, timing: CompositionAnimation["timing"]) => void;
  onMove: (clip: CompositionClip, startSeconds: number) => void;
  onSeek: (seconds: number) => void;
  onSelect: (hfId: string) => void;
  onTrackUpdate: CompositionTrackUpdateHandler;
  onTrim: (clip: CompositionClip, startSeconds: number, durationSeconds: number, sourceOffsetSeconds: number) => void;
  saving: boolean;
  selectedAnimationId: string | null;
  selectedHfId: string | null;
  snapEnabled?: boolean;
  trimMode?: boolean;
}

export function CompositionTimeline({ assetLabels, currentTime, document, onAnimationSelect, onAnimationTimingChange, onClearSelection, onDurationChange, onMove, onSeek, onSelect, onTrackUpdate, onTrim, saving, selectedAnimationId, selectedHfId, snapEnabled = true, trimMode = false }: CompositionTimelineProps) {
  const [gesture, setGesture] = useState<TimelineGesture | null>(null);
  const [motionEditError, setMotionEditError] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(MIN_TIMELINE_ZOOM);
  const [timelineScroll, setTimelineScroll] = useState(0);
  const [timelineScrollMax, setTimelineScrollMax] = useState(0);
  const didDragRef = useRef(false);
  const timelineViewportRef = useRef<HTMLDivElement>(null);
  const tracks = document.tracks.slice().sort((left, right) => left.order - right.order);
  const maxDuration = document.canvas.durationSeconds;
  const fps = document.canvas.fps;
  const ruler = useMemo(() => buildTimelineRuler(maxDuration, timelineZoom), [maxDuration, timelineZoom]);
  const snappedToPlayhead = gesture?.snapMatch?.source === "PLAYHEAD";
  const clipSnapMatch = gesture?.snapMatch?.source === "CLIP_START" || gesture?.snapMatch?.source === "CLIP_END"
    ? gesture.snapMatch
    : null;

  const beginGesture = (event: PointerEvent<HTMLElement>, clip: CompositionClip, kind: TimelineGesture["kind"]) => {
    if (saving || document.tracks.find((track) => track.id === clip.trackId)?.locked) return;
    event.preventDefault();
    event.stopPropagation();
    const captureTarget = kind === "move" ? event.currentTarget : event.currentTarget.parentElement;
    captureTarget?.setPointerCapture?.(event.pointerId);
    didDragRef.current = false;
    onSelect(clip.hfId);
    setGesture({
      clip,
      durationSeconds: clip.durationSeconds,
      kind,
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
      clips: document.clips.filter((candidate) => !document.tracks.find((track) => track.id === candidate.trackId)?.hidden),
      excludedClipId: gesture.clip.id,
      playheadSeconds: currentTime,
    });
    if (Math.abs(event.clientX - gesture.pointerStartX) >= 3) didDragRef.current = true;

    if (gesture.kind === "move") {
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
    const earliestStart = Math.max(0, gesture.clip.startSeconds - (gesture.clip.sourceOffsetSeconds || 0));
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
    const sourceOffsetSeconds = (gesture.clip.sourceOffsetSeconds || 0) + startSeconds - gesture.clip.startSeconds;
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
    if (current.kind === "move" && Math.abs(current.startSeconds - current.clip.startSeconds) >= frameDuration / 2) {
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
  }, [timelineZoom, tracks.length]);

  return <div className="space-y-2 pb-2">
    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-gray-400">
      <span>Timeline</span>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span>{formatSeconds(currentTime)} · {document.clips.length} clips · mueve el bloque o recorta sus bordes</span>
        <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-0.5 normal-case tracking-normal dark:border-white/10 dark:bg-white/5">
          <button type="button" aria-label="Alejar timeline" title="Alejar timeline" disabled={timelineZoom <= MIN_TIMELINE_ZOOM} onClick={() => changeTimelineZoom(timelineZoom - TIMELINE_ZOOM_STEP)} className="rounded p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-white/10"><ZoomOut size={13} /></button>
          <input aria-label="Zoom del timeline" aria-valuetext={`${Math.round(timelineZoom * 100)}%`} type="range" min={MIN_TIMELINE_ZOOM} max={MAX_TIMELINE_ZOOM} step={TIMELINE_ZOOM_STEP} value={timelineZoom} onChange={(event) => changeTimelineZoom(Number(event.target.value))} className="w-20 accent-[#00D4B3]" />
          <span className="w-10 text-center font-mono text-[10px] tabular-nums">{Math.round(timelineZoom * 100)}%</span>
          <button type="button" aria-label="Acercar timeline" title="Acercar timeline" disabled={timelineZoom >= MAX_TIMELINE_ZOOM} onClick={() => changeTimelineZoom(timelineZoom + TIMELINE_ZOOM_STEP)} className="rounded p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-white/10"><ZoomIn size={13} /></button>
        </div>
      </div>
    </div>
    <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 dark:border-white/10 dark:bg-white/5">
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-gray-400">Desplazamiento</span>
      <button type="button" aria-label="Mover timeline a la izquierda" title="Mover timeline a la izquierda" disabled={timelineScroll <= 0} onClick={() => nudgeTimelineScroll(-1)} className="rounded p-1 text-slate-600 hover:bg-slate-200 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-white/10"><ChevronLeft size={14} /></button>
      <input aria-label="Desplazamiento horizontal del timeline" aria-valuetext={timelineScrollMax > 0 ? `${Math.round((timelineScroll / timelineScrollMax) * 100)}%` : "Inicio"} type="range" min="0" max={Math.max(1, timelineScrollMax)} step="1" value={timelineScrollMax > 0 ? timelineScroll : 0} disabled={timelineScrollMax <= 0} onChange={(event) => moveTimelineScroll(Number(event.target.value))} className="min-w-24 flex-1 accent-[#00D4B3] disabled:opacity-40" />
      <button type="button" aria-label="Mover timeline a la derecha" title="Mover timeline a la derecha" disabled={timelineScroll >= timelineScrollMax} onClick={() => nudgeTimelineScroll(1)} className="rounded p-1 text-slate-600 hover:bg-slate-200 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-white/10"><ChevronRight size={14} /></button>
    </div>
    {motionEditError && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-200">{motionEditError}</div>}
    <div ref={timelineViewportRef} onScroll={syncTimelineScroll} className="overflow-x-auto pb-4">
      <div className="space-y-2" style={{ minWidth: `${timelineZoom * 100}%` }}>
    <div className="grid grid-cols-[160px_minmax(0,1fr)] items-end gap-2"><span className="sticky left-0 z-40 bg-white pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:bg-[#101720] dark:text-gray-400">Tiempo</span><div role="slider" aria-label="Cursor de la composición" aria-valuemax={maxDuration} aria-valuemin={0} aria-valuenow={currentTime} tabIndex={0} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); onSeek(Math.max(0, currentTime - 0.5)); } if (event.key === "ArrowRight") { event.preventDefault(); onSeek(Math.min(maxDuration, currentTime + 0.5)); } }} onPointerDown={beginScrub} onPointerMove={continueScrub} onPointerUp={endScrub} onPointerCancel={endScrub} className="relative h-8 cursor-ew-resize select-none overflow-hidden rounded-t-md border border-b-0 border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5">{ruler.minor.map((time) => <span key={`minor-${time}`} aria-hidden="true" style={{ left: `${(time / maxDuration) * 100}%` }} className="absolute bottom-0 h-2 w-px bg-slate-300 dark:bg-white/20" />)}{ruler.major.map((time) => <span key={`major-${time}`} aria-hidden="true" style={{ left: `${(time / maxDuration) * 100}%` }} className="absolute inset-y-0 w-px bg-slate-300 dark:bg-white/20"><span className="absolute left-1 top-1 whitespace-nowrap font-mono text-[9px] text-slate-500 dark:text-gray-400">{formatSeconds(time)}</span></span>)}{clipSnapMatch && <span aria-hidden="true" style={{ left: `${(clipSnapMatch.timeSeconds / maxDuration) * 100}%` }} className="absolute inset-y-0 z-30 w-0.5 bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.9)]"><span className="absolute left-1 top-0.5 whitespace-nowrap rounded bg-amber-100 px-1 py-0.5 text-[8px] font-bold normal-case tracking-normal text-amber-900 shadow-sm">{formatSnapLabel(clipSnapMatch)}</span></span>}<span aria-hidden="true" style={{ left: `${(currentTime / maxDuration) * 100}%` }} className={`absolute inset-y-0 z-30 w-0.5 ${snappedToPlayhead ? "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.9)]" : "bg-cyan-600 shadow-[0_0_7px_rgba(8,145,178,0.75)] dark:bg-cyan-300"} ${scrubbing ? "opacity-100" : "opacity-90"}`}><span className={`absolute -left-1.5 top-0 h-3 w-3 rotate-45 border ${snappedToPlayhead ? "border-amber-600 bg-amber-100" : "border-cyan-700 bg-cyan-100 dark:border-cyan-100 dark:bg-cyan-400"}`} /></span></div></div>
    {tracks.map((track) => {
      const clips = document.clips.filter((clip) => clip.trackId === track.id);
      const lanes = track.kind === "DECK" ? [clips] : clips.map((clip) => [clip]);
      return <div key={track.id} className="grid snap-start grid-cols-[160px_minmax(0,1fr)] items-stretch gap-2">
        <div className="sticky left-0 z-40 self-stretch bg-white dark:bg-[#101720]">
          <TrackControls disabled={saving} track={track} onUpdate={onTrackUpdate} />
          {lanes.slice(1).map((_, continuationIndex) => <div key={`${track.id}-label-${continuationIndex + 1}`} className="mt-1 flex h-9 min-w-0 items-center gap-1 border-l-2 border-teal-400/70 bg-white px-1 dark:bg-[#101720]">
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700 dark:text-slate-200">{track.label}</span>
            <span className="shrink-0 text-[9px] text-slate-400">{continuationIndex + 2}</span>
          </div>)}
        </div>
        <div className="space-y-1">
          {lanes.map((lane, laneIndex) => <div key={`${track.id}-${laneIndex}`} data-timeline-lane onClick={(event) => { if (event.target === event.currentTarget) onClearSelection(); }} onPointerDown={(event) => { if (event.target === event.currentTarget) beginScrub(event); }} onPointerMove={(event) => { if (scrubbing) continueScrub(event); }} onPointerUp={() => { if (scrubbing) endScrub(); }} onPointerCancel={() => { if (scrubbing) endScrub(); }} className="relative h-9 overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/5">
            {ruler.minor.map((time) => <span key={`minor-${time}`} aria-hidden="true" style={{ left: `${(time / maxDuration) * 100}%` }} className="absolute inset-y-0 w-px bg-slate-300/50 dark:bg-white/5" />)}
            {ruler.major.map((time) => <span key={`major-${time}`} aria-hidden="true" style={{ left: `${(time / maxDuration) * 100}%` }} className="absolute inset-y-0 w-px bg-slate-300 dark:bg-white/15" />)}
            {clipSnapMatch && <span aria-hidden="true" style={{ left: `${(clipSnapMatch.timeSeconds / maxDuration) * 100}%` }} className="absolute inset-y-0 z-20 w-0.5 bg-amber-400 shadow-[0_0_9px_rgba(251,191,36,0.9)]" />}
            <span aria-hidden="true" style={{ left: `${(currentTime / maxDuration) * 100}%` }} className={`absolute inset-y-0 z-20 w-0.5 shadow-[0_0_5px_rgba(0,212,179,0.75)] ${snappedToPlayhead ? "bg-amber-400 shadow-[0_0_9px_rgba(251,191,36,0.9)]" : "bg-[#00D4B3]"}`} />
            {lane.map((clip) => {
              const activeGesture = gesture?.clip.id === clip.id ? gesture : null;
              const clipDuration = activeGesture?.durationSeconds ?? clip.durationSeconds;
              const clipStart = activeGesture?.startSeconds ?? clip.startSeconds;
              const label = clip.source.type === "PRODUCTION_ASSET" ? assetLabels[clip.source.productionAssetId] || clip.label : clip.label;
              const animations = document.motion.animations.filter((animation) => animation.target.clipId === clip.id);
              const displayClip = activeGesture ? {
                ...clip,
                durationSeconds: clipDuration,
                startSeconds: clipStart,
              } : clip;
              return <Fragment key={clip.id}>
                <button
                  data-clip-id={clip.id}
                  disabled={saving || track.locked}
                  type="button"
                  onClick={() => {
                    if (didDragRef.current) { didDragRef.current = false; return; }
                    onSelect(clip.hfId);
                  }}
                  onPointerDown={(event) => { if (!trimMode) beginGesture(event, clip, "move"); }}
                  onPointerMove={updateGesture}
                  onPointerUp={finishGesture}
                  onPointerCancel={finishGesture}
                  title={`${label}: ${formatSeconds(clipStart)} – ${formatSeconds(clipStart + clipDuration)}`}
                  style={{
                    left: `${(clipStart / maxDuration) * 100}%`,
                    width: `${(clipDuration / maxDuration) * 100}%`,
                  }}
                  className={`absolute inset-y-1 min-w-5 touch-none select-none truncate rounded border px-3 pb-2 text-left text-[10px] font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${activeGesture?.snapMatch || clipSnapMatch?.clipId === clip.id ? "ring-2 ring-amber-400 ring-offset-1" : ""} ${selectedHfId === clip.hfId ? "border-[#0A2540] bg-[#0A2540] text-white" : clip.timingSource === "ESTIMATED" ? "border-[#F59E0B] bg-[#F59E0B]/30 text-[#0A2540] hover:bg-[#F59E0B]/40" : "border-[#00D4B3] bg-[#00D4B3]/20 text-[#0A2540] hover:bg-[#00D4B3]/30 dark:text-[#E9ECEF]"}`}
                >
                  <span aria-label={`Recortar inicio de ${label}`} onPointerDown={(event) => beginGesture(event, clip, "trim-start")} className={`absolute inset-y-0 left-0 cursor-ew-resize border-r hover:bg-black/10 ${trimMode && selectedHfId === clip.hfId ? "w-3 border-white bg-cyan-300/70" : "w-2 border-black/20"}`} />
                  <span className="relative z-10">{label}</span>
                  <span aria-label={`Cambiar duración de ${label}`} onPointerDown={(event) => beginGesture(event, clip, "trim-end")} className={`absolute inset-y-0 right-0 cursor-ew-resize border-l hover:bg-black/10 ${trimMode && selectedHfId === clip.hfId ? "w-3 border-white bg-cyan-300/70" : "w-2 border-black/20"}`} />
                </button>
                {animations.map((animation) => <AnimationTimelineBand
                  key={animation.id}
                  animation={animation}
                  animations={document.motion.animations}
                  clip={displayClip}
                  compositionDurationSeconds={maxDuration}
                  currentTime={currentTime}
                  disabled={saving || track.locked || Boolean(activeGesture)}
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
          </div>)}
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
