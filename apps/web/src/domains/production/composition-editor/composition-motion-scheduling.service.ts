import {
  getCompositionMotionPresetDefinition,
  getDefaultCompositionPresetDuration,
} from "./composition-motion-preset.service";
import type {
  CompositionAnimation,
  CompositionMotionPresetId,
} from "./composition-motion.types";
import {
  buildTimelineSnapTargets,
  resolveTimelineSnap,
  type TimelineSnapMatch,
  type TimelineSnapTarget,
} from "./composition-timeline-snap.service";
import type { CompositionClip } from "./composition-document.types";

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

export type CompositionAnimationTimelineSnapEdit = {
  snapMatch: TimelineSnapMatch | null;
  timing: CompositionAnimation["timing"];
};

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

/** Applies magnetic alignment without allowing the animation to leave its clip or overlap a peer. */
export function buildCompositionAnimationTimelineSnapEdit(params: {
  animation: CompositionAnimation;
  animations: CompositionAnimation[];
  clips: Array<Pick<CompositionClip, "hidden" | "id" | "label" | "durationSeconds" | "startSeconds">>;
  clipDurationSeconds: number;
  clipStartSeconds: number;
  deltaSeconds: number;
  fps: number;
  kind: CompositionAnimationTimelineEditKind;
  maximumDurationSeconds: number;
  playheadSeconds: number;
  snapEnabled: boolean;
  snapToleranceSeconds: number;
}): CompositionAnimationTimelineSnapEdit {
  const timing = buildCompositionAnimationTimelineEdit({
    animation: params.animation,
    clipDurationSeconds: params.clipDurationSeconds,
    deltaSeconds: params.deltaSeconds,
    fps: params.fps,
    kind: params.kind,
    maximumDurationSeconds: params.maximumDurationSeconds,
    snapEnabled: params.snapEnabled,
  });
  if (!params.snapEnabled) return { snapMatch: null, timing };

  const window = resolveCompositionAnimationWindow({ timing }, params.clipDurationSeconds);
  const targets = buildCompositionAnimationSnapTargets({
    animation: params.animation,
    animations: params.animations,
    clips: params.clips,
    clipDurationSeconds: params.clipDurationSeconds,
    clipStartSeconds: params.clipStartSeconds,
    playheadSeconds: params.playheadSeconds,
  });
  const anchors = params.kind === "MOVE"
    ? [
        { edge: "START" as const, timeSeconds: params.clipStartSeconds + window.start },
        { edge: "END" as const, timeSeconds: params.clipStartSeconds + window.end },
      ]
    : [{
        edge: params.kind === "RESIZE_START" ? "START" as const : "END" as const,
        timeSeconds: params.clipStartSeconds + (params.kind === "RESIZE_START" ? window.start : window.end),
      }];
  const snap = resolveTimelineSnap({
    anchors,
    isValidDelta: (snapDelta) => Boolean(resolveValidAnimationSnapTiming({
      animation: params.animation,
      animations: params.animations,
      clipDurationSeconds: params.clipDurationSeconds,
      fps: params.fps,
      kind: params.kind,
      maximumDurationSeconds: params.maximumDurationSeconds,
      snapDelta,
      timing,
    })),
    targets,
    toleranceSeconds: params.snapToleranceSeconds,
  });
  if (!snap.match) return { snapMatch: null, timing };

  return {
    snapMatch: snap.match,
    timing: resolveValidAnimationSnapTiming({
      animation: params.animation,
      animations: params.animations,
      clipDurationSeconds: params.clipDurationSeconds,
      fps: params.fps,
      kind: params.kind,
      maximumDurationSeconds: params.maximumDurationSeconds,
      snapDelta: snap.deltaSeconds,
      timing,
    }) || timing,
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

function buildCompositionAnimationSnapTargets(params: {
  animation: CompositionAnimation;
  animations: CompositionAnimation[];
  clips: Array<Pick<CompositionClip, "hidden" | "id" | "label" | "durationSeconds" | "startSeconds">>;
  clipDurationSeconds: number;
  clipStartSeconds: number;
  playheadSeconds: number;
}): TimelineSnapTarget[] {
  const targets: TimelineSnapTarget[] = buildTimelineSnapTargets({
    clips: params.clips,
    playheadSeconds: params.playheadSeconds,
  });

  for (const candidate of params.animations) {
    if (
      candidate.id === params.animation.id
      || candidate.target.clipId !== params.animation.target.clipId
    ) continue;
    const window = resolveCompositionAnimationWindow(candidate, params.clipDurationSeconds);
    const animationLabel = candidate.preset
      ? getCompositionMotionPresetDefinition(candidate.preset.id).label
      : candidate.propertyGroup;
    targets.push({
      animationId: candidate.id,
      animationLabel,
      source: "ANIMATION_START",
      timeSeconds: params.clipStartSeconds + window.start,
    }, {
      animationId: candidate.id,
      animationLabel,
      source: "ANIMATION_END",
      timeSeconds: params.clipStartSeconds + window.end,
    });
  }

  return targets;
}

function resolveValidAnimationSnapTiming(params: {
  animation: CompositionAnimation;
  animations: CompositionAnimation[];
  clipDurationSeconds: number;
  fps: number;
  kind: CompositionAnimationTimelineEditKind;
  maximumDurationSeconds: number;
  snapDelta: number;
  timing: CompositionAnimation["timing"];
}) {
  const before = resolveCompositionAnimationWindow({ timing: params.timing }, params.clipDurationSeconds);
  const timing = buildCompositionAnimationTimelineEdit({
    animation: { timing: params.timing },
    clipDurationSeconds: params.clipDurationSeconds,
    deltaSeconds: params.snapDelta,
    fps: params.fps,
    kind: params.kind,
    maximumDurationSeconds: params.maximumDurationSeconds,
    snapEnabled: false,
  });
  const after = resolveCompositionAnimationWindow({ timing }, params.clipDurationSeconds);
  const expectedStart = before.start + (params.kind === "RESIZE_END" ? 0 : params.snapDelta);
  const expectedEnd = before.end + (params.kind === "RESIZE_START" ? 0 : params.snapDelta);
  if (
    Math.abs(after.start - expectedStart) > MOTION_WINDOW_EPSILON_SECONDS
    || Math.abs(after.end - expectedEnd) > MOTION_WINDOW_EPSILON_SECONDS
  ) return null;
  const conflict = findCompositionAnimationTimingConflict({
    animationId: params.animation.id,
    animations: params.animations,
    clipDurationSeconds: params.clipDurationSeconds,
    clipId: params.animation.target.clipId,
    propertyGroup: params.animation.propertyGroup,
    timing,
  });
  return conflict ? null : timing;
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
