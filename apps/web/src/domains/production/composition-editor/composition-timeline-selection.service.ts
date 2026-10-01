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
  hfIds?: ReadonlyArray<string>;
  origin: CompositionPreviewSelectionOrigin;
}

export interface CompositionPreviewSelectionEventDecision {
  nextClipIds: string[] | null;
  shouldClearGroup: boolean;
  shouldOpenProperties: boolean;
  shouldOpenSelection: boolean;
}

/**
 * An iframe selection can be a direct canvas interaction or an acknowledgement
 * of a timeline command. Only direct canvas interactions may replace a
 * timeline multi-selection.
 */
export function resolveCompositionPreviewSelectionEvent({
  clips,
  hfId,
  hfIds,
  origin,
}: CompositionPreviewSelectionEventInput): CompositionPreviewSelectionEventDecision {
  if (origin === "PARENT") {
    return { nextClipIds: null, shouldClearGroup: false, shouldOpenProperties: false, shouldOpenSelection: false };
  }

  const requestedHfIds = hfIds === undefined ? (hfId ? [hfId] : []) : [...new Set(hfIds)];
  const requestedHfIdSet = new Set(requestedHfIds);
  const nextClipIds = clips.filter((clip) => requestedHfIdSet.has(clip.hfId)).map((clip) => clip.id);
  const selectedClip = hfId ? clips.find((clip) => clip.hfId === hfId) : null;
  return {
    nextClipIds,
    shouldClearGroup: true,
    shouldOpenProperties: Boolean(selectedClip) && nextClipIds.length === 1,
    shouldOpenSelection: nextClipIds.length > 1,
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
