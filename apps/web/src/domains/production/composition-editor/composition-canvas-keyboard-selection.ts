export function resolveCompositionCanvasKeyboardSelection(input: {
  key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean;
  eligibleIds: string[]; selectedIds: string[]; focusedId: string | null;
}): { selectedIds: string[]; focusedId: string | null } | null {
  if (input.isComposing || input.altKey) return null;
  const ids = [...new Set(input.eligibleIds)];
  const selected = new Set(input.selectedIds.filter((id) => ids.includes(id)).slice(0, 100));
  const modifier = input.ctrlKey || input.metaKey;
  if (modifier && input.key.toLowerCase() === "a" && !input.shiftKey) {
    const selectedIds = ids.slice(0, 100);
    return { selectedIds, focusedId: selectedIds[0] || null };
  }
  if (input.key === "Escape" && !modifier) return { selectedIds: [], focusedId: null };
  if (modifier && input.key !== " ") return null;
  const current = input.focusedId ? ids.indexOf(input.focusedId) : -1;
  if (input.key === " ") {
    if (current < 0) return null;
    const id = ids[current];
    if (selected.has(id)) selected.delete(id);
    else if (selected.size < 100) selected.add(id);
    return { selectedIds: [...selected], focusedId: id };
  }
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(input.key)) return null;
  if (!ids.length) return { selectedIds: [], focusedId: null };
  const index = input.key === "Home" ? 0 : input.key === "End" ? ids.length - 1
    : current < 0 ? input.key === "ArrowUp" ? ids.length - 1 : 0
    : Math.max(0, Math.min(ids.length - 1, current + (input.key === "ArrowUp" ? -1 : 1)));
  const id = ids[index];
  if (!input.shiftKey) return { selectedIds: [id], focusedId: id };
  if (selected.size < 100) selected.add(id);
  return { selectedIds: [...selected], focusedId: id };
}

/** Only selection messages are emitted. Keyboard editing remains owned by the parent editor. */
export function renderCompositionCanvasKeyboardSelection(): string {
  return `
      const resolveCanvasKeyboardSelection = (${resolveCompositionCanvasKeyboardSelection.toString()});
      root?.setAttribute("tabindex", "0");
      root?.setAttribute("role", "group");
      root?.setAttribute("aria-label", "Canvas: arriba/abajo recorrer, Shift ampliar selección, Espacio alternar, Escape limpiar");
      root?.addEventListener("keydown", (event) => {
        if (event.defaultPrevented || activeTransform || activeMarquee || playbackActive) return;
        const eventTarget = event.target;
        if (!(eventTarget instanceof HTMLElement) || eventTarget.isContentEditable
          || eventTarget.closest("button, input, textarea, select, a, [contenteditable='true']")) return;
        const targets = [...root.querySelectorAll("[data-hf-id]")].filter((candidate) => {
          if (!(candidate instanceof HTMLElement) || !targetIsActiveAt(candidate, currentTime)) return false;
          const style = getComputedStyle(candidate);
          return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0;
        });
        const eligibleIds = targets.map((target) => target.dataset.hfId);
        const focusedId = eventTarget.closest("[data-hf-id]")?.dataset.hfId || selectedHfId;
        const decision = resolveCanvasKeyboardSelection({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
          altKey: event.altKey, shiftKey: event.shiftKey, isComposing: event.isComposing,
          eligibleIds, selectedIds: [...selectedHfIds], focusedId });
        if (!decision) return;
        event.preventDefault();
        event.stopPropagation();
        const focusedTarget = targets.find((target) => target.dataset.hfId === decision.focusedId);
        const primaryTarget = decision.selectedIds.includes(decision.focusedId) ? focusedTarget
          : targets.find((target) => target.dataset.hfId === decision.selectedIds.at(-1));
        if (primaryTarget) selectTarget(primaryTarget, "PREVIEW", decision.selectedIds);
        else clearTarget();
        if (focusedTarget) {
          focusedTarget.setAttribute("tabindex", "-1");
          focusedTarget.setAttribute("role", "group");
          focusedTarget.setAttribute("aria-label", focusedTarget.dataset.editorLabel || focusedTarget.dataset.hfId);
          focusedTarget.focus({ preventScroll: true });
        } else root.focus({ preventScroll: true });
      });
  `;
}
