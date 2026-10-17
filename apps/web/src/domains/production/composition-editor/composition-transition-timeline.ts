import type { CompositionTransitionRuntimeItem } from "./composition-transition-runtime";

type Values = Record<string, number | string | boolean>;
type TransitionTimeline<Target> = {
  set(target: Target, values: Values, position: number): unknown;
  to(target: Target, values: Values, position: number): unknown;
  fromTo(target: Target, from: Values, to: Values, position: number): unknown;
};

/** Self-contained scheduler embedded unchanged in preview/render and used for numeric projection. */
export function scheduleCompositionTransitions<Target>(timeline: TransitionTimeline<Target>,
  transitions: CompositionTransitionRuntimeItem[], resolveTarget: (id: string) => Target | null | undefined) {
  const pushVectors = {
    DOWN: {from: {yPercent: 100}, to: {yPercent: -100}}, LEFT: {from: {xPercent: -100}, to: {xPercent: 100}},
    RIGHT: {from: {xPercent: 100}, to: {xPercent: -100}}, UP: {from: {yPercent: -100}, to: {yPercent: 100}},
  };
  const wipeInsets = {DOWN: "inset(100% 0 0 0)", LEFT: "inset(0 0 0 100%)", RIGHT: "inset(0 100% 0 0)", UP: "inset(0 0 100% 0)"};
  for (const transition of transitions) {
    const from = resolveTarget(transition.fromClipId), to = resolveTarget(transition.toClipId);
    if (!from || !to) continue;
    const common = {duration: transition.durationSeconds, ease: transition.easing, immediateRender: false};
    if (transition.type === "CROSS_DISSOLVE") {
      timeline.fromTo(from, {autoAlpha: transition.fromOpacity}, {...common, autoAlpha: 0}, transition.startSeconds);
      timeline.fromTo(to, {autoAlpha: 0}, {...common, autoAlpha: transition.toOpacity}, transition.startSeconds);
    } else if (transition.type === "BLUR_DISSOLVE") {
      const blur = Math.max(0, Math.min(40, transition.blurPixels || 0));
      timeline.fromTo(from, {autoAlpha: transition.fromOpacity, filter: "blur(0px)"}, {...common, autoAlpha: 0, filter: "blur(" + blur + "px)"}, transition.startSeconds);
      timeline.fromTo(to, {autoAlpha: 0, filter: "blur(" + blur + "px)"}, {...common, autoAlpha: transition.toOpacity, filter: "blur(0px)"}, transition.startSeconds);
    } else if (transition.type === "PUSH") {
      const vector = pushVectors[transition.direction || "LEFT"];
      timeline.fromTo(from, {autoAlpha: transition.fromOpacity, xPercent: 0, yPercent: 0}, {...common, ...vector.from, autoAlpha: transition.fromOpacity}, transition.startSeconds);
      timeline.fromTo(to, {...vector.to, autoAlpha: transition.toOpacity}, {...common, autoAlpha: transition.toOpacity, xPercent: 0, yPercent: 0}, transition.startSeconds);
    } else if (transition.type === "SOFT_WIPE") {
      const inset = wipeInsets[transition.direction || "LEFT"];
      timeline.fromTo(from, {autoAlpha: transition.fromOpacity}, {...common, autoAlpha: 0}, transition.startSeconds);
      timeline.fromTo(to, {autoAlpha: transition.toOpacity * 0.35, clipPath: inset}, {...common, autoAlpha: transition.toOpacity, clipPath: "inset(0% 0% 0% 0%)"}, transition.startSeconds);
    } else if (transition.type === "DIP_TO_COLOR") {
      const overlay = transition.overlayId ? resolveTarget(transition.overlayId) : null;
      if (!overlay) continue;
      const halfDuration = transition.durationSeconds / 2, midpoint = transition.startSeconds + halfDuration;
      timeline.set(to, {autoAlpha: 0}, transition.startSeconds);
      timeline.to(overlay, {autoAlpha: 1, duration: halfDuration, ease: transition.easing}, transition.startSeconds);
      timeline.set(from, {autoAlpha: 0}, midpoint);
      timeline.set(to, {autoAlpha: transition.toOpacity}, midpoint);
      timeline.to(overlay, {autoAlpha: 0, duration: halfDuration, ease: transition.easing}, midpoint);
    }
  }
}
