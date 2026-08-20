import {
  getCompositionMotionPresetDefinition,
  getDefaultCompositionPresetDuration,
} from "./composition-motion-preset.service";
import type {
  CompositionAnimation,
  CompositionMotionPresetId,
} from "./composition-motion.types";

const MOTION_WINDOW_EPSILON_SECONDS = 0.001;

export type CompositionAnimationWindow = {
  duration: number;
  end: number;
  start: number;
};

export type CompositionPresetInsertionPlan = {
  available: boolean;
  durationSeconds: number;
  offsetSeconds: number;
  reason: string | null;
};

export type CompositionAnimationTimelineEditKind = "MOVE" | "RESIZE_END" | "RESIZE_START";

export function buildCompositionAnimationTimelineEdit(params: {
  animation: Pick<CompositionAnimation, "timing">;
  clipDurationSeconds: number;
  deltaSeconds: number;
  fps: number;
  kind: CompositionAnimationTimelineEditKind;
  maximumDurationSeconds: number;
  snapEnabled: boolean;
  snapTargetSeconds?: number;
  snapToleranceSeconds?: number;
}): CompositionAnimation["timing"] {
  const initial = resolveCompositionAnimationWindow(params.animation, params.clipDurationSeconds);
  const minimumDurationSeconds = Math.max(0.05, 1 / params.fps);
  const maximumDurationSeconds = Math.max(
    minimumDurationSeconds,
    Math.min(params.maximumDurationSeconds, params.clipDurationSeconds),
  );
  let start = initial.start;
  let end = initial.end;

  if (params.kind === "MOVE") {
    start = clamp(initial.start + params.deltaSeconds, 0, params.clipDurationSeconds - initial.duration);
    end = start + initial.duration;
  } else if (params.kind === "RESIZE_START") {
    start = clamp(
      initial.start + params.deltaSeconds,
      Math.max(0, initial.end - maximumDurationSeconds),
      initial.end - minimumDurationSeconds,
    );
  } else {
    end = clamp(
      initial.end + params.deltaSeconds,
      initial.start + minimumDurationSeconds,
      Math.min(params.clipDurationSeconds, initial.start + maximumDurationSeconds),
    );
  }

  const snapped = snapAnimationWindowToTarget({
    end,
    kind: params.kind,
    snapTargetSeconds: params.snapTargetSeconds,
    snapToleranceSeconds: params.snapToleranceSeconds,
    start,
  });
  start = quantizeMotionSeconds(snapped.start, params.snapEnabled, params.fps);
  end = quantizeMotionSeconds(snapped.end, params.snapEnabled, params.fps);

  if (params.kind === "MOVE") {
    const duration = quantizeMotionSeconds(initial.duration, params.snapEnabled, params.fps);
    start = clamp(start, 0, params.clipDurationSeconds - duration);
    end = start + duration;
  } else {
    const duration = clamp(end - start, minimumDurationSeconds, maximumDurationSeconds);
    if (params.kind === "RESIZE_START") start = end - duration;
    else end = start + duration;
  }

  const durationSeconds = roundSeconds(end - start);
  const offsetSeconds = params.animation.timing.anchor === "CLIP_START"
    ? start
    : params.clipDurationSeconds - end;
  return {
    anchor: params.animation.timing.anchor,
    durationSeconds,
    offsetSeconds: roundSeconds(Math.max(0, offsetSeconds)),
  };
}

export function resolveCompositionAnimationWindow(
  animation: Pick<CompositionAnimation, "timing">,
  clipDurationSeconds: number,
): CompositionAnimationWindow {
  const start = animation.timing.anchor === "CLIP_START"
    ? animation.timing.offsetSeconds
    : clipDurationSeconds - animation.timing.offsetSeconds - animation.timing.durationSeconds;
  return {
    duration: animation.timing.durationSeconds,
    end: start + animation.timing.durationSeconds,
    start,
  };
}

export function findCompositionAnimationTimingConflict(params: {
  animationId: string;
  animations: CompositionAnimation[];
  clipDurationSeconds: number;
  clipId: string;
  propertyGroup: CompositionAnimation["propertyGroup"];
  timing: CompositionAnimation["timing"];
}) {
  const candidate = resolveCompositionAnimationWindow({ timing: params.timing }, params.clipDurationSeconds);
  return params.animations.find((animation) => {
    if (
      animation.id === params.animationId
      || animation.target.clipId !== params.clipId
      || animation.propertyGroup !== params.propertyGroup
    ) return false;
    const occupied = resolveCompositionAnimationWindow(animation, params.clipDurationSeconds);
    return animationWindowsOverlap(candidate, occupied);
  }) || null;
}

export function planCompositionPresetInsertion(params: {
  animations: CompositionAnimation[];
  clipDurationSeconds: number;
  clipId: string;
  presetId: CompositionMotionPresetId;
}): CompositionPresetInsertionPlan {
  const definition = getCompositionMotionPresetDefinition(params.presetId);
  const durationSeconds = getDefaultCompositionPresetDuration(
    params.presetId,
    params.clipDurationSeconds,
  );
  const occupied = params.animations
    .filter((animation) => (
      animation.target.clipId === params.clipId
      && animation.propertyGroup === definition.propertyGroup
    ))
    .map((animation) => resolveCompositionAnimationWindow(animation, params.clipDurationSeconds))
    .sort((left, right) => left.start - right.start);
  const gaps = collectFreeAnimationWindows(occupied, params.clipDurationSeconds)
    .filter((gap) => gap.duration + MOTION_WINDOW_EPSILON_SECONDS >= durationSeconds);

  if (gaps.length === 0) {
    return {
      available: false,
      durationSeconds,
      offsetSeconds: 0,
      reason: `No queda espacio libre para otra animación de ${motionPropertyGroupLabel(definition.propertyGroup)}.`,
    };
  }

  const start = selectInsertionStart(gaps, durationSeconds, definition.phase, params.clipDurationSeconds);
  const offsetSeconds = definition.phase === "EXIT"
    ? params.clipDurationSeconds - start - durationSeconds
    : start;
  return {
    available: true,
    durationSeconds,
    offsetSeconds: roundSeconds(Math.max(0, offsetSeconds)),
    reason: null,
  };
}

function collectFreeAnimationWindows(
  occupied: CompositionAnimationWindow[],
  clipDurationSeconds: number,
) {
  const gaps: CompositionAnimationWindow[] = [];
  let cursor = 0;
  for (const window of occupied) {
    const start = Math.max(0, window.start);
    const end = Math.min(clipDurationSeconds, window.end);
    if (start > cursor + MOTION_WINDOW_EPSILON_SECONDS) {
      gaps.push({ duration: start - cursor, end: start, start: cursor });
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < clipDurationSeconds - MOTION_WINDOW_EPSILON_SECONDS) {
    gaps.push({ duration: clipDurationSeconds - cursor, end: clipDurationSeconds, start: cursor });
  }
  return gaps;
}

function selectInsertionStart(
  gaps: CompositionAnimationWindow[],
  durationSeconds: number,
  phase: "ENTRY" | "EXIT" | "PLAYBACK",
  clipDurationSeconds: number,
) {
  if (phase === "ENTRY") return gaps[0]!.start;
  if (phase === "EXIT") return gaps.at(-1)!.end - durationSeconds;

  const clipCenter = clipDurationSeconds / 2;
  return gaps
    .map((gap) => {
      const start = clamp(clipCenter - durationSeconds / 2, gap.start, gap.end - durationSeconds);
      return { distance: Math.abs(start + durationSeconds / 2 - clipCenter), start };
    })
    .sort((left, right) => left.distance - right.distance || left.start - right.start)[0]!.start;
}

function animationWindowsOverlap(left: CompositionAnimationWindow, right: CompositionAnimationWindow) {
  return left.start < right.end - MOTION_WINDOW_EPSILON_SECONDS
    && left.end > right.start + MOTION_WINDOW_EPSILON_SECONDS;
}

function snapAnimationWindowToTarget(params: {
  end: number;
  kind: CompositionAnimationTimelineEditKind;
  snapTargetSeconds?: number;
  snapToleranceSeconds?: number;
  start: number;
}) {
  if (params.snapTargetSeconds === undefined || params.snapToleranceSeconds === undefined) {
    return { end: params.end, start: params.start };
  }
  const startDistance = Math.abs(params.start - params.snapTargetSeconds);
  const endDistance = Math.abs(params.end - params.snapTargetSeconds);
  if (params.kind !== "RESIZE_END" && startDistance <= params.snapToleranceSeconds && startDistance <= endDistance) {
    const delta = params.snapTargetSeconds - params.start;
    return params.kind === "MOVE"
      ? { end: params.end + delta, start: params.snapTargetSeconds }
      : { end: params.end, start: params.snapTargetSeconds };
  }
  if (params.kind !== "RESIZE_START" && endDistance <= params.snapToleranceSeconds) {
    const delta = params.snapTargetSeconds - params.end;
    return params.kind === "MOVE"
      ? { end: params.snapTargetSeconds, start: params.start + delta }
      : { end: params.snapTargetSeconds, start: params.start };
  }
  return { end: params.end, start: params.start };
}

function motionPropertyGroupLabel(propertyGroup: CompositionAnimation["propertyGroup"]) {
  if (propertyGroup === "OPACITY") return "opacidad";
  if (propertyGroup === "POSITION") return "posición";
  if (propertyGroup === "ROTATION") return "rotación";
  return "escala";
}

function roundSeconds(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

function quantizeMotionSeconds(value: number, snapEnabled: boolean, fps: number) {
  return snapEnabled ? Math.round(value * fps) / fps : roundSeconds(value);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
