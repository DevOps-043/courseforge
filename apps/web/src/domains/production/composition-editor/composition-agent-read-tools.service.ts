import type { CompositionEditorDocument } from "./composition-document.types";
import { COMPOSITION_MOTION_PRESET_IDS } from "./composition-motion.types";

function getTimelineConflicts(document: CompositionEditorDocument) {
  const conflicts: Array<{ clipIds: [string, string]; overlapSeconds: number; trackId: string }> = [];
  for (const track of document.tracks) {
    const clips = document.clips
      .filter((clip) => clip.trackId === track.id && !clip.hidden)
      .sort((left, right) => left.startSeconds - right.startSeconds);
    for (let index = 0; index < clips.length; index += 1) {
      for (let next = index + 1; next < clips.length; next += 1) {
        const left = clips[index]!;
        const right = clips[next]!;
        const overlap = Math.min(left.startSeconds + left.durationSeconds, right.startSeconds + right.durationSeconds)
          - Math.max(left.startSeconds, right.startSeconds);
        if (overlap > 0.001) conflicts.push({ clipIds: [left.id, right.id], overlapSeconds: overlap, trackId: track.id });
      }
    }
  }
  return conflicts;
}

/** Executes read-only, local tools and returns a frozen snapshot for one model turn. */
export function buildCompositionAgentReadSnapshot(document: CompositionEditorDocument, selectedClipId: string | null) {
  const composition = {
    audioMix: document.audioMix,
    canvas: document.canvas,
    clips: document.clips.map((clip) => ({
      durationSeconds: clip.durationSeconds,
      hidden: clip.hidden,
      id: clip.id,
      kind: clip.kind,
      label: clip.label,
      layout: clip.layout,
      startSeconds: clip.startSeconds,
      trackId: clip.trackId,
    })),
    motion: document.motion.animations.map((animation) => ({
      id: animation.id,
      keyframeCount: animation.keyframes.length,
      origin: animation.origin,
      preset: animation.preset,
      propertyGroup: animation.propertyGroup,
      targetClipId: animation.target.clipId,
      timing: animation.timing,
    })),
    tracks: document.tracks.map((track) => ({
      hidden: track.hidden || false,
      id: track.id,
      kind: track.kind,
      label: track.label,
      locked: track.locked,
      muted: track.muted || false,
      order: track.order,
      semanticRole: track.semanticRole,
      volume: track.volume ?? 1,
    })),
  };
  return {
    availableTools: ["get_composition", "get_selected_elements", "get_timeline_conflicts", "get_motion_catalog"] as const,
    composition,
    motionCatalog: { presetIds: [...COMPOSITION_MOTION_PRESET_IDS] },
    selectedElements: selectedClipId
      ? composition.clips.filter((clip) => clip.id === selectedClipId)
      : [],
    timelineConflicts: getTimelineConflicts(document),
  };
}
