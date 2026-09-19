"use client";

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { CompositionShortcutsPanel } from "./CompositionShortcutsPanel";
import styles from "./CompositionStudio.module.css";

export type CompositionInspectorTab = "properties" | "assistant" | "shortcuts";
const TABS = [{ id: "properties", label: "Propiedades" }, { id: "assistant", label: "SofLIA" }, { id: "shortcuts", label: "Atajos" }] as const;

function subscribeFullscreen(listener: () => void) {
  document.addEventListener("fullscreenchange", listener);
  return () => document.removeEventListener("fullscreenchange", listener);
}
const getFullscreenElement = () => document.fullscreenElement;
const noFullscreenElement = () => null;

export function CompositionInspectorTabs({ tab, onTabChange, onClose, onCloseShortcuts, open, properties, assistant, fullscreen }: {
  tab: CompositionInspectorTab;
  onTabChange: (tab: CompositionInspectorTab) => void;
  onClose: () => void;
  onCloseShortcuts: () => void;
  open: boolean;
  properties: ReactNode;
  assistant: ReactNode;
  fullscreen: boolean;
}) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const fullscreenElement = useSyncExternalStore(subscribeFullscreen, getFullscreenElement, noFullscreenElement);
  const showOverlay = tab === "shortcuts" && open && fullscreen;
  useEffect(() => {
    if (tab === "shortcuts" && open && (showOverlay || document.activeElement?.getAttribute("role") !== "tab")) {
      (showOverlay ? overlayRef.current : panelRef.current)?.focus();
    }
  }, [tab, open, showOverlay, fullscreenElement]);
  const closeHelpOnEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || tab !== "shortcuts") return;
    event.preventDefault();
    event.stopPropagation();
    onCloseShortcuts();
  };
  return <>
    <aside className={styles.inspector} hidden={!open || showOverlay} style={!open || showOverlay ? { display: "none" } : undefined} onKeyDown={closeHelpOnEscape}>
      <div className={styles.inspectorHeader}>
        <div className={styles.inspectorTabs} role="tablist" aria-label="Panel del editor">
          {TABS.map((entry, index) => <button key={entry.id} id={`${id}-${entry.id}-tab`} role="tab" type="button" aria-selected={tab === entry.id} aria-controls={`${id}-${entry.id}`} tabIndex={tab === entry.id ? 0 : -1}
            className={`${styles.inspectorTab} ${tab === entry.id ? styles.inspectorTabActive : ""}`} onClick={() => onTabChange(entry.id)}
            onKeyDown={(event) => {
              const next = event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
              if (next === null) return;
              event.preventDefault();
              onTabChange(TABS[next].id);
              document.getElementById(`${id}-${TABS[next].id}-tab`)?.focus();
            }}>{entry.label}</button>)}
        </div>
        <button type="button" onClick={tab === "shortcuts" ? onCloseShortcuts : onClose} className={styles.inspectorClose} aria-label={tab === "shortcuts" ? "Cerrar atajos" : "Cerrar inspector"}><X size={15} /></button>
      </div>
      <div className={styles.inspectorBody}>
        <div id={`${id}-properties`} role="tabpanel" aria-labelledby={`${id}-properties-tab`} hidden={tab !== "properties"}>{properties}</div>
        <div id={`${id}-assistant`} role="tabpanel" aria-labelledby={`${id}-assistant-tab`} hidden={tab !== "assistant"}>{assistant}</div>
        <div ref={panelRef} tabIndex={-1} id={`${id}-shortcuts`} role="tabpanel" aria-labelledby={`${id}-shortcuts-tab`} hidden={tab !== "shortcuts"}>{!showOverlay && <CompositionShortcutsPanel />}</div>
      </div>
    </aside>
    {showOverlay && fullscreenElement && createPortal(<div ref={overlayRef} tabIndex={-1} className={styles.shortcutsOverlay} role="region" aria-label="Atajos de teclado" onKeyDown={closeHelpOnEscape}>
      <button type="button" onClick={onCloseShortcuts} aria-label="Cerrar atajos" className={styles.inspectorClose}><X size={18} /></button>
      <CompositionShortcutsPanel />
    </div>, fullscreenElement)}
  </>;
}
