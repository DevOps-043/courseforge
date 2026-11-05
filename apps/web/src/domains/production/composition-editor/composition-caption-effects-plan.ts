import type { CompositionClip, CompositionEditorDocument } from "./composition-document.types";
import { buildCaptionEffectPlanForCaptionClip, buildCaptionEffectPlanForCaptionClips, type CaptionEffectStep } from "./composition-caption-effects-planner";
export * from "./composition-caption-effects-planner";

/** Fachadas compatibles para consumidores del documento completo. */
export function buildCaptionEffectPlanForClip(clip: CompositionClip): CaptionEffectStep[] {
  if (clip.source.type !== "NATIVE_CAPTIONS") return [];
  return buildCaptionEffectPlanForCaptionClip({id: clip.id, startSeconds: clip.startSeconds, source: clip.source});
}

export function buildCaptionEffectPlan(document: CompositionEditorDocument) {
  return buildCaptionEffectPlanForCaptionClips(document.clips.flatMap(clip => clip.source.type === "NATIVE_CAPTIONS"
    ? [{id: clip.id, startSeconds: clip.startSeconds, source: clip.source}] : []));
}
