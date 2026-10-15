export type CompositionPaletteKeyboardAction = "CLOSE" | "NEXT" | "PREVIOUS" | "RUN" | null;

/** Modal navigation must never replace native Enter activation on a focused button. */
export function resolveCompositionPaletteKeyboardAction(input: {
  key: string;
  isComposing: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  searchFocused: boolean;
}): CompositionPaletteKeyboardAction {
  if (input.isComposing) return null;
  const modifier = input.ctrlKey || input.metaKey;
  if (input.key === "Escape") return "CLOSE";
  if (modifier && !input.altKey && !input.shiftKey && input.key.toLowerCase() === "k") return "CLOSE";
  if (modifier || input.altKey || input.shiftKey) return null;
  if (input.key === "ArrowDown") return "NEXT";
  if (input.key === "ArrowUp") return "PREVIOUS";
  if (input.key === "Enter" && input.searchFocused) return "RUN";
  return null;
}
