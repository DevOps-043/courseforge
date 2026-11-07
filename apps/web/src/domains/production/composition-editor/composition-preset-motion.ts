import type { CompositionClip, CompositionEditorDocument } from "./composition-document.types";
import type { CompositionAnimation } from "./composition-motion.types";
import type { CompositionPresetVariant } from "./composition-preset.types";

export function captureCompositionPresetMotion(clip: CompositionClip, document: CompositionEditorDocument): NonNullable<CompositionPresetVariant["motion"]> {
  return document.motion.animations.filter(animation => animation.target.clipId === clip.id).map(animation => ({
    anchor: animation.timing.anchor,
    durationRatio: animation.timing.durationSeconds / clip.durationSeconds,
    offsetRatio: animation.timing.offsetSeconds / clip.durationSeconds,
    propertyGroup: animation.propertyGroup,
    ...(animation.preset ? { preset: structuredClone(animation.preset) } : {}),
    keyframes: animation.keyframes.map(frame => ({ ...frame, values: {
      ...frame.values,
      ...(frame.values.x !== undefined ? { x: frame.values.x / document.canvas.width } : {}),
      ...(frame.values.y !== undefined ? { y: frame.values.y / document.canvas.height } : {}),
    } })),
    ...(animation.loop ? { loopCycleRatio: animation.loop.cycleDurationSeconds / clip.durationSeconds } : {}),
  }));
}

export function materializeCompositionPresetMotion(params: {
  animation: NonNullable<CompositionPresetVariant["motion"]>[number];
  clip: CompositionClip;
  document: CompositionEditorDocument;
  id: string;
}): CompositionAnimation {
  const { animation, clip, document, id } = params;
  return {
    id, origin: "PRESET", target: { clipId: clip.id, part: "CONTENT" },
    propertyGroup: animation.propertyGroup,
    ...(animation.preset ? { preset: structuredClone(animation.preset) } : {}),
    timing: {
      anchor: animation.anchor,
      durationSeconds: clip.durationSeconds * animation.durationRatio,
      offsetSeconds: clip.durationSeconds * animation.offsetRatio,
    },
    keyframes: animation.keyframes.map(frame => ({ ...frame, values: {
      ...frame.values,
      ...(frame.values.x !== undefined ? { x: frame.values.x * document.canvas.width } : {}),
      ...(frame.values.y !== undefined ? { y: frame.values.y * document.canvas.height } : {}),
    } })),
    ...(animation.loopCycleRatio !== undefined ? { loop: {
      mode: "FINITE", cycleDurationSeconds: Math.max(0.5, Math.min(8, clip.durationSeconds * animation.loopCycleRatio)),
    } } : {}),
  };
}
