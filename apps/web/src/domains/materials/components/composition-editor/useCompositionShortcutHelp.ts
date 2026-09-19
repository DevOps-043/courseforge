"use client";

import { useRef, type RefObject } from "react";
import type { CompositionInspectorTab } from "./CompositionInspectorTabs";

export function useCompositionShortcutHelp({ tab, inspectorOpen, setTab, setOpen, fallbackRef }: {
  tab: CompositionInspectorTab;
  inspectorOpen: boolean;
  setTab: (tab: CompositionInspectorTab) => void;
  setOpen: (open: boolean) => void;
  fallbackRef: RefObject<HTMLDivElement | null>;
}) {
  const previous = useRef<{ tab: CompositionInspectorTab; open: boolean; focus: Element | null } | null>(null);
  const openShortcuts = () => {
    if (tab !== "shortcuts") previous.current = { tab, open: inspectorOpen, focus: document.activeElement };
    setOpen(true);
    setTab("shortcuts");
  };
  const closeShortcuts = () => {
    const origin = previous.current;
    setTab(origin?.tab ?? "properties");
    setOpen(origin?.open ?? false);
    previous.current = null;
    requestAnimationFrame(() => {
      const previousTab = origin?.focus?.getAttribute("role") === "tab"
        ? origin.focus.closest("[role='tablist']")?.querySelector<HTMLElement>("[aria-selected='true']")
        : null;
      const target = previousTab ?? (origin?.focus instanceof HTMLElement && origin.focus.isConnected ? origin.focus : fallbackRef.current);
      target?.focus({ preventScroll: true });
    });
  };
  return { openShortcuts, closeShortcuts, changeInspectorTab: (next: CompositionInspectorTab) => {
    if (next === "shortcuts") openShortcuts();
    else { previous.current = null; setTab(next); }
  } };
}
