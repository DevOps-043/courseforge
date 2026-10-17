"use client";

import { useLayoutEffect, type RefObject } from "react";

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 8;

/** Keep menus in the top layer, outside preview clipping, including fullscreen. */
export function useCompositionAnchoredPopover({ open, anchorRef, panelRef, layoutRef }: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  layoutRef: RefObject<HTMLElement | null>;
}) {
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!open || !anchor || !panel) return;

    panel.showPopover();
    const position = () => {
      const bounds = anchor.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const below = Math.max(0, viewportHeight - bounds.bottom - ANCHOR_GAP - VIEWPORT_MARGIN);
      const above = Math.max(0, bounds.top - ANCHOR_GAP - VIEWPORT_MARGIN);
      const placeBelow = below >= panel.scrollHeight || below >= above;
      panel.style.maxHeight = `${placeBelow ? below : above}px`;
      const panelBounds = panel.getBoundingClientRect();
      panel.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(bounds.left, viewportWidth - panelBounds.width - VIEWPORT_MARGIN))}px`;
      panel.style.top = `${placeBelow ? bounds.bottom + ANCHOR_GAP : Math.max(VIEWPORT_MARGIN, bounds.top - ANCHOR_GAP - panelBounds.height)}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(anchor);
    observer.observe(panel);
    // An inspector toggle can move the trigger without changing its own width.
    if (anchor.parentElement) observer.observe(anchor.parentElement);
    if (layoutRef.current) observer.observe(layoutRef.current);
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
      panel.hidePopover();
    };
  }, [open, anchorRef, panelRef, layoutRef]);
}
