import { COMPOSITION_SHORTCUTS, COMPOSITION_IFRAME_SHORTCUT_ACTIONS } from "./composition-shortcuts";
import { findCompositionShortcut, isCompositionShortcutControl } from "./composition-shortcut-policy";
import { COMPOSITION_PREVIEW_PROTOCOL_VERSION } from "./composition-preview-protocol";

/** Included only by the interactive compiler, inside its controller closure. */
export function buildCompositionPreviewKeyboardRuntime() {
  const definitions = COMPOSITION_SHORTCUTS.filter((entry) => entry.action && COMPOSITION_IFRAME_SHORTCUT_ACTIONS.includes(entry.action));
  return `
    const shortcutDefinitions = ${JSON.stringify(definitions)};
    const findShortcut = (${findCompositionShortcut.toString()});
    const isShortcutControl = (${isCompositionShortcutControl.toString()});
    let shortcutSession = null;
    let shortcutActions = [];
    let shortcutPointerDown = false;
    root?.setAttribute("tabindex", "0");
    root?.setAttribute("aria-label", "Lienzo de composición");
    document.addEventListener("pointerdown", (event) => {
      shortcutPointerDown = true;
      if (!isShortcutControl(event.target)) root?.focus({ preventScroll: true });
    }, true);
    document.addEventListener("pointerup", () => { shortcutPointerDown = false; }, true);
    document.addEventListener("pointercancel", () => { shortcutPointerDown = false; }, true);
    window.addEventListener("blur", () => { shortcutPointerDown = false; });
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.type !== "courseforge-composition-shortcut-settings" || message.protocolVersion !== ${COMPOSITION_PREVIEW_PROTOCOL_VERSION}) return;
      if (typeof message.sessionId !== "string" || !/^[a-f0-9-]{36}$/i.test(message.sessionId) || !Array.isArray(message.actions)) return;
      shortcutSession = message.sessionId;
      shortcutActions = message.actions.filter((action) => shortcutDefinitions.some((entry) => entry.action === action));
    });
    document.addEventListener("keydown", (event) => {
      if (!shortcutSession || window.parent === window || shortcutPointerDown || activeTransform || isShortcutControl(event.target)) return;
      const shortcut = findShortcut(event, "preview", shortcutDefinitions);
      if (!shortcut || !shortcutActions.includes(shortcut.action)) return;
      event.preventDefault();
      if (event.repeat && !shortcut.repeat) return;
      postParentMessage({ type: "courseforge-composition-shortcut", sessionId: shortcutSession, action: shortcut.action });
    });
  `;
}
