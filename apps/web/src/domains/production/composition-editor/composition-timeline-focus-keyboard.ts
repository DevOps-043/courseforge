export function resolveCompositionTimelineFocusKey(input: {
  key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; isComposing: boolean;
}): "MOVE_LEFT" | "MOVE_RIGHT" | "PREVIOUS" | "NEXT" | "FIRST" | "LAST" | "CLEAR" | "TOGGLE" | null {
  if (input.isComposing || input.altKey) return null;
  if ((input.ctrlKey || input.metaKey) && input.key === " " && !input.shiftKey) return "TOGGLE";
  if (input.ctrlKey || input.metaKey) return null;
  if (input.key === "ArrowLeft") return "MOVE_LEFT";
  if (input.key === "ArrowRight") return "MOVE_RIGHT";
  if (input.shiftKey) return null;
  if (input.key === "ArrowUp") return "PREVIOUS";
  if (input.key === "ArrowDown") return "NEXT";
  if (input.key === "Home") return "FIRST";
  if (input.key === "End") return "LAST";
  if (input.key === "Escape") return "CLEAR";
  return null;
}

export function resolveCompositionTimelineFocusIndex(length: number, current: number, action: "PREVIOUS" | "NEXT" | "FIRST" | "LAST"): number | null {
  if (!Number.isSafeInteger(length) || length <= 0 || !Number.isSafeInteger(current) || current < 0 || current >= length) return null;
  if (action === "FIRST") return 0;
  if (action === "LAST") return length - 1;
  return Math.max(0, Math.min(length - 1, current + (action === "PREVIOUS" ? -1 : 1)));
}

export function resolveCompositionTimelineCursorKey(input: {
  key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; isComposing: boolean;
}): "BACKWARD" | "FORWARD" | "START" | "END" | null {
  if (input.isComposing || input.altKey || input.ctrlKey || input.metaKey) return null;
  if (input.key === "ArrowLeft") return "BACKWARD";
  if (input.key === "ArrowRight") return "FORWARD";
  if (input.key === "Home") return "START";
  if (input.key === "End") return "END";
  return null;
}
