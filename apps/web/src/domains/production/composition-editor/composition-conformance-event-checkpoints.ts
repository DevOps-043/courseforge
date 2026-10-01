import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "./composition-document.types";
import { buildCompositionMotionRuntime } from "./composition-motion-runtime";
import { scheduleCompositionMotion } from "./composition-motion-timeline";
import { buildCompositionTransitionRuntime } from "./composition-transition-runtime";
import { scheduleCompositionTransitions } from "./composition-transition-timeline";
import { COMPOSITION_CHECKPOINT_PLAN_MAX_REASON_REFERENCES, COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS,
  COMPOSITION_EVENT_CHECKPOINT_POLICY, COMPOSITION_CHECKPOINT_FRAME_SNAP_EPSILON,
  COMPOSITION_CHECKPOINT_UNIFORM_SEGMENTS } from "./composition-conformance-checkpoint-policy";

export type ConformanceEventCheckpoint = {frameIndex: number; timeSeconds: number; reasons: string[]};

/** Enumerate every supported native event; partitioning never samples or discards candidates. */
export function buildCompositionEventCheckpointPlan(input: CompositionEditorDocument) {
  const document = compositionEditorDocumentSchema.parse(input);
  const fps = document.canvas.fps, frameCount = Math.ceil(document.canvas.durationSeconds * fps);
  const candidates = new Map<number, Set<string>>();
  let reasonReferences = 0;
  const snapFramePosition = (position: number) => {
    const nearestHalfFrame = Math.round(position * 2) / 2;
    return Math.abs(position - nearestHalfFrame) < COMPOSITION_CHECKPOINT_FRAME_SNAP_EPSILON ? nearestHalfFrame : position;
  };
  const addFrame = (frame: number, reason: string) => {
    const frameIndex = Math.max(0, Math.min(frameCount - 1, frame));
    const reasons = candidates.get(frameIndex) ?? new Set<string>();
    if (!reasons.has(reason)) {
      if (++reasonReferences > COMPOSITION_CHECKPOINT_PLAN_MAX_REASON_REFERENCES) throw new Error("CONFORMANCE_EVENT_PLAN_CAPACITY_EXCEEDED");
      reasons.add(reason);
    }
    candidates.set(frameIndex, reasons);
  };
  const event = (seconds: number, reason: string) => {
    // Values just outside the composition are not observable events.
    if (seconds < 0 || seconds > document.canvas.durationSeconds) return;
    const position = seconds * fps;
    const snapped = snapFramePosition(position);
    addFrame(Math.ceil(snapped) - 1, `before:${reason}`);
    addFrame(Math.round(snapped), `at:${reason}`);
    addFrame(Math.floor(snapped) + 1, `after:${reason}`);
  };
  const midpoint = (start: number, duration: number, reason: string) => {
    if (start + duration / 2 >= 0 && start + duration / 2 <= document.canvas.durationSeconds) {
      addFrame(Math.round(snapFramePosition((start + duration / 2) * fps)), `midpoint:${reason}`);
    }
  };
  event(0, "composition-start"); event(document.canvas.durationSeconds, "composition-end");
  for (let index = 1; index < COMPOSITION_CHECKPOINT_UNIFORM_SEGMENTS; index++) {
    addFrame(Math.round(snapFramePosition(document.canvas.durationSeconds * fps * index / COMPOSITION_CHECKPOINT_UNIFORM_SEGMENTS)), "uniform-sample");
  }
  for (const clip of document.clips) {
    const end = clip.startSeconds + clip.durationSeconds;
    event(clip.startSeconds, `clip-start:${clip.id}`); event(end, `clip-end:${clip.id}`);
    midpoint(clip.startSeconds, clip.durationSeconds, `clip:${clip.id}`);
    if (clip.freezeTailSeconds !== undefined) {
      event(end - clip.freezeTailSeconds, `freeze-source-end:${clip.id}`);
      midpoint(end - clip.freezeTailSeconds, clip.freezeTailSeconds, `freeze-tail:${clip.id}`);
    }
    if (clip.fadeInSeconds) {
      event(clip.startSeconds + clip.fadeInSeconds, `fade-in-end:${clip.id}`);
      midpoint(clip.startSeconds, clip.fadeInSeconds, `fade-in:${clip.id}`);
    }
    if (clip.fadeOutSeconds) {
      event(end - clip.fadeOutSeconds, `fade-out-start:${clip.id}`);
      midpoint(end - clip.fadeOutSeconds, clip.fadeOutSeconds, `fade-out:${clip.id}`);
    }
    if (clip.source.type === "NATIVE_CAPTIONS") for (const cue of clip.source.cues) {
      event(clip.startSeconds + cue.startSeconds, `cue-start:${clip.id}:${cue.id}`);
      event(clip.startSeconds + cue.endSeconds, `cue-end:${clip.id}:${cue.id}`);
      midpoint(clip.startSeconds + cue.startSeconds, cue.endSeconds - cue.startSeconds, `cue:${clip.id}:${cue.id}`);
      for (const word of cue.words ?? []) {
        event(clip.startSeconds + word.startSeconds, `word-start:${clip.id}:${cue.id}:${word.id}`);
        event(clip.startSeconds + word.endSeconds, `word-end:${clip.id}:${cue.id}:${word.id}`);
        midpoint(clip.startSeconds + word.startSeconds, word.endSeconds - word.startSeconds, `word:${clip.id}:${cue.id}:${word.id}`);
      }
    }
  }
  const transitions = buildCompositionTransitionRuntime(document);
  for (const transition of transitions.items) {
    event(transition.startSeconds, `transition-start:${transition.id}`);
    event(transition.endSeconds, `transition-end:${transition.id}`);
    // DIP_TO_COLOR has discrete visibility changes at this midpoint.
    event(transition.startSeconds + transition.durationSeconds / 2, `transition-midpoint:${transition.id}`);
  }
  for (const [id, window] of transitions.clipWindowsById) {
    event(window.startSeconds, `runtime-start:${id}`); event(window.endSeconds, `runtime-end:${id}`);
  }
  const transitionTween = (target: string, values: Record<string, number | string | boolean>, position: number) => {
    const duration = values.duration as number;
    event(position, `transition-tween:${target}`); event(position + duration, `transition-tween:${target}`);
    midpoint(position, duration, `transition-segment:${target}`);
  };
  scheduleCompositionTransitions({
    set(target: string, _values, position) {event(position, `transition-set:${target}`);},
    to: transitionTween,
    fromTo(target: string, _from, values, position) {transitionTween(target, values, position);},
  }, transitions.items, (id) => id);
  scheduleCompositionMotion({
    set(target: string, _values, position) {event(position, `motion-set:${target}`);},
    to(target: string, values, position) {
      const duration = values.duration as number, repetitions = (values.repeat as number | undefined) ?? 0;
      for (let repeat = 0; repeat <= repetitions; repeat++) {
        const start = position + repeat * duration;
        event(start, `motion-keyframe:${target}`); event(start + duration, `motion-keyframe:${target}`);
        midpoint(start, duration, `motion-segment:${target}`);
      }
    },
  }, buildCompositionMotionRuntime(document), (id) => id);
  const checkpoints: ConformanceEventCheckpoint[] = [...candidates].sort(([left], [right]) => left - right)
    .map(([frameIndex, reasons]) => ({frameIndex, reasons: [...reasons].sort(), timeSeconds: Number((frameIndex / fps).toFixed(6))}));
  const batches: ConformanceEventCheckpoint[][] = [];
  for (let start = 0; start < checkpoints.length; start += COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS) {
    batches.push(checkpoints.slice(start, start + COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS));
  }
  return {policy: COMPOSITION_EVENT_CHECKPOINT_POLICY, frameCount, reasonReferences, checkpointCount: checkpoints.length, batches};
}

/** Current durable capture handles one batch. Never silently reduce a complete plan to fit it. */
export function requireSingleEventCheckpointBatch(document: CompositionEditorDocument): ConformanceEventCheckpoint[] {
  const plan = buildCompositionEventCheckpointPlan(document);
  if (plan.batches.length !== 1) throw new Error("CONFORMANCE_EVENT_PLAN_REQUIRES_BATCH_EXECUTION");
  return plan.batches[0]!;
}
