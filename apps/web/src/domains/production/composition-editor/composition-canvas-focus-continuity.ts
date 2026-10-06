export function resolveCompositionCanvasFocusRestore(input: {
  sameClip: boolean;
  canvasFocused: boolean;
  clipVisible: boolean;
  equivalentControl: boolean;
}): "CONTROL" | "CLIP" | "ROOT" | "NONE" {
  if (!input.canvasFocused || !input.sameClip) return "NONE";
  if (!input.clipVisible) return "ROOT";
  return input.equivalentControl ? "CONTROL" : "CLIP";
}

export function renderCompositionCanvasFocusContinuity(): string {
  return `
      const resolveCanvasFocusRestore = (${resolveCompositionCanvasFocusRestore.toString()});
      const readCanvasControlFocus = () => {
        if (!document.hasFocus()) return null;
        const focused = document.activeElement;
        if (!(focused instanceof HTMLElement) || !root?.contains(focused) || !focused.matches(".composition-editor-control")) return null;
        const hfId = focused.closest("[data-hf-id]")?.dataset.hfId;
        if (!hfId) return null;
        const kind = focused.classList.contains("composition-crop-handle") ? "CROP"
          : focused.classList.contains("composition-resize-handle") ? "RESIZE" : "MOVE";
        return { hfId, kind, edge: focused.dataset.cropEdge || null };
      };
      const canvasClipIsVisible = (target) => {
        if (!(target instanceof HTMLElement) || !targetIsActiveAt(target, currentTime)) return false;
        const style = getComputedStyle(target);
        return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0;
      };
      const restoreCanvasControlFocus = (token, target) => {
        if (!token || !(target instanceof HTMLElement)) return;
        const control = [...target.querySelectorAll(".composition-editor-control")].find((candidate) =>
          token.kind === "CROP" ? candidate.dataset.cropEdge === token.edge
            : candidate.classList.contains(token.kind === "RESIZE" ? "composition-resize-handle" : "composition-move-handle"));
        const decision = resolveCanvasFocusRestore({ sameClip: token.hfId === target.dataset.hfId,
          canvasFocused: document.hasFocus(), clipVisible: canvasClipIsVisible(target), equivalentControl: Boolean(control) });
        if (decision === "NONE") return;
        if (decision === "ROOT") { root.focus({ preventScroll: true }); return; }
        if (decision === "CONTROL") { control.focus({ preventScroll: true }); return; }
        target.setAttribute("tabindex", "-1");
        target.setAttribute("role", "group");
        target.setAttribute("aria-label", target.dataset.editorLabel || target.dataset.hfId);
        target.focus({ preventScroll: true });
      };
      const reconcileCanvasFocus = () => {
        if (!document.hasFocus()) return;
        const focused = document.activeElement;
        if (!(focused instanceof HTMLElement) || !root?.contains(focused)) return;
        const target = focused.closest("[data-hf-id]");
        if (target && !canvasClipIsVisible(target)) root.focus({ preventScroll: true });
      };
      const restoreCanvasFocusAfterReload = (hfId) => {
        if (!document.hasFocus()) return;
        const focused = document.activeElement;
        if (focused !== document.body && focused !== document.documentElement && focused !== root) return;
        const target = typeof hfId === "string" && hfId === selectedHfId
          ? document.querySelector('[data-hf-id="' + CSS.escape(hfId) + '"]') : null;
        if (!canvasClipIsVisible(target)) { root?.focus({ preventScroll: true }); return; }
        target.setAttribute("tabindex", "-1");
        target.setAttribute("role", "group");
        target.setAttribute("aria-label", target.dataset.editorLabel || target.dataset.hfId);
        target.focus({ preventScroll: true });
      };
  `;
}
