import { gsap } from "gsap";
import type { CompositionEditorDocument } from "./composition-document.types";
import { buildCaptionEffectPlan } from "./composition-caption-effects-plan";
import { scheduleCaptionEffects } from "./composition-caption-effects-runtime";

/** Frozen expectations use the same GSAP scheduler/easing as the renderer. */
export function createCaptionEffectsProjection(document: CompositionEditorDocument) {
  const steps = buildCaptionEffectPlan(document);
  const targets = new Map(steps.map((step) => [step.targetId, {
    opacity: 1, x: 0, y: 0, scale: 1, color: "rgba(0,0,0,0)", backgroundColor: "rgba(0,0,0,0)",
  }]));
  const groupedTargets = new Map<string, string[]>();
  for (const id of targets.keys()) {
    const partIndex = id.lastIndexOf("-part-");
    const effectId = partIndex >= 0 && !id.endsWith("-effect") ? `${id.slice(0, partIndex)}-effect` : id;
    groupedTargets.set(effectId, [...(groupedTargets.get(effectId) || []), id]);
  }
  const timeline = gsap.timeline({ paused: true });
  scheduleCaptionEffects(timeline, steps, (id) => targets.get(id));
  timeline.render(0, true, true);
  return {
    at(seconds: number, effectId: string) {
      timeline.time(seconds, true);
      return (groupedTargets.get(effectId) || []).map((elementId) => {
        const pose = targets.get(elementId)!;
        return { elementId, opacity: pose.opacity, x: pose.x, y: pose.y, scale: pose.scale,
          ...(elementId === effectId ? {} : { color: pose.color, backgroundColor: pose.backgroundColor }) };
      });
    },
    dispose() { timeline.kill(); },
  };
}
