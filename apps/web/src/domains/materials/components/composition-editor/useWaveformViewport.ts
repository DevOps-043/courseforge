"use client";
import { useEffect, useState, type RefObject } from "react";

/** Measure only the portion visible inside the timeline's horizontal viewport. */
export function useWaveformViewport(
  ref: RefObject<HTMLSpanElement | null>,
  positionVersion: string,
) {
  const [window, setWindow] = useState({ totalWidth: 0, left: 0, width: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const viewport = element.closest<HTMLElement>(
      "[data-composition-timeline-viewport]",
    );
    let frame = 0;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      const visible = viewport?.getBoundingClientRect() ?? bounds;
      const left = Math.max(0, visible.left - bounds.left);
      const width = Math.max(
        0,
        Math.min(bounds.right, visible.right) -
          Math.max(bounds.left, visible.left),
      );
      setWindow((previous) =>
        previous.totalWidth === bounds.width &&
        previous.left === left &&
        previous.width === width
          ? previous
          : { totalWidth: bounds.width, left, width },
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    if (viewport) observer.observe(viewport);
    viewport?.addEventListener("scroll", schedule, { passive: true });
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      viewport?.removeEventListener("scroll", schedule);
    };
  }, [ref, positionVersion]);
  return window;
}
