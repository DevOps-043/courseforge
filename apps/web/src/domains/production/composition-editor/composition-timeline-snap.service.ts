import type { CompositionClip } from "./composition-document.types";

export type TimelineSnapEdge = "END" | "START";
export type TimelineSnapSource = "ANIMATION_END" | "ANIMATION_START" | "CLIP_END" | "CLIP_START" | "PLAYHEAD";

export type TimelineSnapTarget = {
  animationId?: string;
  animationLabel?: string;
  clipId?: string;
  clipLabel?: string;
  source: TimelineSnapSource;
  timeSeconds: number;
};

export type TimelineSnapMatch = TimelineSnapTarget & {
  movingEdge: TimelineSnapEdge;
};

export type TimelineSnapResult = {
  deltaSeconds: number;
  match: TimelineSnapMatch | null;
};

type TimelineSnapAnchor = {
  edge: TimelineSnapEdge;
  timeSeconds: number;
};

const SOURCE_PRIORITY: Record<TimelineSnapSource, number> = {
  PLAYHEAD: 0,
  ANIMATION_START: 1,
  ANIMATION_END: 2,
  CLIP_START: 3,
  CLIP_END: 4,
};
const SNAP_COMPARISON_EPSILON = 1e-9;

/** Builds magnetic points shared by every visible track in the timeline. */
export function buildTimelineSnapTargets(params: {
  clips: Array<Pick<CompositionClip, "hidden" | "id" | "label" | "durationSeconds" | "startSeconds">>;
  excludedClipId?: string;
  playheadSeconds: number;
}): TimelineSnapTarget[] {
  const targets: TimelineSnapTarget[] = [{
    source: "PLAYHEAD",
    timeSeconds: params.playheadSeconds,
  }];

  for (const clip of params.clips) {
    if (clip.id === params.excludedClipId || clip.hidden) continue;
    targets.push({
      clipId: clip.id,
      clipLabel: clip.label,
      source: "CLIP_START",
      timeSeconds: clip.startSeconds,
    }, {
      clipId: clip.id,
      clipLabel: clip.label,
      source: "CLIP_END",
      timeSeconds: clip.startSeconds + clip.durationSeconds,
    });
  }

  return targets;
}

/**
 * Finds the nearest edge-to-target match. The returned delta can be applied to
 * a move or to the single edge being trimmed. Ties are stable and preserve the
 * existing playhead preference.
 */
export function resolveTimelineSnap(params: {
  anchors: TimelineSnapAnchor[];
  isValidDelta?: (deltaSeconds: number) => boolean;
  targets: TimelineSnapTarget[];
  toleranceSeconds: number;
}): TimelineSnapResult {
  if (params.toleranceSeconds < 0) return { deltaSeconds: 0, match: null };

  let best: { distance: number; deltaSeconds: number; match: TimelineSnapMatch; order: number } | null = null;
  let order = 0;

  for (const anchor of params.anchors) {
    for (const target of params.targets) {
      const deltaSeconds = target.timeSeconds - anchor.timeSeconds;
      const distance = Math.abs(deltaSeconds);
      const candidateOrder = order++;
      if (distance > params.toleranceSeconds || (params.isValidDelta && !params.isValidDelta(deltaSeconds))) continue;

      const match: TimelineSnapMatch = { ...target, movingEdge: anchor.edge };
      if (
        !best
        || distance < best.distance - SNAP_COMPARISON_EPSILON
        || (
          Math.abs(distance - best.distance) <= SNAP_COMPARISON_EPSILON
          && SOURCE_PRIORITY[target.source] < SOURCE_PRIORITY[best.match.source]
        )
        || (
          Math.abs(distance - best.distance) <= SNAP_COMPARISON_EPSILON
          && SOURCE_PRIORITY[target.source] === SOURCE_PRIORITY[best.match.source]
          && candidateOrder < best.order
        )
      ) {
        best = { distance, deltaSeconds, match, order: candidateOrder };
      }
    }
  }

  return best
    ? { deltaSeconds: best.deltaSeconds, match: best.match }
    : { deltaSeconds: 0, match: null };
}
