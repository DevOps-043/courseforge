import type { z } from "zod";
import type { compositionMotionRuntimeSchema } from "./composition-motion-runtime";

type MotionRuntime = z.infer<typeof compositionMotionRuntimeSchema>;
type TimelineValues = Record<string, number | string | boolean>;
type MotionTimeline<Target> = {
  set(target: Target, values: TimelineValues, position: number): unknown;
  to(target: Target, values: TimelineValues, position: number): unknown;
};

/** Self-contained: the compiler embeds this exact function into browser HTML. */
export function scheduleCompositionMotion<Target>(
  timeline: MotionTimeline<Target>,
  animations: MotionRuntime,
  resolveTarget: (id: string) => Target | null | undefined,
) {
  for (const animation of animations) {
    const target = resolveTarget(animation.targetId);
    const first = animation.keyframes[0];
    if (!target || !first) continue;
    timeline.set(target, first.values, animation.start);
    if (animation.loop) {
      const peak = animation.keyframes[1];
      if (!peak) continue;
      const cycleDuration = Math.min(animation.loop.cycleDurationSeconds, animation.duration);
      const fullCycles = Math.floor(animation.duration / cycleDuration);
      const remainder = animation.duration - fullCycles * cycleDuration;
      const addFiniteLoop = (start: number, duration: number, cycles: number) => {
        if (duration <= 0 || cycles <= 0) return;
        timeline.to(target, {...peak.values, duration: duration / 2,
          ease: peak.ease || "none", repeat: Math.max(0, cycles * 2 - 1), yoyo: true}, start);
      };
      addFiniteLoop(animation.start, cycleDuration, fullCycles);
      // A partial cycle returns to the neutral pose at the assigned window end.
      addFiniteLoop(animation.start + fullCycles * cycleDuration, remainder, 1);
      continue;
    }
    for (let index = 1; index < animation.keyframes.length; index++) {
      const previous = animation.keyframes[index - 1]!;
      const keyframe = animation.keyframes[index]!;
      timeline.to(target, {...keyframe.values,
        duration: (keyframe.offset - previous.offset) * animation.duration,
        ease: keyframe.ease || "none"}, animation.start + previous.offset * animation.duration);
    }
  }
}
