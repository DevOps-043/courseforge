"use client";

import { useEffect, useRef, useState } from "react";
import { resolveCompositionPreviewCanvasBounds } from "@/domains/production/composition-editor/composition-preview-viewport-geometry";
import styles from "./CompositionStudio.module.css";

export function CompositionSafeAreaOverlay({ canvasWidth, canvasHeight, zoom }: {
  canvasWidth: number;
  canvasHeight: number;
  zoom: number;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const frame = overlayRef.current?.parentElement;
    if (!frame) return;
    const measure = () => {
      const width = frame.clientWidth;
      const height = frame.clientHeight;
      setViewportSize((previous) => previous.width === width && previous.height === height ? previous : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const bounds = resolveCompositionPreviewCanvasBounds({
    canvasWidth, canvasHeight, viewportWidth: viewportSize.width, viewportHeight: viewportSize.height, zoom,
  });
  return <div ref={overlayRef} aria-hidden="true" className={styles.safeAreaOverlay} style={bounds
    ? { left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }
    : { visibility: "hidden" }}>
    <span className={styles.safeActionArea} />
    <span className={styles.safeTitleArea} />
    <span className={styles.safeCenterHorizontal} />
    <span className={styles.safeCenterVertical} />
  </div>;
}
