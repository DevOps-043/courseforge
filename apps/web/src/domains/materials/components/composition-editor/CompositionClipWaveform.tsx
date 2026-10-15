"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildAudioWaveformPath } from "@/domains/production/audio-processing/audio-waveform-projection.service";
import type { AudioWaveformPreview } from "@/domains/production/audio-processing/audio-processing.types";
import { readWaveformWindow } from "@/domains/production/audio-processing/audio-waveform-window.client";
import { useWaveformViewport } from "./useWaveformViewport";
import { type CompositionVolumeEnvelopePoint } from "@/domains/production/composition-editor/composition-volume-envelope";
import { buildVolumeEnvelopePath } from "@/domains/production/composition-editor/composition-volume-envelope-projection";

export function CompositionClipWaveform({
  clipDurationSeconds,
  sourceOffsetSeconds,
  waveform,
  componentId,
  assetId,
  envelope = [],
  timelineStartSeconds = 0,
}: {
  componentId?: string | null;
  assetId?: string;
  envelope?: CompositionVolumeEnvelopePoint[];
  timelineStartSeconds?: number;
  clipDurationSeconds: number;
  sourceOffsetSeconds: number;
  waveform: AudioWaveformPreview;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const viewport = useWaveformViewport(
    containerRef,
    `${timelineStartSeconds}:${sourceOffsetSeconds}:${clipDurationSeconds}`,
  );
  const width = viewport.width;
  const visibleOffset =
    sourceOffsetSeconds +
    (viewport.totalWidth
      ? (viewport.left / viewport.totalWidth) * clipDurationSeconds
      : 0);
  const visibleDuration = viewport.totalWidth
    ? (width / viewport.totalWidth) * clipDurationSeconds
    : clipDurationSeconds;
  const requestKey = `${componentId}:${assetId}:${waveform.checksum}:${width}:${visibleOffset}:${visibleDuration}`;
  const [windowResult, setWindowResult] = useState<{
    key: string;
    waveform: AudioWaveformPreview;
  } | null>(null);

  useEffect(() => {
    if (
      !componentId ||
      !assetId ||
      !waveform.checksum ||
      width <= 0 ||
      visibleOffset >= waveform.durationSeconds
    )
      return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void readWaveformWindow({
        componentId,
        assetId,
        checksum: waveform.checksum!,
        start: visibleOffset,
        end: Math.min(
          waveform.durationSeconds,
          visibleOffset + visibleDuration,
        ),
        width: Math.min(4096, Math.max(1, Math.ceil(width))),
        signal: controller.signal,
      })
        .then((value) => {
          if (!controller.signal.aborted)
            setWindowResult({ key: requestKey, waveform: value });
        })
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    componentId,
    assetId,
    waveform,
    width,
    visibleOffset,
    visibleDuration,
    requestKey,
  ]);

  const visible =
    windowResult?.key === requestKey ? windowResult.waveform : waveform;
  const paths = useMemo(() => {
    const channels = visible.channels ?? [
      { min: visible.min, max: visible.max },
    ];
    return channels.map((channel) =>
      buildAudioWaveformPath({
        clipDurationSeconds: visibleDuration,
        sourceOffsetSeconds: visibleOffset,
        viewportWidthPixels: width,
        waveform: { ...visible, ...channel },
      }),
    );
  }, [visibleDuration, visibleOffset, visible, width]);
  const viewWidth = Math.min(1024, Math.max(1, Math.ceil(width)));
  const curve = envelope.length
    ? buildVolumeEnvelopePath(
        envelope,
        visibleOffset,
        visibleDuration,
        viewWidth,
      )
    : "";

  return (
    <span
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-2 bottom-1 top-3 overflow-hidden opacity-60"
    >
      {paths.some(Boolean) && (
        <svg
          className="h-full w-full text-current"
          style={{ position: "absolute", left: viewport.left, width }}
          viewBox={`0 0 ${viewWidth} 100`}
          preserveAspectRatio="none"
        >
          {paths.map((path, index) => (
            <g
              key={index}
              transform={`translate(0 ${(index * 100) / paths.length}) scale(1 ${1 / paths.length})`}
            >
              <path d={path} stroke="currentColor" strokeWidth="1" />
            </g>
          ))}
          {curve && (
            <path d={curve} fill="none" stroke="#f59e0b" strokeWidth="2" />
          )}
        </svg>
      )}
    </span>
  );
}
