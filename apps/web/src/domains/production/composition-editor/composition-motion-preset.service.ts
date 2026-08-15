import type { CompositionAnimation, CompositionMotionPresetId } from "./composition-motion.types";

export const COMPOSITION_MOTION_PRESETS: ReadonlyArray<{
  id: CompositionMotionPresetId;
  label: string;
}> = [
  { id: "FADE_IN", label: "Aparecer" },
  { id: "FADE_OUT", label: "Desvanecer" },
  { id: "SLIDE_IN_LEFT", label: "Entrar desde izquierda" },
  { id: "SLIDE_IN_RIGHT", label: "Entrar desde derecha" },
  { id: "ZOOM_IN", label: "Zoom de entrada" },
  { id: "POP", label: "Pop" },
];

export function createCompositionPresetAnimation(params: {
  animationId: string;
  clipId: string;
  durationSeconds: number;
  origin: "AGENT" | "PRESET" | "USER";
  presetId: CompositionMotionPresetId;
}): CompositionAnimation {
  const durationSeconds = Math.max(0.05, Math.min(params.durationSeconds, 2));
  const common = {
    id: params.animationId,
    origin: params.origin,
    preset: { id: params.presetId, version: 1 },
    target: { clipId: params.clipId, part: "CONTENT" as const },
  };
  switch (params.presetId) {
    case "FADE_OUT":
      return { ...common, propertyGroup: "OPACITY", timing: { anchor: "CLIP_END", durationSeconds, offsetSeconds: 0 }, keyframes: [{ offset: 0, values: { opacity: 1 } }, { ease: "power2.in", offset: 1, values: { opacity: 0 } }] };
    case "SLIDE_IN_LEFT":
      return { ...common, propertyGroup: "POSITION", timing: { anchor: "CLIP_START", durationSeconds, offsetSeconds: 0 }, keyframes: [{ offset: 0, values: { x: -160, y: 0 } }, { ease: "power2.out", offset: 1, values: { x: 0, y: 0 } }] };
    case "SLIDE_IN_RIGHT":
      return { ...common, propertyGroup: "POSITION", timing: { anchor: "CLIP_START", durationSeconds, offsetSeconds: 0 }, keyframes: [{ offset: 0, values: { x: 160, y: 0 } }, { ease: "power2.out", offset: 1, values: { x: 0, y: 0 } }] };
    case "ZOOM_IN":
      return { ...common, propertyGroup: "SCALE", timing: { anchor: "CLIP_START", durationSeconds, offsetSeconds: 0 }, keyframes: [{ offset: 0, values: { scale: 0.82 } }, { ease: "power2.out", offset: 1, values: { scale: 1 } }] };
    case "POP":
      return { ...common, propertyGroup: "SCALE", timing: { anchor: "CLIP_START", durationSeconds, offsetSeconds: 0 }, keyframes: [{ offset: 0, values: { scale: 0.7 } }, { ease: "back.out(1.4)", offset: 0.72, values: { scale: 1.08 } }, { ease: "power1.out", offset: 1, values: { scale: 1 } }] };
    case "FADE_IN":
      return { ...common, propertyGroup: "OPACITY", timing: { anchor: "CLIP_START", durationSeconds, offsetSeconds: 0 }, keyframes: [{ offset: 0, values: { opacity: 0 } }, { ease: "power2.out", offset: 1, values: { opacity: 1 } }] };
  }
}
