"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { COMPOSITION_IFRAME_SHORTCUT_ACTIONS, type CompositionShortcutAction, type CompositionShortcutScope } from "@/domains/production/composition-editor/composition-shortcuts";
import { compositionShortcutAvailable, isCompositionShortcutControl, resolveCompositionShortcut } from "@/domains/production/composition-editor/composition-shortcut-policy";
import { createCompositionPreviewParentCommand, parseCompositionPreviewIframeMessage } from "@/domains/production/composition-editor/composition-preview-protocol";

interface ShortcutOptions {
  rootRef: RefObject<HTMLDivElement | null>;
  frameRef: RefObject<HTMLIFrameElement | null>;
  previewUrl: string | null;
  blocked: boolean;
  transportEnabled: boolean;
  execute: (action: CompositionShortcutAction) => void;
}

function modalIsOpen() {
  return Boolean(document.querySelector("dialog[open], [role='dialog'][aria-modal='true']:not([hidden])"));
}

export function useCompositionKeyboardShortcuts(options: ShortcutOptions) {
  const current = useRef(options);
  const session = useRef<string | null>(null);
  const pointerDown = useRef(false);

  const sendSettings = () => {
    const state = current.current;
    if (!session.current) return;
    const actions = state.blocked || pointerDown.current || modalIsOpen() ? [] : COMPOSITION_IFRAME_SHORTCUT_ACTIONS.filter((action) => compositionShortcutAvailable(action, state.transportEnabled));
    state.frameRef.current?.contentWindow?.postMessage(createCompositionPreviewParentCommand({
      type: "courseforge-composition-shortcut-settings", sessionId: session.current, actions,
    }), "*");
  };

  useLayoutEffect(() => { current.current = options; });
  useLayoutEffect(() => { session.current = null; }, [options.previewUrl]);
  useEffect(() => { sendSettings(); }, [options.blocked, options.transportEnabled]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = current.current;
      if (state.blocked || pointerDown.current || modalIsOpen() || isCompositionShortcutControl(event.target)) return;
      const target = event.target as Element;
      const surface = target.closest<HTMLElement>("[data-composition-shortcut-scope]");
      if (!surface || !state.rootRef.current?.contains(surface)) return;
      const scope = surface.dataset.compositionShortcutScope as CompositionShortcutScope;
      const shortcut = resolveCompositionShortcut(event, scope);
      if (!shortcut?.action || !compositionShortcutAvailable(shortcut.action, state.transportEnabled)) return;
      event.preventDefault();
      if (!event.repeat || shortcut.repeat) state.execute(shortcut.action);
    };
    const onMessage = (event: MessageEvent) => {
      const state = current.current;
      if (event.source !== state.frameRef.current?.contentWindow || state.blocked || pointerDown.current || modalIsOpen()) return;
      const message = parseCompositionPreviewIframeMessage(event.data);
      if (message?.type !== "courseforge-composition-shortcut" || message.sessionId !== session.current) return;
      if (document.activeElement !== state.frameRef.current || !COMPOSITION_IFRAME_SHORTCUT_ACTIONS.includes(message.action)) return;
      if (compositionShortcutAvailable(message.action, state.transportEnabled)) state.execute(message.action);
    };
    const onPointerDown = (event: PointerEvent) => {
      pointerDown.current = true;
      sendSettings();
      if (isCompositionShortcutControl(event.target)) return;
      const ruler = (event.target as Element).closest<HTMLElement>("[data-composition-time-ruler]");
      if (ruler && current.current.rootRef.current?.contains(ruler)) { ruler.focus({ preventScroll: true }); return; }
      const surface = (event.target as Element).closest<HTMLElement>("[data-composition-shortcut-scope]");
      if (surface && current.current.rootRef.current?.contains(surface)) surface.focus({ preventScroll: true });
    };
    const releasePointer = () => { pointerDown.current = false; sendSettings(); };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", releasePointer, true);
    document.addEventListener("pointercancel", releasePointer, true);
    window.addEventListener("blur", releasePointer);
    window.addEventListener("message", onMessage);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", releasePointer, true);
      document.removeEventListener("pointercancel", releasePointer, true);
      window.removeEventListener("blur", releasePointer);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  return {
    onPreviewLoad: () => {
      session.current = crypto.randomUUID();
      sendSettings();
    },
  };
}
