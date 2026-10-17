import type { CaptionEffectStep } from "./composition-caption-effects-plan";

type TimelineValues = Record<string, number | string | boolean>;
type CaptionTimeline<Target> = {
  set(target: Target, values: TimelineValues, at: number): unknown;
  fromTo(target: Target, from: TimelineValues, to: TimelineValues, at: number): unknown;
};

/** Self-contained: this same scheduler is embedded in preview and export HTML. */
export function scheduleCaptionEffects<Target>(timeline: CaptionTimeline<Target>, steps: CaptionEffectStep[], resolveTarget: (id: string) => Target | null | undefined) {
  for (const step of steps) {
    const target = resolveTarget(step.targetId);
    if (!target) throw new Error("CAPTION_EFFECT_TARGET_NOT_FOUND");
    if (step.duration === 0) timeline.set(target, step.to, step.at);
    else timeline.fromTo(target, step.from, { ...step.to, duration: step.duration, ease: step.ease, immediateRender: false }, step.at);
  }
}
