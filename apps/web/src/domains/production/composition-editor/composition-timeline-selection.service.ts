import type { CompositionPreviewSelectionOrigin } from "./composition-preview-protocol";

export interface CompositionTimelineSelectionClip {
  hfId: string;
  id: string;
}

export interface CompositionTimelineSelectionSyncInput {
  clips: ReadonlyArray<CompositionTimelineSelectionClip>;
  selectedClipIds: ReadonlySet<string>;
  selectedGroupId: string | null;
  selectedHfId: string | null;
}

export interface CompositionTimelineSelectionSyncDecision {
  nextClipIds: string[] | null;
  shouldClearGroup: boolean;
}

export interface CompositionPreviewSelectionEventInput {
  clips: ReadonlyArray<CompositionTimelineSelectionClip>;
  hfId: string | null;
  origin: CompositionPreviewSelectionOrigin;
}

export interface CompositionPreviewSelectionEventDecision {
  nextClipIds: string[] | null;
  shouldClearGroup: boolean;
  shouldOpenProperties: boolean;
}

/**
 * An iframe selection can be a direct canvas interaction or an acknowledgement
 * of a timeline command. Only direct canvas interactions may replace a
 * timeline multi-selection.
 */
export function resolveCompositionPreviewSelectionEvent({
  clips,
  hfId,
  origin,
}: CompositionPreviewSelectionEventInput): CompositionPreviewSelectionEventDecision {
  if (origin === "PARENT") {
    return { nextClipIds: null, shouldClearGroup: false, shouldOpenProperties: false };
  }

  const selectedClip = hfId ? clips.find((clip) => clip.hfId === hfId) : null;
  return {
    nextClipIds: selectedClip ? [selectedClip.id] : [],
    shouldClearGroup: true,
    shouldOpenProperties: Boolean(selectedClip),
  };
}

/**
 * Resolves only the state changes required to keep preview and timeline
 * selection aligned. `nextClipIds: null` deliberately means "do not call the
 * state setter" so an already-empty selection remains referentially stable.
 */
export function resolveCompositionTimelineSelectionSync({
  clips,
  selectedClipIds,
  selectedGroupId,
  selectedHfId,
}: CompositionTimelineSelectionSyncInput): CompositionTimelineSelectionSyncDecision {
  if (!selectedHfId) {
    return {
      nextClipIds: selectedClipIds.size > 0 ? [] : null,
      shouldClearGroup: selectedGroupId !== null,
    };
  }

  const selectedClip = clips.find((clip) => clip.hfId === selectedHfId);
  if (!selectedClip || selectedClipIds.has(selectedClip.id)) {
    return { nextClipIds: null, shouldClearGroup: false };
  }

  return { nextClipIds: [selectedClip.id], shouldClearGroup: false };
}
