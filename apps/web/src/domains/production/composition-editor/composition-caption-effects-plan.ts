import type { CompositionClip, CompositionEditorDocument } from "./composition-document.types";
import type { CompositionCaptionCue } from "./composition-text-layer.types";
import { CAPTION_EFFECT_COLORS, CAPTION_EFFECT_LIMITS, CAPTION_EFFECT_METRICS } from "./composition-caption-effects.types";
import { captionHasEffects, resolveCaptionEffects, resolveCaptionWordRanges } from "./composition-caption-effects.service";

export type CaptionEffectValues = { opacity?: number; x?: number; y?: number; scale?: number; color?: string; backgroundColor?: string };
export type CaptionEffectStep = { targetId: string; at: number; duration: number; from: CaptionEffectValues; to: CaptionEffectValues; ease: "none" | "power2.out" | "power2.in" };
export const captionEffectElementId = (clipId: string, cueId: string) => `${clipId}-caption-${cueId}-effect`;
export const captionPartElementId = (clipId: string, cueId: string, index: number) => `${clipId}-caption-${cueId}-part-${index}`;

export function captionColorWithOpacity(hex: string, opacity: number) {
  return `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${opacity})`;
}

export function buildCaptionTextParts(cue: CompositionCaptionCue) {
  const words = resolveCaptionWordRanges(cue);
  const boundaries = [...new Set([0, cue.text.length, ...words.flatMap(({ start, end }) => [start, end]),
    ...(cue.emphasis || []).flatMap(({ start, end }) => [start, end])])].sort((left, right) => left - right);
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1]!;
    return { text: cue.text.slice(start, end), start, end,
      word: words.find((word) => word.start <= start && word.end >= end)?.word,
      emphasis: cue.emphasis?.find((range) => range.start <= start && range.end >= end) };
  });
}

export function buildCaptionEffectPlanForClip(clip: CompositionClip): CaptionEffectStep[] {
  if (clip.source.type !== "NATIVE_CAPTIONS") return [];
  const steps: CaptionEffectStep[] = [];
  const source = clip.source;
  let targetCount = 0;
  for (const cue of source.cues) {
    if (!captionHasEffects(cue, source.effects)) continue;
    const effects = resolveCaptionEffects(cue, source.effects);
    const parts = buildCaptionTextParts(cue);
    targetCount += 1 + parts.length;
    if (targetCount > CAPTION_EFFECT_LIMITS.maxRuntimeTargets) throw new Error("CAPTION_EFFECT_TARGET_LIMIT");
    const targetId = captionEffectElementId(clip.id, cue.id);
    const start = clip.startSeconds + cue.startSeconds;
    const end = clip.startSeconds + cue.endSeconds;
    const phaseCount = Number(effects.entry !== "NONE") + Number(effects.exit !== "NONE");
    const duration = Math.min(effects.durationSeconds, (end - start) / Math.max(1, phaseCount));
    const neutral = { opacity: 1, y: 0, scale: 1 };
    steps.push({ targetId, at: 0, duration: 0, from: neutral, to: neutral, ease: "none" });
    if (effects.entry !== "NONE") {
      const from = { ...neutral, opacity: 0,
        y: effects.entry === "SLIDE_UP" ? CAPTION_EFFECT_METRICS.slideDistancePixels * effects.intensity : 0,
        scale: effects.entry === "POP" ? 1 - CAPTION_EFFECT_METRICS.popScaleReduction * effects.intensity : 1 };
      steps.push({ targetId, at: start, duration, from, to: neutral, ease: "power2.out" });
    }
    if (effects.exit === "FADE") steps.push({ targetId, at: end - duration, duration, from: neutral, to: { ...neutral, opacity: 0 }, ease: "power2.in" });
    parts.forEach((part, index) => {
      const targetId = captionPartElementId(clip.id, cue.id, index);
      const baseColor = captionColorWithOpacity(part.emphasis?.color || source.style.color, source.style.textOpacity);
      const karaoke = effects.karaoke;
      const baseline = { opacity: part.word && karaoke !== "NONE" ? (karaoke === "LEGACY" ? CAPTION_EFFECT_METRICS.legacyInactiveOpacity : effects.inactiveOpacity) : 1,
        color: baseColor, backgroundColor: part.emphasis?.backgroundColor ? captionColorWithOpacity(part.emphasis.backgroundColor, 1) : "rgba(0,0,0,0)", scale: 1 };
      steps.push({ targetId, at: 0, duration: 0, from: baseline, to: baseline, ease: "none" });
      if (!part.word) return;
      const wordStart = clip.startSeconds + part.word.startSeconds;
      const wordEnd = clip.startSeconds + part.word.endSeconds;
      const active = { ...baseline, opacity: 1,
        color: karaoke === "COLOR" || karaoke === "BACKGROUND" ? captionColorWithOpacity(effects.activeColor, source.style.textOpacity) : baseColor,
        backgroundColor: karaoke === "BACKGROUND"
          ? captionColorWithOpacity(effects.activeBackgroundColor || CAPTION_EFFECT_COLORS.highlightBackground, 1)
          : baseline.backgroundColor };
      steps.push({ targetId, at: wordStart, duration: 0, from: active, to: active, ease: "none" });
      if (effects.pulse) {
        const halfDuration = (wordEnd - wordStart) / 2;
        const peak = { ...active, scale: 1 + CAPTION_EFFECT_METRICS.pulseScaleIncrease * effects.intensity };
        steps.push({ targetId, at: wordStart, duration: halfDuration, from: active, to: peak, ease: "power2.out" },
          { targetId, at: wordStart + halfDuration, duration: halfDuration, from: peak, to: active, ease: "power2.in" });
      }
      steps.push({ targetId, at: wordEnd, duration: 0, from: baseline, to: baseline, ease: "none" });
    });
  }
  return steps;
}

export function buildCaptionEffectPlan(document: CompositionEditorDocument) {
  const steps: CaptionEffectStep[] = [];
  const targets = new Set<string>();
  for (const clip of document.clips) {
    const clipSteps = buildCaptionEffectPlanForClip(clip);
    for (const step of clipSteps) targets.add(step.targetId);
    if (targets.size > CAPTION_EFFECT_LIMITS.maxRuntimeTargets) throw new Error("CAPTION_EFFECT_TARGET_LIMIT");
    steps.push(...clipSteps);
  }
  return steps;
}
