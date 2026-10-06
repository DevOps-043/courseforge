export type CompositionKeyboardPanelKind = "MENU" | "POPOVER" | "MODAL";

/** Installs focus lifecycle without changing the document, selection or save pipeline. */
export function installCompositionPanelKeyboard(panel: HTMLElement, options: {
  kind: CompositionKeyboardPanelKind;
  onClose: () => void;
  canClose: () => boolean;
}): () => void {
  const owner = panel.ownerDocument;
  const previous = owner.activeElement as HTMLElement | null;
  const focusable = () => [...panel.querySelectorAll<HTMLElement>(
    "button, input, select, textarea, a[href], [tabindex]",
  )].filter((element) => !element.matches(":disabled, [tabindex='-1']")
    && !element.closest("[hidden], [inert], [aria-hidden='true']") && element.getClientRects().length > 0);
  let restoreFocus = true;
  let closing = false;
  const requestClose = () => {
    if (closing || !options.canClose()) return;
    closing = true;
    options.onClose();
  };
  (focusable()[0] || panel).focus({ preventScroll: true });
  const releaseIsolation = options.kind === "MODAL"
    ? installCompositionModalIsolation(panel, () => (focusable()[0] || panel).focus({ preventScroll: true }))
    : null;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (event.key === "Escape" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); event.stopPropagation();
      requestClose();
      return;
    }
    const elements = focusable();
    const index = elements.indexOf(owner.activeElement as HTMLElement);
    if (event.key === "Tab") {
      if (options.kind !== "MODAL") {
        if (options.canClose()) { restoreFocus = false; requestClose(); }
        return;
      }
      if (!elements.length) { event.preventDefault(); panel.focus(); return; }
      if (index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === elements.length - 1) {
        event.preventDefault();
        elements[event.shiftKey ? elements.length - 1 : 0].focus();
      }
      event.stopPropagation();
      return;
    }
    if (options.kind !== "MENU" || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) || !elements.length) return;
    event.preventDefault(); event.stopPropagation();
    const next = event.key === "Home" ? 0 : event.key === "End" ? elements.length - 1
      : index < 0 ? event.key === "ArrowUp" ? elements.length - 1 : 0
      : (index + (event.key === "ArrowUp" ? -1 : 1) + elements.length) % elements.length;
    elements[next].focus();
  };
  panel.addEventListener("keydown", onKeyDown);
  return () => {
    panel.removeEventListener("keydown", onKeyDown);
    const ownedFocus = owner.activeElement === owner.body || panel.contains(owner.activeElement);
    releaseIsolation?.();
    if (restoreFocus && previous?.isConnected && owner.hasFocus()
      && !previous.closest("[inert], [aria-hidden='true']")
      && ownedFocus) previous.focus({ preventScroll: true });
  };
}
import { installCompositionModalIsolation } from "./composition-modal-isolation";

