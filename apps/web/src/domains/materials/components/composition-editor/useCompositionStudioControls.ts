"use client";

import { COMPOSITION_PREVIEW_ZOOM, COMPOSITION_STUDIO_PANES, normalizeCompositionPreviewZoom } from "@/domains/production/composition-editor/composition-preview-view.config";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export function useCompositionStudioControls() {
  const previewShellRef = useRef<HTMLDivElement | null>(null);
  const studioGridRef = useRef<HTMLDivElement | null>(null);
  const toolMenuRef = useRef<HTMLDivElement | null>(null);
  const [directEditingEnabled, setDirectEditingEnabled] = useState(true);
  const [gridVisible, setGridVisible] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [previewZoom, setPreviewZoom] = useState<number>(COMPOSITION_PREVIEW_ZOOM.fit);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [trimToolEnabled, setTrimToolEnabled] = useState(false);
  const [visualCropEnabled, setVisualCropEnabled] = useState(false);
  const [studioTopPanePercent, setStudioTopPanePercent] = useState<number>(COMPOSITION_STUDIO_PANES.initial);
  const [monitorExpanded, setMonitorExpanded] = useState(false);
  const previousPanePercent = useRef<number>(COMPOSITION_STUDIO_PANES.initial);
  const [studioResizing, setStudioResizing] = useState(false);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);

  useEffect(() => {
    if (!toolMenuOpen) return;
    const closeOnPointerDown = (event: globalThis.PointerEvent) => {
      if (!toolMenuRef.current?.contains(event.target as Node)) setToolMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setToolMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [toolMenuOpen]);

  const resizeStudioPanes = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!studioResizing) return;
    const grid = studioGridRef.current;
    if (!grid) return;
    const bounds = grid.getBoundingClientRect();
    const nextPercent = ((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 100;
    setStudioTopPanePercent(Math.max(COMPOSITION_STUDIO_PANES.minimum, Math.min(COMPOSITION_STUDIO_PANES.maximum, nextPercent)));
  };

  const finishStudioResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!studioResizing) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setStudioResizing(false);
  };

  const changePreviewZoom = (delta: number) => {
    setPreviewZoom((current) => normalizeCompositionPreviewZoom(current + delta));
  };

  const toggleMonitorExpanded = () => {
    if (monitorExpanded) setStudioTopPanePercent(previousPanePercent.current);
    else { previousPanePercent.current = studioTopPanePercent; setStudioTopPanePercent(COMPOSITION_STUDIO_PANES.expanded); }
    setMonitorExpanded(!monitorExpanded);
  };

  const togglePreviewFullscreen = async () => {
    try {
      if (document.fullscreenElement === previewShellRef.current) await document.exitFullscreen();
      else await previewShellRef.current?.requestFullscreen();
    } catch {
      setPreviewFullscreen(false);
    }
  };

  return {
    changePreviewZoom,
    monitorExpanded,
    toggleMonitorExpanded,
    directEditingEnabled,
    finishStudioResize,
    gridVisible,
    previewFullscreen,
    previewShellRef,
    previewZoom,
    resizeStudioPanes,
    setDirectEditingEnabled,
    setGridVisible,
    setPreviewFullscreen,
    setSnapEnabled,
    setStudioResizing,
    setStudioTopPanePercent,
    setToolMenuOpen,
    setTrimToolEnabled,
    setVisualCropEnabled,
    snapEnabled,
    studioGridRef,
    studioResizing,
    studioTopPanePercent,
    togglePreviewFullscreen,
    toolMenuOpen,
    toolMenuRef,
    trimToolEnabled,
    visualCropEnabled,
  };
}
