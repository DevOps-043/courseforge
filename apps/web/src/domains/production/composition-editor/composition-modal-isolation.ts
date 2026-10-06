type ModalEntry = { panel: HTMLElement; focusInside: () => void };
type PriorAttributes = { inert: string | null; ariaHidden: string | null };
type ModalIsolationState = {
  entries: ModalEntry[];
  blocked: Map<Element, PriorAttributes>;
  observer: MutationObserver | null;
  focusListener: (event: FocusEvent) => void;
};
const modalStates = new WeakMap<Document, ModalIsolationState>();

function topModal(state: ModalIsolationState) {
  return state.entries.filter((entry) => entry.panel.isConnected).at(-1);
}

function restoreBackground(state: ModalIsolationState) {
  for (const [element, prior] of state.blocked) {
    // Preserve intervening changes made by another owner instead of overwriting them.
    if (element.getAttribute("inert") === "") {
      if (prior.inert === null) element.removeAttribute("inert"); else element.setAttribute("inert", prior.inert);
    }
    if (element.getAttribute("aria-hidden") === "true") {
      if (prior.ariaHidden === null) element.removeAttribute("aria-hidden"); else element.setAttribute("aria-hidden", prior.ariaHidden);
    }
  }
  state.blocked.clear();
}

function reconcileModalBackground(owner: Document, state: ModalIsolationState) {
  restoreBackground(state);
  const active = topModal(state);
  if (!active) return;
  // A newly mounted modal may initially be inside a branch blocked by the previous modal.
  if (owner.hasFocus() && !active.panel.contains(owner.activeElement)) active.focusInside();
  let branch: Element = active.panel;
  // Block sibling branches, never an ancestor of the active modal or the whole body.
  while (branch !== owner.body && branch.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (sibling === branch) continue;
      state.blocked.set(sibling, { inert: sibling.getAttribute("inert"), ariaHidden: sibling.getAttribute("aria-hidden") });
      sibling.setAttribute("inert", "");
      sibling.setAttribute("aria-hidden", "true");
    }
    branch = branch.parentElement;
  }
}

/** Per-document modal stack. Exact prior attributes are restored, including out-of-order disposal. */
export function installCompositionModalIsolation(panel: HTMLElement, focusInside: () => void): () => void {
  const owner = panel.ownerDocument;
  let state = modalStates.get(owner);
  if (!state) {
    const initial: ModalIsolationState = { entries: [], blocked: new Map(), observer: null, focusListener: () => {} };
    initial.focusListener = (event) => {
      const active = topModal(initial);
      if (active && owner.hasFocus() && !active.panel.contains(event.target as Node)) active.focusInside();
    };
    owner.addEventListener("focusin", initial.focusListener, true);
    const Observer = owner.defaultView?.MutationObserver;
    if (Observer) {
      initial.observer = new Observer(() => reconcileModalBackground(owner, initial));
      initial.observer.observe(owner.body, { childList: true, subtree: true });
    }
    modalStates.set(owner, initial);
    state = initial;
  }
  const entry = { panel, focusInside };
  state.entries.push(entry);
  reconcileModalBackground(owner, state);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    state.entries = state.entries.filter((candidate) => candidate !== entry);
    reconcileModalBackground(owner, state);
    if (state.entries.length) return;
    state.observer?.disconnect();
    owner.removeEventListener("focusin", state.focusListener, true);
    modalStates.delete(owner);
  };
}
