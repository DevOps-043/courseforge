export const COMPOSITION_EDITOR_SHORTCUTS = ["PALETTE", "UNDO", "REDO", "DUPLICATE", "COPY", "PASTE", "DELETE", "RIPPLE_DELETE", "TIMELINE_LEFT", "TIMELINE_RIGHT"] as const;
export type CompositionEditorShortcut = typeof COMPOSITION_EDITOR_SHORTCUTS[number];

export function acceptsCompositionPreviewShortcut(input: {
  currentFrame: boolean; messageGeneration: number; currentGeneration: number;
  ready: boolean; focused: boolean; modalOpen: boolean; previewOnly: boolean; saving: boolean;
}): boolean {
  return input.currentFrame && input.messageGeneration === input.currentGeneration && input.ready
    && input.focused && !input.modalOpen && !input.previewOnly && !input.saving;
}

/** Self-contained so the iframe and host use exactly the same allowlist. */
export function resolveCompositionEditorShortcut(input: {
  key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean; repeat: boolean;
}): CompositionEditorShortcut | null {
  if (input.isComposing || input.repeat) return null;
  const modifier = input.ctrlKey || input.metaKey;
  if (input.altKey) {
    if (modifier || input.shiftKey) return null;
    return input.key === "ArrowLeft" ? "TIMELINE_LEFT" : input.key === "ArrowRight" ? "TIMELINE_RIGHT" : null;
  }
  if (!modifier) return input.key === "Delete" || input.key === "Backspace" ? input.shiftKey ? "RIPPLE_DELETE" : "DELETE" : null;
  const key = input.key.toLowerCase();
  if (key === "z") return input.shiftKey ? "REDO" : "UNDO";
  if (input.shiftKey) return null;
  return key === "k" ? "PALETTE" : key === "y" ? "REDO" : key === "d" ? "DUPLICATE"
    : key === "c" ? "COPY" : key === "v" ? "PASTE" : null;
}

export function renderCompositionEditorShortcutBridge(): string {
  return `
      const resolveEditorShortcut = (${resolveCompositionEditorShortcut.toString()});
      root?.addEventListener("keydown", (event) => {
        if (event.defaultPrevented || activeTransform || activeMarquee || keyboardTransform || !document.hasFocus()) return;
        const target = event.target;
        if (!(target instanceof HTMLElement) || target.isContentEditable
          || target.closest("input, textarea, select, a, [contenteditable='true'], [role='dialog'], [aria-modal='true']")) return;
        if (target.closest(".composition-editor-control") && event.altKey) return;
        const command = resolveEditorShortcut(event);
        if (!command) return;
        event.preventDefault(); event.stopPropagation();
        postParentMessage({ type: "courseforge-composition-shortcut", command });
      });
  `;
}
