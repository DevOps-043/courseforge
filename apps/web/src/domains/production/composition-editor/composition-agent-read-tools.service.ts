import type { CompositionEditorDocument } from "./composition-document.types";
import { COMPOSITION_MOTION_MAX_ANIMATIONS, COMPOSITION_MOTION_PRESET_IDS } from "./composition-motion.types";

export const COMPOSITION_AGENT_READ_LIMITS = Object.freeze({
  maxClips: 500,
  maxTracks: 32,
  maxAnimations: COMPOSITION_MOTION_MAX_ANIMATIONS,
  maxConflictComparisons: 20_000,
  maxConflicts: 500,
  maxSnapshotBytes: 256 * 1024,
});

export class CompositionAgentReadError extends Error {
  constructor(readonly code: "AGENT_READ_LIMIT_EXCEEDED" | "AGENT_READ_FORBIDDEN" | "AGENT_READ_EXPIRED" | "AGENT_READ_STALE", message: string) {
    super(message);
  }
}

export function assertCompositionAgentReadDocumentLimits(document: CompositionEditorDocument) {
  if (document.clips.length > COMPOSITION_AGENT_READ_LIMITS.maxClips
    || document.tracks.length > COMPOSITION_AGENT_READ_LIMITS.maxTracks
    || document.motion.animations.length > COMPOSITION_AGENT_READ_LIMITS.maxAnimations) {
    throw new CompositionAgentReadError("AGENT_READ_LIMIT_EXCEEDED", "La composición excede el presupuesto de lectura del agente.");
  }
}

/** Only freeze a detached projection, never the host's editor document. */
export function freezeCompositionAgentReadValue<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (item: unknown) => {
    if (!item || typeof item !== "object" || Object.isFrozen(item)) return;
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(copy);
  return copy;
}

export function compositionAgentReadBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function getCompositionAgentTimelineConflicts(document: CompositionEditorDocument, consumeWork: (units: number) => void = () => {}) {
  assertCompositionAgentReadDocumentLimits(document);
  const conflicts: Array<{ clipIds: [string, string]; overlapSeconds: number; trackId: string }> = [];
  let comparisons = 0;
  for (const track of document.tracks) {
    const clips = document.clips
      .filter((clip) => clip.trackId === track.id && !clip.hidden)
      .sort((left, right) => left.startSeconds - right.startSeconds);
    for (let index = 0; index < clips.length; index += 1) {
      for (let next = index + 1; next < clips.length; next += 1) {
        const left = clips[index]!;
        const right = clips[next]!;
        consumeWork(1);
        if (++comparisons > COMPOSITION_AGENT_READ_LIMITS.maxConflictComparisons) {
          throw new CompositionAgentReadError("AGENT_READ_LIMIT_EXCEEDED", "La búsqueda de conflictos excede el presupuesto de comparaciones.");
        }
        if (right.startSeconds >= left.startSeconds + left.durationSeconds - 0.001) break;
        const overlap = Math.min(left.startSeconds + left.durationSeconds, right.startSeconds + right.durationSeconds)
          - Math.max(left.startSeconds, right.startSeconds);
        if (overlap > 0.001) conflicts.push({ clipIds: [left.id, right.id], overlapSeconds: overlap, trackId: track.id });
        if (conflicts.length > COMPOSITION_AGENT_READ_LIMITS.maxConflicts) {
          throw new CompositionAgentReadError("AGENT_READ_LIMIT_EXCEEDED", "Hay demasiados conflictos para una lectura completa del agente.");
        }
      }
    }
  }
  return conflicts;
}

/** Executes read-only, local tools and returns a frozen snapshot for one model turn. */
export function buildCompositionAgentReadSnapshot(document: CompositionEditorDocument, selectedClipId: string | null) {
  assertCompositionAgentReadDocumentLimits(document);
  const composition = projectCompositionAgentReadDocument(document);
  const snapshot = {
    availableTools: ["get_composition", "get_selected_elements", "get_timeline_conflicts", "get_motion_catalog"] as const,
    composition,
    motionCatalog: { presetIds: [...COMPOSITION_MOTION_PRESET_IDS] },
    selectedElements: selectedClipId
      ? composition.clips.filter((clip) => clip.id === selectedClipId)
      : [],
    timelineConflicts: getCompositionAgentTimelineConflicts(document),
  };
  if (compositionAgentReadBytes(snapshot) > COMPOSITION_AGENT_READ_LIMITS.maxSnapshotBytes) {
    throw new CompositionAgentReadError("AGENT_READ_LIMIT_EXCEEDED", "El contexto excede el presupuesto de bytes del agente.");
  }
  return freezeCompositionAgentReadValue(snapshot);
}

/** Projection shared by the legacy context and the authorized tool session. */
export function projectCompositionAgentReadDocument(document: CompositionEditorDocument) {
  assertCompositionAgentReadDocumentLimits(document);
  return {
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
}
