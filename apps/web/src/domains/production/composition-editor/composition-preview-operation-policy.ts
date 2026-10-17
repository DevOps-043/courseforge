import type { CompositionEditorPatchOperation } from "./editor-patch.types";

export const COMPOSITION_PREVIEW_UPDATE_STRATEGIES = [
  "LIVE_DOM",
  "LIVE_TIMELINE",
  "FULL_RELOAD",
] as const;

export type CompositionPreviewUpdateStrategy = typeof COMPOSITION_PREVIEW_UPDATE_STRATEGIES[number];

const OPERATION_STRATEGIES: Record<CompositionEditorPatchOperation["type"], CompositionPreviewUpdateStrategy> = {
  "animation.add-preset": "LIVE_TIMELINE",
  "animation.configure-preset": "LIVE_TIMELINE",
  "animation.remove": "LIVE_TIMELINE",
  "animation.insert-path-point": "LIVE_TIMELINE",
  "animation.remove-path-point": "LIVE_TIMELINE",
  "animation.update-keyframe": "LIVE_TIMELINE",
  "animation.update-timing": "LIVE_TIMELINE",
  "audio-mix.update": "LIVE_TIMELINE",
  "clip.add": "LIVE_TIMELINE",
  "clip.audio-fades": "LIVE_TIMELINE",
  "clip.caption-cues": "LIVE_TIMELINE",
  "clip.volume-envelope": "LIVE_TIMELINE",
  "clip.caption-effects": "LIVE_TIMELINE",
  "clip.crop": "LIVE_DOM",
  "clip.color-grading": "LIVE_DOM",
  "clip.duration": "LIVE_TIMELINE",
  "clip.playback-rate": "LIVE_TIMELINE",
  "clip.freeze-tail": "LIVE_TIMELINE",
  "clip.duplicate": "LIVE_TIMELINE",
  "clip.estimated-timing": "LIVE_TIMELINE",
  "clip.layout": "LIVE_DOM",
  "clip.media-fit": "LIVE_DOM",
  "clip.move": "LIVE_TIMELINE",
  "clip.remove": "LIVE_TIMELINE",
  "clip.remove-range": "LIVE_TIMELINE",
  "clip.replace-source": "LIVE_TIMELINE",
  "clip.reset-asset": "LIVE_TIMELINE",
  "clip.split": "LIVE_TIMELINE",
  "clip.template": "LIVE_TIMELINE",
  "clip.text-content": "LIVE_TIMELINE",
  "clip.text-style": "LIVE_TIMELINE",
  "clip.trim": "LIVE_TIMELINE",
  "clip.visibility": "LIVE_DOM",
  "clip.volume": "LIVE_DOM",
  "composition.canvas-duration": "LIVE_TIMELINE",
  "composition.canvas-size": "LIVE_TIMELINE",
  "document.reconcile": "FULL_RELOAD",
  "document.restore": "FULL_RELOAD",
  "group.add-clips": "LIVE_TIMELINE",
  "group.create": "LIVE_TIMELINE",
  "group.move": "LIVE_TIMELINE",
  "group.remove-clips": "LIVE_TIMELINE",
  "group.ungroup": "LIVE_TIMELINE",
  "transition.add": "LIVE_TIMELINE",
  "transition.remove": "LIVE_TIMELINE",
  "transition.update": "LIVE_TIMELINE",
  "track.update": "LIVE_TIMELINE",
};

const STRATEGY_PRIORITY: Record<CompositionPreviewUpdateStrategy, number> = {
  LIVE_DOM: 0,
  LIVE_TIMELINE: 1,
  FULL_RELOAD: 2,
};

/** Unknown operations fail closed to a canonical full preview rebuild. */
export function classifyCompositionPreviewOperation(
  operation: Pick<CompositionEditorPatchOperation, "type"> | { type: string },
): CompositionPreviewUpdateStrategy {
  return OPERATION_STRATEGIES[operation.type as CompositionEditorPatchOperation["type"]] || "FULL_RELOAD";
}

export function classifyCompositionPreviewOperations(
  operations: Array<Pick<CompositionEditorPatchOperation, "type"> | { type: string }>,
): CompositionPreviewUpdateStrategy {
  if (operations.length === 0) return "FULL_RELOAD";
  return operations.reduce<CompositionPreviewUpdateStrategy>((selected, operation) => {
    const candidate = classifyCompositionPreviewOperation(operation);
    return STRATEGY_PRIORITY[candidate] > STRATEGY_PRIORITY[selected] ? candidate : selected;
  }, "LIVE_DOM");
}

/**
 * DOM patches and supported scene projections keep the iframe mounted.
 * Unsupported operations still use the authenticated compiler.
 */
export function requiresCompositionPreviewReload(
  strategy: CompositionPreviewUpdateStrategy,
): boolean {
  return strategy === "FULL_RELOAD";
}
