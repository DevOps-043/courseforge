"use client";

import { Clock, Film, Music2, UserRound } from "lucide-react";
import {
  getActiveTimelineSegments,
  type VisualTimeline,
  type VisualTimelineSegment,
  type VisualTimelineTrackKind,
} from "@/remotion/visual-timeline";
import type { RemotionEditableLayerId } from "@/remotion/layout-override-styles";

interface RemotionTimelineInspectorProps {
  timeline: VisualTimeline;
  currentFrame: number;
  onSeekFrame: (frame: number) => void;
  selectedLayerId?: RemotionEditableLayerId;
  onSelectedLayerChange?: (layerId: RemotionEditableLayerId) => void;
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

function getSegmentStyle(
  segment: VisualTimelineSegment,
  durationInFrames: number,
) {
  const safeDuration = Math.max(1, durationInFrames);
  const left = (segment.startFrame / safeDuration) * 100;
  const width = (segment.durationInFrames / safeDuration) * 100;

  return {
    left: `${Math.min(100, Math.max(0, left))}%`,
    width: `${Math.min(100 - left, Math.max(1.5, width))}%`,
  };
}

export function RemotionTimelineInspector({
  timeline,
  currentFrame,
  onSeekFrame,
  selectedLayerId,
  onSelectedLayerChange,
}: RemotionTimelineInspectorProps) {
  const clampedFrame = Math.min(
    timeline.durationInFrames - 1,
    Math.max(0, Math.round(currentFrame)),
  );
  const currentSeconds = clampedFrame / timeline.fps;
  const activeSegmentIds = new Set(
    getActiveTimelineSegments(timeline, clampedFrame).map(
      (segment) => segment.id,
    ),
  );
  const playheadLeft =
    (clampedFrame / Math.max(1, timeline.durationInFrames)) * 100;
  const handleSelectSegment = (segment: VisualTimelineSegment) => {
    onSeekFrame(segment.startFrame);
    if (segment.layerId) {
      onSelectedLayerChange?.(segment.layerId);
    }
  };

  if (timeline.tracks.length === 0) {
    return null;
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-[#6C757D]/10 dark:bg-[#151A21]">
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0A2540] text-white">
            <Clock className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h4 className="text-sm font-bold text-gray-900 dark:text-white">
              Timeline de ensamblado
            </h4>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {formatSeconds(currentSeconds)} / {formatSeconds(timeline.durationInSeconds)}
            </p>
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(0, timeline.durationInFrames - 1)}
          value={clampedFrame}
          onChange={(event) => onSeekFrame(Number(event.target.value))}
          className="h-2 min-w-0 flex-1 accent-[#00D4B3] md:max-w-[420px]"
          aria-label="Mover timeline del preview"
        />
      </div>

      <div className="space-y-2">
        {timeline.tracks.map((track) => {
          const style = TRACK_STYLES[track.kind];
          const TrackIcon = style.Icon;

          return (
            <div
              key={track.id}
              className="grid min-w-0 grid-cols-[84px_minmax(0,1fr)] items-center gap-2"
            >
              <div
                className={`inline-flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-2 text-xs font-bold ${style.badge}`}
              >
                <TrackIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{track.label}</span>
              </div>
              <div className="relative h-8 overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-[#6C757D]/10 dark:bg-[#0F1419]">
                <div
                  className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-[#00D4B3]"
                  style={{ left: `${playheadLeft}%` }}
                />
                {track.segments.map((segment) => {
                  const isActive = activeSegmentIds.has(segment.id);
                  const isSelected = Boolean(
                    selectedLayerId && segment.layerId === selectedLayerId,
                  );

                  return (
                    <button
                      key={segment.id}
                      type="button"
                      onClick={() => handleSelectSegment(segment)}
                      title={`${segment.label}: ${formatSeconds(segment.startFrame / timeline.fps)} - ${formatSeconds(segment.endFrame / timeline.fps)}`}
                      className={`absolute top-1 h-6 overflow-hidden rounded-md px-2 text-left text-[11px] font-semibold text-white shadow-sm transition ${style.bar} ${
                        isActive ? style.activeBar : ""
                      } ${
                        isSelected ? "outline outline-2 outline-offset-1 outline-[#00D4B3]" : ""
                      }`}
                      style={getSegmentStyle(segment, timeline.durationInFrames)}
                    >
                      <span className="block truncate">{segment.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
