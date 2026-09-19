import type {
  CompositionEditorDocument,
  CompositionGroup,
} from "./composition-document.types";

export interface CompositionGroupBounds {
  durationSeconds: number;
  endSeconds: number;
  startSeconds: number;
}

export function findCompositionGroupForClip(
  document: Pick<CompositionEditorDocument, "groups">,
  clipId: string,
) {
  return document.groups?.find((group) => group.clipIds.includes(clipId)) || null;
}

export function resolveCompositionGroupBounds(
  document: Pick<CompositionEditorDocument, "clips" | "groups">,
  groupId: string,
): CompositionGroupBounds | null {
  const group = document.groups?.find((candidate) => candidate.id === groupId);
  if (!group) return null;
  const members = group.clipIds.flatMap((clipId) => {
    const clip = document.clips.find((candidate) => candidate.id === clipId);
    return clip ? [clip] : [];
  });
  if (members.length !== group.clipIds.length || members.length < 2) return null;
  const startSeconds = Math.min(...members.map((clip) => clip.startSeconds));
  const endSeconds = Math.max(...members.map((clip) => clip.startSeconds + clip.durationSeconds));
  return {
    durationSeconds: endSeconds - startSeconds,
    endSeconds,
    startSeconds,
  };
}

/**
 * Removes dangling memberships and dissolves groups that no longer contain at
 * least two clips. Order is compacted deterministically for stable documents.
 */
export function normalizeCompositionGroups(
  groups: CompositionGroup[] | undefined,
  clips: Pick<CompositionEditorDocument["clips"][number], "id">[],
): CompositionGroup[] | undefined {
  if (!groups) return undefined;
  const availableClipIds = new Set(clips.map((clip) => clip.id));
  const claimedClipIds = new Set<string>();
  const normalized = groups
    .slice()
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .flatMap((group) => {
      const clipIds = group.clipIds.filter((clipId) => {
        if (!availableClipIds.has(clipId) || claimedClipIds.has(clipId)) return false;
        claimedClipIds.add(clipId);
        return true;
      });
      return clipIds.length >= 2 ? [{ ...group, clipIds }] : [];
    })
    .map((group, order) => ({ ...group, order }));
  return normalized.length > 0 ? normalized : [];
}

export function appendDerivedClipToCompositionGroup(
  groups: CompositionGroup[] | undefined,
  sourceClipId: string,
  derivedClipId: string,
) {
  if (!groups) return;
  const group = groups.find((candidate) => candidate.clipIds.includes(sourceClipId));
  if (group && !group.clipIds.includes(derivedClipId)) group.clipIds.push(derivedClipId);
}

