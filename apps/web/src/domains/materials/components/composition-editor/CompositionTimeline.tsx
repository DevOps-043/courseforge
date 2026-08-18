"use client";

import { useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { CompositionClip, CompositionEditorDocument } from "@/domains/production/composition-editor/composition-document.types";
import { TrackControls } from "./TrackControls";
import type { CompositionTrackUpdateHandler } from "./composition-studio.types";

type TimelineGesture = {
  clip: CompositionClip;
  durationSeconds: number;
  kind: "move" | "trim-end" | "trim-start";
  pointerStartX: number;
  snappedToPlayhead: boolean;
  sourceOffsetSeconds: number;
  startSeconds: number;
};

const PLAYHEAD_SNAP_DISTANCE_PX = 10;

interface CompositionTimelineProps {
  assetLabels: Record<string, string>;
  currentTime: number;
  document: CompositionEditorDocument;
  onClearSelection: () => void;
  onDurationChange: (clip: CompositionClip, durationSeconds: number) => void;
  onMove: (clip: CompositionClip, startSeconds: number) => void;
  onSeek: (seconds: number) => void;
  onSelect: (hfId: string) => void;
  onTrackUpdate: CompositionTrackUpdateHandler;
  onTrim: (clip: CompositionClip, startSeconds: number, durationSeconds: number, sourceOffsetSeconds: number) => void;
  saving: boolean;
  selectedHfId: string | null;
  snapEnabled?: boolean;
  trimMode?: boolean;
}

export function CompositionTimeline({ assetLabels, currentTime, document, onClearSelection, onDurationChange, onMove, onSeek, onSelect, onTrackUpdate, onTrim, saving, selectedHfId, snapEnabled = true, trimMode = false }: CompositionTimelineProps) {
  const [gesture, setGesture] = useState<TimelineGesture | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const didDragRef = useRef(false);
  const tracks = document.tracks.slice().sort((left, right) => left.order - right.order);
  const maxDuration = document.canvas.durationSeconds;
  const fps = document.canvas.fps;
  const ruler = useMemo(() => buildTimelineRuler(maxDuration), [maxDuration]);

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
      snappedToPlayhead: false,
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
    if (Math.abs(event.clientX - gesture.pointerStartX) >= 3) didDragRef.current = true;

    if (gesture.kind === "move") {
      const unclampedStartSeconds = Math.max(0, Math.min(maxDuration - gesture.clip.durationSeconds, gesture.clip.startSeconds + deltaSeconds));
      const playheadSnap = snapClipMoveToPlayhead({
        currentTime,
        durationSeconds: gesture.clip.durationSeconds,
        startSeconds: unclampedStartSeconds,
        toleranceSeconds: playheadSnapTolerance,
      });
      const startSeconds = quantizeTimelineSeconds(playheadSnap.startSeconds, snapEnabled, fps);
      setGesture((current) => current ? { ...current, snappedToPlayhead: snapEnabled && playheadSnap.snapped, startSeconds } : current);
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
      const snappedEnd = snapTimelineValueToPlayhead(
        gesture.clip.startSeconds + unclampedDurationSeconds,
        currentTime,
        playheadSnapTolerance,
      );
      const durationSeconds = quantizeTimelineSeconds(
        Math.max(1 / fps, Math.min(maxDuration - gesture.clip.startSeconds, sourceLimit, snappedEnd.value - gesture.clip.startSeconds)),
        snapEnabled,
        fps,
      );
      setGesture((current) => current ? { ...current, durationSeconds, snappedToPlayhead: snapEnabled && snappedEnd.snapped } : current);
      return;
    }

    const originalEnd = gesture.clip.startSeconds + gesture.clip.durationSeconds;
    const earliestStart = Math.max(0, gesture.clip.startSeconds - (gesture.clip.sourceOffsetSeconds || 0));
    const unclampedStartSeconds = Math.max(earliestStart, Math.min(originalEnd - (1 / fps), gesture.clip.startSeconds + deltaSeconds));
    const snappedStart = snapTimelineValueToPlayhead(unclampedStartSeconds, currentTime, playheadSnapTolerance);
    const startSeconds = quantizeTimelineSeconds(
      Math.max(earliestStart, Math.min(originalEnd - (1 / fps), snappedStart.value)),
      snapEnabled,
      fps,
    );
    setGesture((current) => current ? {
      ...current,
      durationSeconds: quantizeTimelineSeconds(originalEnd - startSeconds, snapEnabled, fps),
      snappedToPlayhead: snapEnabled && snappedStart.snapped,
      sourceOffsetSeconds: Math.max(0, quantizeTimelineSeconds((gesture.clip.sourceOffsetSeconds || 0) + startSeconds - gesture.clip.startSeconds, snapEnabled, fps)),
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

  return <div className="space-y-2">
    <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-gray-400"><span>Timeline</span><span>{formatSeconds(currentTime)} · {document.clips.length} clips · mueve el bloque o recorta sus bordes</span></div>
    <div className="grid grid-cols-[160px_minmax(0,1fr)] items-end gap-2"><span className="pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-gray-400">Tiempo</span><div role="slider" aria-label="Cursor de la composición" aria-valuemax={maxDuration} aria-valuemin={0} aria-valuenow={currentTime} tabIndex={0} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); onSeek(Math.max(0, currentTime - 0.5)); } if (event.key === "ArrowRight") { event.preventDefault(); onSeek(Math.min(maxDuration, currentTime + 0.5)); } }} onPointerDown={beginScrub} onPointerMove={continueScrub} onPointerUp={endScrub} onPointerCancel={endScrub} className="relative h-8 cursor-ew-resize select-none overflow-hidden rounded-t-md border border-b-0 border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5">{ruler.minor.map((time) => <span key={`minor-${time}`} aria-hidden="true" style={{ left: `${(time / maxDuration) * 100}%` }} className="absolute bottom-0 h-2 w-px bg-slate-300 dark:bg-white/20" />)}{ruler.major.map((time) => <span key={`major-${time}`} aria-hidden="true" style={{ left: `${(time / maxDuration) * 100}%` }} className="absolute inset-y-0 w-px bg-slate-300 dark:bg-white/20"><span className="absolute left-1 top-1 whitespace-nowrap font-mono text-[9px] text-slate-500 dark:text-gray-400">{formatSeconds(time)}</span></span>)}<span aria-hidden="true" style={{ left: `${(currentTime / maxDuration) * 100}%` }} className={`absolute inset-y-0 z-30 w-0.5 ${gesture?.snappedToPlayhead ? "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.9)]" : "bg-cyan-600 shadow-[0_0_7px_rgba(8,145,178,0.75)] dark:bg-cyan-300"} ${scrubbing ? "opacity-100" : "opacity-90"}`}><span className={`absolute -left-1.5 top-0 h-3 w-3 rotate-45 border ${gesture?.snappedToPlayhead ? "border-amber-600 bg-amber-100" : "border-cyan-700 bg-cyan-100 dark:border-cyan-100 dark:bg-cyan-400"}`} /></span></div></div>
    {tracks.map((track) => {
      const clips = document.clips.filter((clip) => clip.trackId === track.id);
      const lanes = track.kind === "DECK" ? [clips] : clips.map((clip) => [clip]);
      return <div key={track.id} className="grid grid-cols-[160px_minmax(0,1fr)] items-start gap-2">
        <TrackControls disabled={saving} track={track} onUpdate={onTrackUpdate} />
        <div className="space-y-1">
          {lanes.map((lane, laneIndex) => <div key={`${track.id}-${laneIndex}`} data-timeline-lane onClick={(event) => { if (event.target === event.currentTarget) onClearSelection(); }} onPointerDown={(event) => { if (event.target === event.currentTarget) beginScrub(event); }} onPointerMove={(event) => { if (scrubbing) continueScrub(event); }} onPointerUp={() => { if (scrubbing) endScrub(); }} onPointerCancel={() => { if (scrubbing) endScrub(); }} className="relative h-9 overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/5">
            {ruler.minor.map((time) => <span key={`minor-${time}`} aria-hidden="true" style={{ left: `${(time / maxDuration) * 100}%` }} className="absolute inset-y-0 w-px bg-slate-300/50 dark:bg-white/5" />)}
            {ruler.major.map((time) => <span key={`major-${time}`} aria-hidden="true" style={{ left: `${(time / maxDuration) * 100}%` }} className="absolute inset-y-0 w-px bg-slate-300 dark:bg-white/15" />)}
            <span aria-hidden="true" style={{ left: `${(currentTime / maxDuration) * 100}%` }} className={`absolute inset-y-0 z-20 w-0.5 shadow-[0_0_5px_rgba(0,212,179,0.75)] ${gesture?.snappedToPlayhead ? "bg-amber-400 shadow-[0_0_9px_rgba(251,191,36,0.9)]" : "bg-[#00D4B3]"}`} />
            {lane.map((clip) => {
              const activeGesture = gesture?.clip.id === clip.id ? gesture : null;
              const clipDuration = activeGesture?.durationSeconds ?? clip.durationSeconds;
              const clipStart = activeGesture?.startSeconds ?? clip.startSeconds;
              const label = clip.source.type === "PRODUCTION_ASSET" ? assetLabels[clip.source.productionAssetId] || clip.label : clip.label;
              return <button key={clip.id} data-clip-id={clip.id} disabled={saving || track.locked} type="button" onClick={() => { if (didDragRef.current) { didDragRef.current = false; return; } onSeek(clipStart); onSelect(clip.hfId); }} onPointerDown={(event) => { if (!trimMode) beginGesture(event, clip, "move"); }} onPointerMove={updateGesture} onPointerUp={finishGesture} onPointerCancel={finishGesture} title={`${label}: ${formatSeconds(clipStart)} – ${formatSeconds(clipStart + clipDuration)}`} style={{ left: `${(clipStart / maxDuration) * 100}%`, width: `${(clipDuration / maxDuration) * 100}%` }} className={`absolute inset-y-1 min-w-5 touch-none select-none truncate rounded border px-3 text-left text-[10px] font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${selectedHfId === clip.hfId ? "border-[#0A2540] bg-[#0A2540] text-white" : clip.timingSource === "ESTIMATED" ? "border-[#F59E0B] bg-[#F59E0B]/30 text-[#0A2540] hover:bg-[#F59E0B]/40" : "border-[#00D4B3] bg-[#00D4B3]/20 text-[#0A2540] hover:bg-[#00D4B3]/30 dark:text-[#E9ECEF]"}`}><span aria-label={`Recortar inicio de ${label}`} onPointerDown={(event) => beginGesture(event, clip, "trim-start")} className={`absolute inset-y-0 left-0 cursor-ew-resize border-r hover:bg-black/10 ${trimMode && selectedHfId === clip.hfId ? "w-3 border-white bg-cyan-300/70" : "w-2 border-black/20"}`} /><span>{label}</span><span aria-label={`Cambiar duración de ${label}`} onPointerDown={(event) => beginGesture(event, clip, "trim-end")} className={`absolute inset-y-0 right-0 cursor-ew-resize border-l hover:bg-black/10 ${trimMode && selectedHfId === clip.hfId ? "w-3 border-white bg-cyan-300/70" : "w-2 border-black/20"}`} /></button>;
            })}
          </div>)}
          {lanes.length === 0 && <div className="flex h-9 items-center rounded-md border border-dashed border-slate-200 px-2 text-[10px] text-slate-400 dark:border-white/10">Sin clips</div>}
        </div>
      </div>;
    })}
  </div>;
}

function buildTimelineRuler(durationSeconds: number) {
  const safeDuration = Math.max(durationSeconds, 0.05);
  const majorCandidates = [0.5, 1, 2, 5, 10, 15, 30, 60];
  const majorInterval = majorCandidates.find((candidate) => safeDuration / candidate <= 8) || 60;
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

function snapTimelineValueToPlayhead(value: number, playheadSeconds: number, toleranceSeconds: number) {
  return Math.abs(value - playheadSeconds) <= toleranceSeconds
    ? { snapped: true, value: playheadSeconds }
    : { snapped: false, value };
}

function snapClipMoveToPlayhead(params: {
  currentTime: number;
  durationSeconds: number;
  startSeconds: number;
  toleranceSeconds: number;
}) {
  const start = snapTimelineValueToPlayhead(params.startSeconds, params.currentTime, params.toleranceSeconds);
  const end = snapTimelineValueToPlayhead(
    params.startSeconds + params.durationSeconds,
    params.currentTime,
    params.toleranceSeconds,
  );
  if (!start.snapped && !end.snapped) return { snapped: false, startSeconds: params.startSeconds };
  if (start.snapped && (!end.snapped || Math.abs(params.startSeconds - params.currentTime) <= Math.abs(params.startSeconds + params.durationSeconds - params.currentTime))) {
    return { snapped: true, startSeconds: start.value };
  }
  return { snapped: true, startSeconds: end.value - params.durationSeconds };
}

function formatSeconds(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
