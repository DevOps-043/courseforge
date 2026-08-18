import type { CompositionEditorDocument } from "./composition-document.types";
import type {
  CompositionAgentAffectedRange,
  CompositionAgentFieldChange,
} from "./composition-agent-proposal.types";
import type { CompositionEditorPatchOperation } from "./editor-patch.types";

const CLIP_FIELDS = [
  "durationSeconds",
  "hidden",
  "startSeconds",
  "trackId",
] as const;
const LAYOUT_FIELDS = [
  "height",
  "opacity",
  "rotation",
  "width",
  "x",
  "y",
  "zIndex",
] as const;
const TRACK_FIELDS = [
  "hidden",
  "locked",
  "muted",
  "volume",
] as const;
const AUDIO_MIX_FIELDS = [
  "attackSeconds",
  "duckedVolumeRatio",
  "enabled",
  "releaseSeconds",
] as const;

/** Returns a safe semantic diff and deliberately omits source HTML and asset references. */
export function buildCompositionAgentDiff(
  before: CompositionEditorDocument,
  after: CompositionEditorDocument,
): CompositionAgentFieldChange[] {
  const changes: CompositionAgentFieldChange[] = [];
  const beforeClips = new Map(before.clips.map((clip) => [clip.id, clip]));
  const afterClips = new Map(after.clips.map((clip) => [clip.id, clip]));
  for (const clipId of sortedUnion(beforeClips.keys(), afterClips.keys())) {
    const previous = beforeClips.get(clipId);
    const next = afterClips.get(clipId);
    if (!previous || !next) continue;
    for (const field of CLIP_FIELDS) {
      addChange(changes, "CLIP", clipId, `/clips/${clipId}/${field}`, previous[field], next[field]);
    }
    for (const field of LAYOUT_FIELDS) {
      addChange(changes, "CLIP", clipId, `/clips/${clipId}/layout/${field}`, previous.layout[field], next.layout[field]);
    }
  }

  const beforeTracks = new Map(before.tracks.map((track) => [track.id, track]));
  const afterTracks = new Map(after.tracks.map((track) => [track.id, track]));
  for (const trackId of sortedUnion(beforeTracks.keys(), afterTracks.keys())) {
    const previous = beforeTracks.get(trackId);
    const next = afterTracks.get(trackId);
    if (!previous || !next) continue;
    for (const field of TRACK_FIELDS) {
      addChange(
        changes,
        "TRACK",
        trackId,
        `/tracks/${trackId}/${field}`,
        normalizeOptionalTrackValue(field, previous[field]),
        normalizeOptionalTrackValue(field, next[field]),
      );
    }
  }

  for (const field of AUDIO_MIX_FIELDS) {
    addChange(
      changes,
      "AUDIO_MIX",
      "ducking",
      `/audioMix/ducking/${field}`,
      before.audioMix.ducking[field],
      after.audioMix.ducking[field],
    );
  }

  const beforeAnimations = new Map(before.motion.animations.map((animation) => [animation.id, animation]));
  const afterAnimations = new Map(after.motion.animations.map((animation) => [animation.id, animation]));
  for (const animationId of sortedUnion(beforeAnimations.keys(), afterAnimations.keys())) {
    const previous = beforeAnimations.get(animationId);
    const next = afterAnimations.get(animationId);
    if (!previous || !next) {
      addChange(
        changes,
        "ANIMATION",
        animationId,
        `/motion/animations/${animationId}`,
        previous ? summarizeAnimation(previous) : null,
        next ? summarizeAnimation(next) : null,
      );
      continue;
    }
    for (const field of ["anchor", "durationSeconds", "offsetSeconds"] as const) {
      addChange(
        changes,
        "ANIMATION",
        animationId,
        `/motion/animations/${animationId}/timing/${field}`,
        previous.timing[field],
        next.timing[field],
      );
    }
  }
  return changes;
}

export function buildCompositionAgentAffectedRanges(params: {
  after: CompositionEditorDocument;
  before: CompositionEditorDocument;
  operations: CompositionEditorPatchOperation[];
}): CompositionAgentAffectedRange[] {
  const ranges: CompositionAgentAffectedRange[] = [];
  for (const operation of params.operations) {
    if (operation.type === "animation.add-preset" || operation.type === "animation.update-timing") {
      const beforeAnimation = operation.type === "animation.update-timing"
        ? params.before.motion.animations.find((animation) => animation.id === operation.animationId)
        : null;
      const afterAnimation = params.after.motion.animations.find((animation) => animation.id === operation.animationId);
      if (beforeAnimation) addClipRange(ranges, params.before, beforeAnimation.target.clipId);
      if (afterAnimation) addClipRange(ranges, params.after, afterAnimation.target.clipId);
      continue;
    }
    if ("clipId" in operation) {
      addClipRange(ranges, params.before, operation.clipId);
      addClipRange(ranges, params.after, operation.clipId);
      continue;
    }
    if (operation.type === "track.update") {
      for (const clip of params.after.clips.filter((candidate) => candidate.trackId === operation.trackId)) {
        addRange(ranges, clip.startSeconds, clip.startSeconds + clip.durationSeconds);
      }
      continue;
    }
    if (operation.type === "audio-mix.update") {
      addRange(ranges, 0, params.after.canvas.durationSeconds);
    }
  }
  return mergeRanges(ranges);
}

function addChange(
  changes: CompositionAgentFieldChange[],
  entityType: CompositionAgentFieldChange["entityType"],
  entityId: string,
  path: string,
  before: unknown,
  after: unknown,
) {
  if (Object.is(before, after)) return;
  changes.push({ after, before, entityId, entityType, path });
}

function addClipRange(ranges: CompositionAgentAffectedRange[], document: CompositionEditorDocument, clipId: string) {
  const clip = document.clips.find((candidate) => candidate.id === clipId);
  if (clip) addRange(ranges, clip.startSeconds, clip.startSeconds + clip.durationSeconds);
}

function addRange(ranges: CompositionAgentAffectedRange[], startSeconds: number, endSeconds: number) {
  if (endSeconds <= startSeconds) return;
  ranges.push({
    endSeconds: roundSeconds(endSeconds),
    startSeconds: roundSeconds(startSeconds),
  });
}

function mergeRanges(ranges: CompositionAgentAffectedRange[]) {
  const sorted = ranges.slice().sort((left, right) => left.startSeconds - right.startSeconds);
  const merged: CompositionAgentAffectedRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range.startSeconds > previous.endSeconds + 0.001) {
      merged.push({ ...range });
      continue;
    }
    previous.endSeconds = Math.max(previous.endSeconds, range.endSeconds);
  }
  return merged;
}

function normalizeOptionalTrackValue(field: typeof TRACK_FIELDS[number], value: boolean | number | undefined) {
  if (value !== undefined) return value;
  return field === "volume" ? 1 : false;
}

function summarizeAnimation(animation: CompositionEditorDocument["motion"]["animations"][number]) {
  return {
    origin: animation.origin,
    presetId: animation.preset?.id || null,
    propertyGroup: animation.propertyGroup,
    targetClipId: animation.target.clipId,
    timing: animation.timing,
  };
}

function sortedUnion(left: Iterable<string>, right: Iterable<string>) {
  return [...new Set([...left, ...right])].sort();
}

function roundSeconds(value: number) {
  return Math.round(value * 1_000) / 1_000;
}
