import { resolveCompositionAnimationWindow } from "./composition-motion-scheduling.service";
import type { CompositionAnimation } from "./composition-motion.types";

const MOTION_DERIVATION_EPSILON_SECONDS = 0.001;

export type CompositionRetainedClipSegment = {
  sourceEndSeconds: number;
  sourceStartSeconds: number;
  targetClipDurationSeconds: number;
  targetClipId: string;
};

export type CompositionMotionDerivationResult = {
  animations: CompositionAnimation[];
  conflicts: CompositionAnimation[];
};

/**
 * Rebinds animations to clips derived from retained temporal segments.
 *
 * An animation is migrated only when its complete window belongs to one
 * retained segment. Cutting through an animation is intentionally reported as
 * a conflict because duplicating or truncating its keyframes would change the
 * visual state and break deterministic seeking.
 */
export function deriveCompositionAnimationsForRetainedSegments(params: {
  animations: CompositionAnimation[];
  clipDurationSeconds: number;
  clipId: string;
  segments: CompositionRetainedClipSegment[];
}): CompositionMotionDerivationResult {
  const conflicts: CompositionAnimation[] = [];
  const animations = params.animations.map((animation) => {
    if (animation.target.clipId !== params.clipId) return animation;

    const window = resolveCompositionAnimationWindow(animation, params.clipDurationSeconds);
    const segment = params.segments.find((candidate) => (
      window.start >= candidate.sourceStartSeconds - MOTION_DERIVATION_EPSILON_SECONDS
      && window.end <= candidate.sourceEndSeconds + MOTION_DERIVATION_EPSILON_SECONDS
    ));
    if (!segment) {
      conflicts.push(animation);
      return animation;
    }

    const rebasedStartSeconds = Math.max(0, window.start - segment.sourceStartSeconds);
    const rebasedEndSeconds = rebasedStartSeconds + window.duration;
    const offsetSeconds = animation.timing.anchor === "CLIP_START"
      ? rebasedStartSeconds
      : segment.targetClipDurationSeconds - rebasedEndSeconds;

    return {
      ...animation,
      target: { ...animation.target, clipId: segment.targetClipId },
      timing: {
        ...animation.timing,
        offsetSeconds: roundMotionSeconds(Math.max(0, offsetSeconds)),
      },
    };
  });

  return { animations, conflicts };
}

function roundMotionSeconds(value: number) {
  return Math.round(value * 1_000) / 1_000;
}
