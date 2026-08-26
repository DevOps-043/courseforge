import type { CompositionEditorDocument } from "./composition-document.types";
import {
  resolveCompositionDuration,
  type CompositionDurationAsset,
  type CompositionDurationResolution,
} from "./composition-duration.service";
import type { CompositionEditorPatchOperation } from "./editor-patch.types";

/**
 * Resolves the content duration without changing the arrangement of clips.
 *
 * Placement of branding is deliberately a separate use case: it may expand
 * the canvas and shift content, while recalculation must be safe to invoke
 * repeatedly from the editor.
 */
export function buildCompositionDurationRecalculationPatch(params: {
  assets: CompositionDurationAsset[];
  document: CompositionEditorDocument;
}): { operations: CompositionEditorPatchOperation[]; resolution: CompositionDurationResolution } {
  const resolution = resolveCompositionDuration({
    assets: params.assets,
    slideCount: params.document.clips.filter((clip) => clip.source.type === "DECK_SLIDE").length,
  });
  const latestClipEnd = params.document.clips.reduce(
    (latest, clip) => Math.max(latest, clip.startSeconds + clip.durationSeconds),
    0,
  );
  // Never shrink past authored media. Branding placement will be the only
  // operation allowed to intentionally extend this duration for intro/outro.
  const durationSeconds = roundSeconds(Math.max(resolution.durationSeconds, latestClipEnd));
  return {
    operations: [{
      clipId: "canvas",
      durationMode: durationSeconds > resolution.durationSeconds + 0.001 ? "USER_EDITED" : "AUTO",
      durationSeconds,
      durationSource: resolution.source,
      type: "composition.canvas-duration",
    }],
    resolution,
  };
}

function roundSeconds(value: number) {
  return Math.round(value * 1_000) / 1_000;
}
