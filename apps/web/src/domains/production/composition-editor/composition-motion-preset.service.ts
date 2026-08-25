import type { CompositionAnimation, CompositionMotionPresetId } from "./composition-motion.types";

export const COMPOSITION_MOTION_PHASES = ["ENTRY", "PLAYBACK", "EXIT"] as const;
export type CompositionMotionPhase = typeof COMPOSITION_MOTION_PHASES[number];
export type CompositionMotionPresetControl = "CADENCE" | "CYCLES" | "DURATION" | "INTENSITY" | "OFFSET";

export type CompositionMotionPresetDefinition = {
  controls: readonly CompositionMotionPresetControl[];
  defaultCycles: number;
  defaultDurationSeconds: number;
  defaultIntensity: number;
  id: CompositionMotionPresetId;
  label: string;
  maxDurationSeconds: number | null;
  phase: CompositionMotionPhase;
  propertyGroup: CompositionAnimation["propertyGroup"];
};

const ENTRY_CONTROLS = ["DURATION", "INTENSITY", "OFFSET"] as const;
const PLAYBACK_CONTROLS = ["DURATION", "INTENSITY", "CADENCE", "OFFSET"] as const;
const INTERMEDIATE_VISIBILITY_CONTROLS = ["DURATION", "OFFSET"] as const;
const EXIT_CONTROLS = ["DURATION", "INTENSITY", "OFFSET"] as const;

export const COMPOSITION_MOTION_PRESETS = [
  preset("FADE_IN", "Aparecer", "ENTRY", "OPACITY", ENTRY_CONTROLS),
  preset("SLIDE_IN_LEFT", "Desde la izquierda", "ENTRY", "POSITION", ENTRY_CONTROLS),
  preset("SLIDE_IN_RIGHT", "Desde la derecha", "ENTRY", "POSITION", ENTRY_CONTROLS),
  preset("SLIDE_IN_UP", "Desde arriba", "ENTRY", "POSITION", ENTRY_CONTROLS),
  preset("SLIDE_IN_DOWN", "Desde abajo", "ENTRY", "POSITION", ENTRY_CONTROLS),
  preset("ZOOM_IN", "Zoom de entrada", "ENTRY", "SCALE", ENTRY_CONTROLS),
  preset("POP", "Pop", "ENTRY", "SCALE", ENTRY_CONTROLS),
  preset("PULSE", "Pulso", "PLAYBACK", "SCALE", PLAYBACK_CONTROLS),
  preset("FLOAT", "Flotar", "PLAYBACK", "POSITION", PLAYBACK_CONTROLS),
  preset("SWAY", "Balanceo", "PLAYBACK", "ROTATION", PLAYBACK_CONTROLS),
  preset("BREATHE", "Respirar", "PLAYBACK", "OPACITY", PLAYBACK_CONTROLS),
  preset("HIDE", "Desaparecer", "PLAYBACK", "OPACITY", INTERMEDIATE_VISIBILITY_CONTROLS),
  preset("FADE_HIDE", "Desvanecer y reaparecer", "PLAYBACK", "OPACITY", INTERMEDIATE_VISIBILITY_CONTROLS),
  preset("FADE_OUT", "Desvanecer", "EXIT", "OPACITY", EXIT_CONTROLS),
  preset("SLIDE_OUT_LEFT", "Hacia la izquierda", "EXIT", "POSITION", EXIT_CONTROLS),
  preset("SLIDE_OUT_RIGHT", "Hacia la derecha", "EXIT", "POSITION", EXIT_CONTROLS),
  preset("SLIDE_OUT_UP", "Hacia arriba", "EXIT", "POSITION", EXIT_CONTROLS),
  preset("SLIDE_OUT_DOWN", "Hacia abajo", "EXIT", "POSITION", EXIT_CONTROLS),
  preset("ZOOM_OUT", "Zoom de salida", "EXIT", "SCALE", EXIT_CONTROLS),
] as const satisfies ReadonlyArray<CompositionMotionPresetDefinition>;

const PRESET_BY_ID = new Map<CompositionMotionPresetId, CompositionMotionPresetDefinition>(
  COMPOSITION_MOTION_PRESETS.map((definition) => [definition.id, definition]),
);

export function getCompositionMotionPresetDefinition(presetId: CompositionMotionPresetId) {
  const definition = PRESET_BY_ID.get(presetId);
  if (!definition) throw new Error(`Preset de animación no soportado: ${presetId}.`);
  return definition;
}

export function getCompositionMotionPhase(animation: CompositionAnimation): CompositionMotionPhase {
  if (animation.preset) return getCompositionMotionPresetDefinition(animation.preset.id).phase;
  if (animation.timing.anchor === "CLIP_END") return "EXIT";
  return animation.timing.offsetSeconds <= 0.001 ? "ENTRY" : "PLAYBACK";
}

export function getDefaultCompositionPresetDuration(presetId: CompositionMotionPresetId, clipDurationSeconds: number) {
  const definition = getCompositionMotionPresetDefinition(presetId);
  return clampDuration(definition, definition.defaultDurationSeconds, clipDurationSeconds);
}

export function createCompositionPresetAnimation(params: {
  animationId: string;
  clipDurationSeconds?: number;
  clipId: string;
  cycleDurationSeconds?: number;
  cycles?: number;
  durationSeconds: number;
  intensity?: number;
  offsetSeconds?: number;
  origin: "AGENT" | "PRESET" | "USER";
  presetId: CompositionMotionPresetId;
}): CompositionAnimation {
  const definition = getCompositionMotionPresetDefinition(params.presetId);
  const clipDurationSeconds = Math.max(0.05, params.clipDurationSeconds ?? params.durationSeconds);
  const durationSeconds = clampDuration(definition, params.durationSeconds, clipDurationSeconds);
  const intensity = clamp(params.intensity ?? definition.defaultIntensity, 0.25, 2);
  const cycles = Math.round(clamp(params.cycles ?? definition.defaultCycles, 1, 12));
  const loop = definition.phase === "PLAYBACK" && isAmbientMotionPreset(params.presetId)
    ? { mode: "FINITE" as const, cycleDurationSeconds: clamp(params.cycleDurationSeconds ?? 1.5, 0.5, 8) }
    : undefined;
  const offsetSeconds = clamp(
    params.offsetSeconds ?? defaultOffset(definition.phase, clipDurationSeconds, durationSeconds),
    0,
    Math.max(0, clipDurationSeconds - durationSeconds),
  );
  const common = {
    id: params.animationId,
    origin: params.origin,
    preset: { id: params.presetId, parameters: { cycles, intensity }, version: loop ? 3 : 2 },
    target: { clipId: params.clipId, part: "CONTENT" as const },
    timing: {
      anchor: definition.phase === "EXIT" ? "CLIP_END" as const : "CLIP_START" as const,
      durationSeconds,
      offsetSeconds,
    },
  };
  const distance = Math.round(160 * intensity);

  switch (params.presetId) {
    case "FADE_OUT":
      return { ...common, propertyGroup: "OPACITY", keyframes: [{ offset: 0, values: { opacity: 1 } }, { ease: "power2.in", offset: 1, values: { opacity: clamp(1 - intensity, 0, 0.75) } }] };
    case "SLIDE_IN_LEFT": return positionAnimation(common, -distance, 0, 0, 0, "power2.out");
    case "SLIDE_IN_RIGHT": return positionAnimation(common, distance, 0, 0, 0, "power2.out");
    case "SLIDE_IN_UP": return positionAnimation(common, 0, -distance, 0, 0, "power2.out");
    case "SLIDE_IN_DOWN": return positionAnimation(common, 0, distance, 0, 0, "power2.out");
    case "SLIDE_OUT_LEFT": return positionAnimation(common, 0, 0, -distance, 0, "power2.in");
    case "SLIDE_OUT_RIGHT": return positionAnimation(common, 0, 0, distance, 0, "power2.in");
    case "SLIDE_OUT_UP": return positionAnimation(common, 0, 0, 0, -distance, "power2.in");
    case "SLIDE_OUT_DOWN": return positionAnimation(common, 0, 0, 0, distance, "power2.in");
    case "ZOOM_IN":
      return { ...common, propertyGroup: "SCALE", keyframes: [{ offset: 0, values: { scale: clamp(1 - 0.18 * intensity, 0.1, 0.95) } }, { ease: "power2.out", offset: 1, values: { scale: 1 } }] };
    case "ZOOM_OUT":
      return { ...common, propertyGroup: "SCALE", keyframes: [{ offset: 0, values: { scale: 1 } }, { ease: "power2.in", offset: 1, values: { scale: clamp(1 - 0.18 * intensity, 0.1, 0.95) } }] };
    case "POP":
      return { ...common, propertyGroup: "SCALE", keyframes: [{ offset: 0, values: { scale: clamp(1 - 0.3 * intensity, 0.1, 0.9) } }, { ease: "back.out(1.4)", offset: 0.72, values: { scale: 1 + 0.08 * intensity } }, { ease: "power1.out", offset: 1, values: { scale: 1 } }] };
    case "PULSE":
      return { ...common, loop, propertyGroup: "SCALE", keyframes: oscillationKeyframes("scale", 1, 1 + 0.08 * intensity, loop ? 1 : cycles) };
    case "FLOAT":
      return { ...common, loop, propertyGroup: "POSITION", keyframes: oscillationPositionKeyframes(0, -24 * intensity, loop ? 1 : cycles) };
    case "SWAY":
      return { ...common, loop, propertyGroup: "ROTATION", keyframes: oscillationKeyframes("rotation", 0, 3 * intensity, loop ? 1 : cycles) };
    case "BREATHE":
      return { ...common, loop, propertyGroup: "OPACITY", keyframes: oscillationKeyframes("opacity", 1, clamp(1 - 0.12 * intensity, 0.55, 0.94), loop ? 1 : cycles) };
    case "HIDE":
      return { ...common, propertyGroup: "OPACITY", keyframes: [{ offset: 0, values: { opacity: 0 } }, { ease: "steps(1)", offset: 1, values: { opacity: 1 } }] };
    case "FADE_HIDE":
      return {
        ...common,
        propertyGroup: "OPACITY",
        keyframes: [
          { offset: 0, values: { opacity: 1 } },
          { ease: "power2.in", offset: 0.2, values: { opacity: 0 } },
          { ease: "none", offset: 0.8, values: { opacity: 0 } },
          { ease: "power2.out", offset: 1, values: { opacity: 1 } },
        ],
      };
    case "FADE_IN":
      return { ...common, propertyGroup: "OPACITY", keyframes: [{ offset: 0, values: { opacity: clamp(1 - intensity, 0, 0.75) } }, { ease: "power2.out", offset: 1, values: { opacity: 1 } }] };
    default:
      throw new Error(`El preset de animación ${params.presetId} todavía no está implementado.`);
  }
}

export function isAmbientMotionPreset(presetId: CompositionMotionPresetId) {
  return presetId === "PULSE" || presetId === "FLOAT" || presetId === "SWAY" || presetId === "BREATHE";
}

function preset(id: CompositionMotionPresetId, label: string, phase: CompositionMotionPhase, propertyGroup: CompositionAnimation["propertyGroup"], controls: readonly CompositionMotionPresetControl[]): CompositionMotionPresetDefinition {
  return { controls, defaultCycles: phase === "PLAYBACK" ? 3 : 1, defaultDurationSeconds: phase === "PLAYBACK" ? 3 : 0.7, defaultIntensity: 1, id, label, maxDurationSeconds: phase === "PLAYBACK" ? null : 2, phase, propertyGroup };
}

function clampDuration(definition: CompositionMotionPresetDefinition, requestedDurationSeconds: number, clipDurationSeconds: number) {
  const presetMaximum = definition.maxDurationSeconds ?? clipDurationSeconds;
  return clamp(requestedDurationSeconds, 0.05, Math.max(0.05, Math.min(presetMaximum, clipDurationSeconds)));
}

function defaultOffset(phase: CompositionMotionPhase, clipDurationSeconds: number, durationSeconds: number) {
  return phase === "PLAYBACK" ? Math.max(0, (clipDurationSeconds - durationSeconds) / 2) : 0;
}

function positionAnimation(common: Pick<CompositionAnimation, "id" | "origin" | "preset" | "target" | "timing">, fromX: number, fromY: number, toX: number, toY: number, ease: "power2.in" | "power2.out"): CompositionAnimation {
  return { ...common, propertyGroup: "POSITION", keyframes: [{ offset: 0, values: { x: fromX, y: fromY } }, { ease, offset: 1, values: { x: toX, y: toY } }] };
}

function oscillationKeyframes(property: "opacity" | "rotation" | "scale", restingValue: number, peakValue: number, cycles: number): CompositionAnimation["keyframes"] {
  const keyframes: CompositionAnimation["keyframes"] = [{ offset: 0, values: { [property]: restingValue } }];
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    keyframes.push({ ease: "power1.inOut", offset: roundOffset((cycle + 0.5) / cycles), values: { [property]: peakValue } });
    keyframes.push({ ease: "power1.inOut", offset: roundOffset((cycle + 1) / cycles), values: { [property]: restingValue } });
  }
  return keyframes;
}

function oscillationPositionKeyframes(restingY: number, peakY: number, cycles: number): CompositionAnimation["keyframes"] {
  const keyframes: CompositionAnimation["keyframes"] = [{ offset: 0, values: { x: 0, y: restingY } }];
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    keyframes.push({ ease: "power1.inOut", offset: roundOffset((cycle + 0.5) / cycles), values: { x: 0, y: peakY } });
    keyframes.push({ ease: "power1.inOut", offset: roundOffset((cycle + 1) / cycles), values: { x: 0, y: restingY } });
  }
  return keyframes;
}

function roundOffset(value: number) { return Math.round(value * 1_000_000) / 1_000_000; }
function clamp(value: number, minimum: number, maximum: number) { return Math.max(minimum, Math.min(maximum, value)); }
