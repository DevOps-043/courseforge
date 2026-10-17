export type CompositionTimelineKeyboardEditMode = "ROLL_LEFT" | "ROLL_RIGHT" | "SLIDE";
export type CompositionTimelinePointerBaseGesture = "move" | "trim-end" | "trim-start";
export type CompositionTimelinePointerGesture = CompositionTimelinePointerBaseGesture | "roll-left" | "roll-right" | "slide";

export type CompositionTimelineKeyboardCommand =
  | { deltaFrames: number; type: "SLIDE" }
  | { deltaFrames: number; edge: "LEFT" | "RIGHT"; type: "ROLL" };

export function resolveCompositionTimelinePointerGesture(
  baseGesture: CompositionTimelinePointerBaseGesture,
  altKey: boolean,
): CompositionTimelinePointerGesture {
  if (!altKey) return baseGesture;
  if (baseGesture === "move") return "slide";
  return baseGesture === "trim-start" ? "roll-left" : "roll-right";
}

export function resolveCompositionTimelineKeyboardCommand(params: {
  altKey: boolean;
  ctrlKey: boolean;
  frameStep: number;
  hasSelection: boolean;
  key: string;
  metaKey: boolean;
  mode: CompositionTimelineKeyboardEditMode;
}): CompositionTimelineKeyboardCommand | null {
  if (
    !params.altKey
    || params.ctrlKey
    || params.metaKey
    || !params.hasSelection
    || (params.key !== "ArrowLeft" && params.key !== "ArrowRight")
  ) return null;
  const frameStep = clampCompositionTimelineFrameStep(params.frameStep);
  const deltaFrames = (params.key === "ArrowLeft" ? -1 : 1) * frameStep;
  if (params.mode === "SLIDE") return { deltaFrames, type: "SLIDE" };
  return {
    deltaFrames,
    edge: params.mode === "ROLL_LEFT" ? "LEFT" : "RIGHT",
    type: "ROLL",
  };
}

export function clampCompositionTimelineFrameStep(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(300, Math.round(value)));
}
