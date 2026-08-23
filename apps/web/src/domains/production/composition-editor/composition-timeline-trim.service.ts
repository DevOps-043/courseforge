import type { CompositionClip } from "./composition-document.types";

/**
 * A deck slide has no consumable media before its current start, so its left
 * edge may extend freely to the beginning of the composition. Timed media must
 * retain the source boundary represented by sourceOffsetSeconds.
 */
export function resolveCompositionTimelineTrimStartMinimum(
  clip: Pick<CompositionClip, "kind" | "sourceOffsetSeconds" | "startSeconds">,
) {
  if (clip.kind === "DECK_SLIDE") return 0;
  return Math.max(0, clip.startSeconds - (clip.sourceOffsetSeconds || 0));
}

/** Keeps HTML slides time-independent while preserving media source trimming. */
export function resolveCompositionTimelineTrimStartSourceOffset(
  clip: Pick<CompositionClip, "kind" | "sourceOffsetSeconds" | "startSeconds">,
  nextStartSeconds: number,
) {
  if (clip.kind === "DECK_SLIDE") return 0;
  return Math.max(
    0,
    (clip.sourceOffsetSeconds || 0) + nextStartSeconds - clip.startSeconds,
  );
}
