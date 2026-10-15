"use client";

import { useEffect, useRef, type RefObject } from "react";
import { installCompositionPanelKeyboard, type CompositionKeyboardPanelKind } from "@/domains/production/composition-editor/composition-panel-keyboard";

export function useCompositionPanelFocus(input: {
  open: boolean; panelRef: RefObject<HTMLElement | null>; kind: CompositionKeyboardPanelKind;
  onClose: () => void; canClose?: boolean;
}) {
  const callbacks = useRef(input);
  callbacks.current = input;
  const { open, panelRef, kind } = input;
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    return installCompositionPanelKeyboard(panel, { kind,
      canClose: () => callbacks.current.canClose !== false,
      onClose: () => callbacks.current.onClose() });
  }, [open, panelRef, kind]);
}
