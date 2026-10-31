"use client";

import { useEffect, useRef, useState } from "react";
import { COMPOSITION_PREVIEW_ZOOM } from "@/domains/production/composition-editor/composition-preview-view.config";
import { useCompositionAnchoredPopover } from "./useCompositionAnchoredPopover";
import styles from "./CompositionStudio.module.css";

export function CompositionPreviewZoomControls({ value, onZoom }: { value: number; onZoom: (delta: number) => void }) {
  const [open, setOpen] = useState(false);
  const [percent, setPercent] = useState(String(Math.round(value * 100)));
  const anchor = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null);
  useEffect(() => setPercent(String(Math.round(value * 100))), [value]);
  useCompositionAnchoredPopover({ open, anchorRef: anchor, panelRef: panel, layoutRef: anchor });
  useEffect(() => {
    if (!open) return;
    const content = panel.current;
    const previous = document.activeElement as HTMLElement | null;
    content?.querySelector("input")?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!content?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); }
    };
    document.addEventListener("pointerdown", closeOutside);
    content?.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      content?.removeEventListener("keydown", closeOnEscape);
      if (content?.contains(document.activeElement) || document.activeElement === document.body) previous?.focus({ preventScroll: true });
    };
  }, [open]);
  const change = (scale: number) => onZoom(scale - value);
  return <div ref={anchor} className={styles.zoomControls}>
    <button type="button" aria-label="Ajustar zoom del monitor" aria-haspopup="dialog" aria-expanded={open}
      title="Zoom del monitor; 100% encaja el lienzo completo" onClick={() => setOpen(current => !current)} className={styles.toolButton}>
      {Math.round(value * 100)}%
    </button>
    {open && <div ref={panel} popover="manual" role="dialog" aria-label="Zoom del monitor" className={`${styles.anchoredPopover} ${styles.zoomPanel} ${styles.keyboardPanel}`}>
      <div className={styles.zoomPanelHeader}><strong>Zoom del monitor</strong><button type="button" onClick={() => setOpen(false)} aria-label="Cerrar zoom">×</button></div>
      <label>Porcentaje <input aria-label="Porcentaje de zoom" type="number" step="1" min={COMPOSITION_PREVIEW_ZOOM.minimum * 100}
        max={COMPOSITION_PREVIEW_ZOOM.maximum * 100} value={percent} onChange={event => {
          setPercent(event.target.value);
          const scale = event.target.valueAsNumber / 100;
          if (Number.isFinite(scale) && scale >= COMPOSITION_PREVIEW_ZOOM.minimum && scale <= COMPOSITION_PREVIEW_ZOOM.maximum) change(scale);
        }} onBlur={() => setPercent(String(Math.round(value * 100)))} /></label>
      <input type="range" aria-label="Zoom del monitor" min={COMPOSITION_PREVIEW_ZOOM.minimum} max={COMPOSITION_PREVIEW_ZOOM.maximum}
        step={COMPOSITION_PREVIEW_ZOOM.step} value={value} onChange={event => change(event.target.valueAsNumber)} />
      <div className={styles.zoomPresets}>{COMPOSITION_PREVIEW_ZOOM.presets.map(scale => <button type="button" key={scale}
        aria-pressed={value === scale} onClick={() => change(scale)}>{Math.round(scale * 100)}%</button>)}</div>
      <button type="button" onClick={() => change(COMPOSITION_PREVIEW_ZOOM.fit)} className={styles.zoomFit}>Encajar lienzo</button>
      <p>Amplía la vista alrededor del centro. «Encajar lienzo» vuelve a mostrarlo completo.</p>
    </div>}
  </div>;
}
