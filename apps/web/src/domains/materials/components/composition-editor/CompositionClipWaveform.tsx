"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildAudioWaveformPath } from "@/domains/production/audio-processing/audio-waveform-projection.service";
import type { AudioWaveformPreview } from "@/domains/production/audio-processing/audio-processing.types";

export function CompositionClipWaveform({
  clipDurationSeconds,
  sourceOffsetSeconds,
  waveform,
}: {
  clipDurationSeconds: number;
  sourceOffsetSeconds: number;
  waveform: AudioWaveformPreview;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const path = useMemo(() => buildAudioWaveformPath({
    clipDurationSeconds,
    sourceOffsetSeconds,
    viewportWidthPixels: width,
    waveform,
  }), [clipDurationSeconds, sourceOffsetSeconds, waveform, width]);

  return <span ref={containerRef} aria-hidden="true" className="pointer-events-none absolute inset-x-2 bottom-1 top-3 overflow-hidden opacity-60">
    {path && <svg className="h-full w-full text-current" viewBox={`0 0 ${Math.min(1024, Math.max(1, Math.ceil(width)))} 100`} preserveAspectRatio="none"><path d={path} stroke="currentColor" strokeWidth="1" /></svg>}
  </span>;
}
