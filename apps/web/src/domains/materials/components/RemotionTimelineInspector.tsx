"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight, Clock, Film, Music2, UserRound, ZoomIn, ZoomOut } from "lucide-react";
import {
  getActiveTimelineSegments,
  type VisualTimeline,
  type VisualTimelineSegment,
  type VisualTimelineTrackKind,
} from "@/remotion/visual-timeline";
import type { RemotionEditableLayerId } from "@/remotion/layout-override-styles";
import {
  TIMELINE_OVERRIDE_MANIFEST_VERSION,
  type TimelineOverrideManifest,
} from "@/remotion/timeline-overrides";

interface RemotionTimelineInspectorProps {
  timeline: VisualTimeline;
  currentFrame: number;
  onSeekFrame: (frame: number) => void;
  selectedLayerId?: RemotionEditableLayerId;
  onSelectedLayerChange?: (layerId: RemotionEditableLayerId) => void;
  componentId?: string;
  templateId?: string | null;
  templateVersionId?: string | null;
  value?: TimelineOverrideManifest[];
  onChange?: (nextOverrides: TimelineOverrideManifest[]) => void;
  disabled?: boolean;
}

type DragMode = "move" | "start" | "end";

interface DragState {
  mode: DragMode;
  segmentId: string;
  startClientX: number;
  original: VisualTimelineSegment;
}

const TRACK_STYLES: Record<
  VisualTimelineTrackKind,
  { bar: string; activeBar: string; badge: string; Icon: typeof Clock }
> = {
  audio: {
    bar: "bg-emerald-500/75 hover:bg-emerald-500",
    activeBar: "ring-2 ring-emerald-200",
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
    Icon: Music2,
  },
  avatar: {
    bar: "bg-sky-500/75 hover:bg-sky-500",
    activeBar: "ring-2 ring-sky-200",
    badge: "bg-sky-500/10 text-sky-700 dark:text-sky-200",
    Icon: UserRound,
  },
  slides: {
    bar: "bg-violet-500/75 hover:bg-violet-500",
    activeBar: "ring-2 ring-violet-200",
    badge: "bg-violet-500/10 text-violet-700 dark:text-violet-200",
    Icon: Film,
  },
  broll: {
    bar: "bg-rose-500/75 hover:bg-rose-500",
    activeBar: "ring-2 ring-rose-200",
    badge: "bg-rose-500/10 text-rose-700 dark:text-rose-200",
    Icon: Film,
  },
};

function formatSeconds(seconds: number): string {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = Math.floor(safeSeconds % 60);
  const tenths = Math.floor((safeSeconds % 1) * 10);

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}.${tenths}`;
}

function secondsToFrame(seconds: number, fps: number) {
  return Math.max(0, Math.round(seconds * fps));
}

function frameToSeconds(frame: number, fps: number) {
  return Math.round((frame / fps) * 10) / 10;
}

function clampFrame(frame: number, durationInFrames: number) {
  if (!Number.isFinite(frame)) return 0;
  return Math.max(0, Math.min(durationInFrames, Math.round(frame)));
}

function isEditableSegment(segment: VisualTimelineSegment) {
  return segment.trackKind === "slides" || segment.trackKind === "broll" || segment.trackKind === "avatar";
}

function segmentToOverride(segment: VisualTimelineSegment) {
  const canTrimSource = segment.trackKind === "broll" || segment.trackKind === "avatar";

  return {
    id: segment.id,
    trackKind: segment.trackKind as "slides" | "broll" | "avatar",
    layerId: segment.layerId,
    startFrame: segment.startFrame,
    endFrame: segment.endFrame,
    sourceStartFrame: canTrimSource ? segment.sourceStartFrame ?? 0 : undefined,
    sourceEndFrame: canTrimSource ? segment.sourceEndFrame ?? segment.durationInFrames : undefined,
    loopMode: segment.trackKind === "broll" ? segment.loopMode ?? "loop" : "none",
  };
}

function buildManifest(params: {
  timeline: VisualTimeline;
  segments: VisualTimelineSegment[];
  componentId?: string;
  templateId?: string | null;
  templateVersionId?: string | null;
}): TimelineOverrideManifest[] {
  const editableSegments = params.segments.filter(isEditableSegment);
  if (editableSegments.length === 0) {
    return [];
  }

  return [
    {
      version: TIMELINE_OVERRIDE_MANIFEST_VERSION,
      componentId: params.componentId,
      templateId: params.templateId || undefined,
      templateVersionId: params.templateVersionId || null,
      timeline: {
        fps: params.timeline.fps,
        durationInFrames: params.timeline.durationInFrames,
      },
      segments: editableSegments.map(segmentToOverride),
    },
  ];
}

function getSegmentStyle(
  segment: VisualTimelineSegment,
  pxPerFrame: number,
) {
  return {
    left: `${segment.startFrame * pxPerFrame}px`,
    width: `${Math.max(2, segment.durationInFrames * pxPerFrame)}px`,
  };
}

function buildRulerTicks(timeline: VisualTimeline, zoomPxPerSecond: number) {
  const durationSeconds = Math.ceil(timeline.durationInSeconds);
  const majorStep = zoomPxPerSecond >= 120 ? 1 : zoomPxPerSecond >= 60 ? 2 : 5;
  const minorStep = zoomPxPerSecond >= 120 ? 0.5 : 1;
  const ticks: Array<{ seconds: number; major: boolean }> = [];

  for (let seconds = 0; seconds <= durationSeconds; seconds += minorStep) {
    ticks.push({
      seconds,
      major: Math.abs(seconds % majorStep) < 0.001,
    });
  }

  return ticks;
}

export function RemotionTimelineInspector({
  timeline,
  currentFrame,
  onSeekFrame,
  selectedLayerId,
  onSelectedLayerChange,
  componentId,
  templateId,
  templateVersionId,
  onChange,
  disabled = false,
}: RemotionTimelineInspectorProps) {
  const [zoomPxPerSecond, setZoomPxPerSecond] = useState(80);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0);
  const [timelineMaxScrollLeft, setTimelineMaxScrollLeft] = useState(0);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const clampedFrame = Math.min(
    Math.max(0, timeline.durationInFrames - 1),
    Math.max(0, Math.round(currentFrame)),
  );
  const currentSeconds = clampedFrame / timeline.fps;
  const pxPerFrame = zoomPxPerSecond / timeline.fps;
  const contentWidth = Math.max(420, Math.ceil(timeline.durationInSeconds * zoomPxPerSecond));
  const activeSegmentIds = new Set(
    getActiveTimelineSegments(timeline, clampedFrame).map(
      (segment) => segment.id,
    ),
  );
  const playheadLeft = clampedFrame * pxPerFrame;
  const editableSegments = useMemo(
    () => timeline.tracks.flatMap((track) => track.segments).filter(isEditableSegment),
    [timeline],
  );
  const selectedSegment =
    editableSegments.find((segment) => segment.id === selectedSegmentId) ||
    editableSegments.find((segment) => segment.layerId && segment.layerId === selectedLayerId) ||
    editableSegments[0] ||
    null;
  const rulerTicks = useMemo(
    () => buildRulerTicks(timeline, zoomPxPerSecond),
    [timeline, zoomPxPerSecond],
  );

  const syncTimelineScrollState = () => {
    const element = timelineScrollRef.current;
    if (!element) return;
    setTimelineScrollLeft(Math.round(element.scrollLeft));
    setTimelineMaxScrollLeft(Math.max(0, element.scrollWidth - element.clientWidth));
  };

  const scrollTimelineBy = (delta: number) => {
    const element = timelineScrollRef.current;
    if (!element) return;
    element.scrollBy({ left: delta, behavior: "smooth" });
  };

  const setTimelineScrollPosition = (nextScrollLeft: number) => {
    const element = timelineScrollRef.current;
    if (!element) return;
    element.scrollLeft = nextScrollLeft;
    syncTimelineScrollState();
  };

  useEffect(() => {
    if (selectedSegment && selectedSegment.id !== selectedSegmentId) {
      setSelectedSegmentId(selectedSegment.id);
    }
  }, [selectedSegment, selectedSegmentId]);

  useEffect(() => {
    syncTimelineScrollState();
    window.addEventListener("resize", syncTimelineScrollState);
    return () => window.removeEventListener("resize", syncTimelineScrollState);
  }, [contentWidth]);

  const commitSegment = (segmentId: string, updater: (segment: VisualTimelineSegment) => VisualTimelineSegment) => {
    if (!onChange || disabled) return;
    const nextSegments = editableSegments.map((segment) =>
      segment.id === segmentId ? updater(segment) : segment,
    );
    onChange(buildManifest({
      timeline,
      segments: nextSegments,
      componentId,
      templateId,
      templateVersionId,
    }));
  };

  const handleSelectSegment = (segment: VisualTimelineSegment) => {
    setSelectedSegmentId(segment.id);
    onSeekFrame(segment.startFrame);
    if (segment.layerId) {
      onSelectedLayerChange?.(segment.layerId);
    }
  };

  const handlePointerDown = (
    event: ReactPointerEvent,
    segment: VisualTimelineSegment,
    mode: DragMode,
  ) => {
    if (disabled || !onChange || !isEditableSegment(segment)) return;
    event.preventDefault();
    event.stopPropagation();
    setDragState({
      mode,
      segmentId: segment.id,
      startClientX: event.clientX,
      original: segment,
    });
    handleSelectSegment(segment);
  };

  useEffect(() => {
    if (!dragState) return;

    const handleMove = (event: PointerEvent) => {
      const deltaFrames = Math.round((event.clientX - dragState.startClientX) / pxPerFrame);
      const original = dragState.original;
      let nextSeekFrame = original.startFrame;
      commitSegment(dragState.segmentId, () => {
        if (dragState.mode === "move") {
          const duration = original.durationInFrames;
          const startFrame = clampFrame(
            original.startFrame + deltaFrames,
            Math.max(0, timeline.durationInFrames - duration),
          );
          nextSeekFrame = startFrame;
          return {
            ...original,
            startFrame,
            endFrame: startFrame + duration,
            durationInFrames: duration,
          };
        }

        if (dragState.mode === "start") {
          const startFrame = clampFrame(original.startFrame + deltaFrames, original.endFrame - 1);
          nextSeekFrame = startFrame;
          return {
            ...original,
            startFrame,
            durationInFrames: original.endFrame - startFrame,
          };
        }

        const endFrame = Math.max(
          original.startFrame + 1,
          clampFrame(original.endFrame + deltaFrames, timeline.durationInFrames),
        );
        nextSeekFrame = endFrame - 1;
        return {
          ...original,
          endFrame,
          durationInFrames: endFrame - original.startFrame,
        };
      });
      onSeekFrame(clampFrame(nextSeekFrame, Math.max(0, timeline.durationInFrames - 1)));
    };

    const handleUp = () => setDragState(null);

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [commitSegment, dragState, onSeekFrame, pxPerFrame, timeline.durationInFrames]);

  const commitNumeric = (field: "start" | "end" | "duration" | "sourceStart" | "sourceEnd", seconds: number) => {
    if (!selectedSegment) return;
    const frame = secondsToFrame(seconds, timeline.fps);
    commitSegment(selectedSegment.id, (segment) => {
      if (field === "start") {
        const startFrame = clampFrame(frame, segment.endFrame - 1);
        onSeekFrame(startFrame);
        return { ...segment, startFrame, durationInFrames: segment.endFrame - startFrame };
      }
      if (field === "end") {
        const endFrame = Math.max(segment.startFrame + 1, clampFrame(frame, timeline.durationInFrames));
        onSeekFrame(clampFrame(endFrame - 1, Math.max(0, timeline.durationInFrames - 1)));
        return { ...segment, endFrame, durationInFrames: endFrame - segment.startFrame };
      }
      if (field === "duration") {
        const durationInFrames = Math.max(1, frame);
        const endFrame = clampFrame(segment.startFrame + durationInFrames, timeline.durationInFrames);
        onSeekFrame(clampFrame(endFrame - 1, Math.max(0, timeline.durationInFrames - 1)));
        return { ...segment, endFrame, durationInFrames: endFrame - segment.startFrame };
      }
      if (segment.trackKind !== "broll" && segment.trackKind !== "avatar") return segment;
      const sourceDuration = Math.max(
        1,
        segment.sourceDurationInFrames ?? segment.sourceEndFrame ?? segment.durationInFrames,
      );
      if (field === "sourceStart") {
        const sourceStartFrame = clampFrame(frame, sourceDuration - 1);
        const sourceEndFrame = Math.max(sourceStartFrame + 1, segment.sourceEndFrame ?? sourceDuration);
        return { ...segment, sourceStartFrame, sourceEndFrame };
      }
      const sourceStartFrame = segment.sourceStartFrame ?? 0;
      const sourceEndFrame = Math.max(sourceStartFrame + 1, clampFrame(frame, sourceDuration));
      return { ...segment, sourceStartFrame, sourceEndFrame };
    });
  };

  if (timeline.tracks.length === 0) {
    return null;
  }

  return (
    <section className="relative z-0 overflow-hidden rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-[#26313D] dark:bg-[#101820]">
      <div className="mb-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#00D4B3]/15 text-[#00A98F] dark:text-[#00D4B3]">
            <Clock className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h4 className="text-sm font-bold text-gray-900 dark:text-white">
              Timeline de ensamblado
            </h4>
            <p className="text-xs text-gray-500 dark:text-slate-400">
              {formatSeconds(currentSeconds)} / {formatSeconds(timeline.durationInSeconds)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => scrollTimelineBy(-Math.max(160, zoomPxPerSecond * 2))}
            disabled={timelineMaxScrollLeft <= 0 || timelineScrollLeft <= 0}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
            title="Mover timeline a la izquierda"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            type="range"
            min={0}
            max={timelineMaxScrollLeft}
            step={1}
            value={Math.min(timelineScrollLeft, timelineMaxScrollLeft)}
            onChange={(event) => setTimelineScrollPosition(Number(event.target.value))}
            disabled={timelineMaxScrollLeft <= 0}
            className="w-28 accent-[#00D4B3] disabled:opacity-40"
            aria-label="Desplazamiento horizontal del timeline"
          />
          <button
            type="button"
            onClick={() => scrollTimelineBy(Math.max(160, zoomPxPerSecond * 2))}
            disabled={timelineMaxScrollLeft <= 0 || timelineScrollLeft >= timelineMaxScrollLeft}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
            title="Mover timeline a la derecha"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setZoomPxPerSecond((value) => Math.max(30, value - 20))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <input
            type="range"
            min={30}
            max={200}
            step={10}
            value={zoomPxPerSecond}
            onChange={(event) => setZoomPxPerSecond(Number(event.target.value))}
            className="w-24 accent-[#00D4B3]"
            aria-label="Zoom del timeline"
          />
          <button
            type="button"
            onClick={() => setZoomPxPerSecond((value) => Math.min(200, value + 20))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="relative z-0 rounded-lg border border-gray-200 bg-gray-50 p-1.5 dark:border-white/10 dark:bg-[#0B1118]">
        <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-2">
          <div className="space-y-1.5">
            <div className="h-7 rounded-md bg-gray-50 dark:bg-[#0B1118]" />
            {timeline.tracks.map((track) => {
              const style = TRACK_STYLES[track.kind];
              const TrackIcon = style.Icon;

              return (
                <div key={track.id} className="flex h-8 items-center">
                  <div
                    className={`inline-flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-xs font-bold shadow-sm ${style.badge}`}
                  >
                    <TrackIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{track.label}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div
            ref={timelineScrollRef}
            onScroll={syncTimelineScrollState}
            className="min-w-0 overflow-x-auto overflow-y-hidden"
          >
            <div
              className="space-y-1.5"
              style={{ width: `${contentWidth}px` }}
            >
              <div
                className="relative h-7 rounded-md bg-white dark:bg-[#101820]"
                style={{ width: `${contentWidth}px` }}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const x = event.clientX - rect.left;
                  onSeekFrame(clampFrame(x / pxPerFrame, timeline.durationInFrames));
                }}
              >
                {rulerTicks.map((tick) => (
                  <div
                    key={tick.seconds}
                    className={`absolute bottom-0 top-0 border-l ${tick.major ? "border-gray-400 dark:border-slate-500" : "border-gray-200 dark:border-white/10"}`}
                    style={{ left: `${tick.seconds * zoomPxPerSecond}px` }}
                  >
                    {tick.major ? (
                      <span className="ml-1 text-[10px] font-semibold text-gray-500 dark:text-slate-400">
                        {tick.seconds}s
                      </span>
                    ) : null}
                  </div>
                ))}
                <div
                  className="pointer-events-none absolute bottom-0 top-0 z-[1] w-px bg-[#00D4B3]"
                  style={{ left: `${playheadLeft}px` }}
                />
              </div>

              {timeline.tracks.map((track) => {
                const style = TRACK_STYLES[track.kind];

                return (
                  <div
                    key={track.id}
                    className="relative h-8 rounded-md bg-white dark:bg-[#101820]"
                    style={{ width: `${contentWidth}px` }}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      const x = event.clientX - rect.left;
                      onSeekFrame(clampFrame(x / pxPerFrame, timeline.durationInFrames));
                    }}
                  >
                    <div
                      className="pointer-events-none absolute bottom-0 top-0 z-[1] w-px bg-[#00D4B3]"
                      style={{ left: `${playheadLeft}px` }}
                    />
                    {track.segments.map((segment) => {
                      const isActive = activeSegmentIds.has(segment.id);
                      const isSelected = selectedSegment?.id === segment.id;
                      const editable = isEditableSegment(segment) && Boolean(onChange) && !disabled;

                      return (
                        <div
                          key={segment.id}
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleSelectSegment(segment);
                          }}
                          onPointerDown={(event) => handlePointerDown(event, segment, "move")}
                          title={`${segment.label}: ${formatSeconds(segment.startFrame / timeline.fps)} - ${formatSeconds(segment.endFrame / timeline.fps)}`}
                          className={`absolute top-1 h-6 overflow-hidden rounded-md px-2 text-left text-[11px] font-semibold text-white shadow-sm transition ${style.bar} ${
                            isActive ? style.activeBar : ""
                          } ${
                            isSelected ? "outline outline-2 outline-offset-1 outline-[#00D4B3]" : ""
                          } ${editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
                          style={getSegmentStyle(segment, pxPerFrame)}
                        >
                          {editable ? (
                            <>
                              <span
                                className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize bg-black/15"
                                onPointerDown={(event) => handlePointerDown(event, segment, "start")}
                              />
                              <span
                                className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize bg-black/15"
                                onPointerDown={(event) => handlePointerDown(event, segment, "end")}
                              />
                            </>
                          ) : null}
                          <span className="block truncate">{segment.label}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {selectedSegment ? (
        <div className="mt-2 grid gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs dark:border-white/10 dark:bg-[#0B1118] md:grid-cols-3 lg:grid-cols-6">
          <label className="space-y-1">
            <span className="font-semibold text-gray-600 dark:text-slate-300">Inicio</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={frameToSeconds(selectedSegment.startFrame, timeline.fps)}
              onChange={(event) => commitNumeric("start", Number(event.target.value))}
              disabled={disabled || !onChange}
              className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-gray-900 dark:border-white/10 dark:bg-[#101820] dark:text-white"
            />
          </label>
          <label className="space-y-1">
            <span className="font-semibold text-gray-600 dark:text-slate-300">Fin</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={frameToSeconds(selectedSegment.endFrame, timeline.fps)}
              onChange={(event) => commitNumeric("end", Number(event.target.value))}
              disabled={disabled || !onChange}
              className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-gray-900 dark:border-white/10 dark:bg-[#101820] dark:text-white"
            />
          </label>
          <label className="space-y-1">
            <span className="font-semibold text-gray-600 dark:text-slate-300">Duracion</span>
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={frameToSeconds(selectedSegment.durationInFrames, timeline.fps)}
              onChange={(event) => commitNumeric("duration", Number(event.target.value))}
              disabled={disabled || !onChange}
              className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-gray-900 dark:border-white/10 dark:bg-[#101820] dark:text-white"
            />
          </label>
          {selectedSegment.trackKind === "broll" || selectedSegment.trackKind === "avatar" ? (
            <>
              <label className="space-y-1">
                <span className="font-semibold text-gray-600 dark:text-slate-300">Recorte inicio</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={frameToSeconds(selectedSegment.sourceStartFrame ?? 0, timeline.fps)}
                  onChange={(event) => commitNumeric("sourceStart", Number(event.target.value))}
                  disabled={disabled || !onChange}
                  className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-gray-900 dark:border-white/10 dark:bg-[#101820] dark:text-white"
                />
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-gray-600 dark:text-slate-300">Recorte fin</span>
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={frameToSeconds(selectedSegment.sourceEndFrame ?? selectedSegment.durationInFrames, timeline.fps)}
                  onChange={(event) => commitNumeric("sourceEnd", Number(event.target.value))}
                  disabled={disabled || !onChange}
                  className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-gray-900 dark:border-white/10 dark:bg-[#101820] dark:text-white"
                />
              </label>
              {selectedSegment.trackKind === "broll" ? (
                <div className="space-y-1">
                  <span className="font-semibold text-gray-600 dark:text-slate-300">Extender</span>
                  <div className="rounded-md border border-gray-200 bg-white px-2 py-1 font-semibold text-gray-700 dark:border-white/10 dark:bg-[#101820] dark:text-slate-200">
                    Loop
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
