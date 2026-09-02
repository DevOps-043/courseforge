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
  "animation.update-keyframe": "LIVE_TIMELINE",
  "animation.update-timing": "LIVE_TIMELINE",
  "audio-mix.update": "LIVE_TIMELINE",
  "clip.add": "FULL_RELOAD",
  "clip.crop": "LIVE_DOM",
  "clip.duration": "LIVE_TIMELINE",
  "clip.estimated-timing": "LIVE_TIMELINE",
  "clip.layout": "LIVE_DOM",
  "clip.media-fit": "LIVE_DOM",
  "clip.move": "LIVE_TIMELINE",
  "clip.remove": "FULL_RELOAD",
  "clip.remove-range": "FULL_RELOAD",
  "clip.reset-asset": "FULL_RELOAD",
  "clip.split": "FULL_RELOAD",
  "clip.template": "LIVE_TIMELINE",
  "clip.trim": "LIVE_TIMELINE",
  "clip.visibility": "LIVE_DOM",
  "clip.volume": "LIVE_DOM",
  "composition.canvas-duration": "LIVE_TIMELINE",
  "document.reconcile": "FULL_RELOAD",
  "document.restore": "FULL_RELOAD",
  "track.update": "FULL_RELOAD",
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
 * The iframe can apply only visual DOM patches in place. Timeline and
 * structural changes must rebuild the compiled preview to remain truthful.
 */
export function requiresCompositionPreviewReload(
  strategy: CompositionPreviewUpdateStrategy,
): boolean {
  return strategy !== "LIVE_DOM";
}
