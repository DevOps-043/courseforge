import type { CompositionEditorDocument } from "./composition-document.types";
import { resolveCompositionGroupBounds } from "./composition-group.service";

/**
 * Visual-only palette for logical groups in the composition timeline.
 *
 * Group membership remains an editorial concern; these classes are never
 * serialized in the composition document or sent to the renderer.
 */
export const COMPOSITION_GROUP_COLORS = [
  {
    defaultClip: "border-violet-500/80 bg-violet-50 text-violet-950 hover:bg-violet-100 dark:bg-violet-400/20 dark:text-violet-100 dark:hover:bg-violet-400/30",
    key: "violet",
    overlay: "border-violet-400/70 bg-violet-300/10",
    selectedClip: "border-violet-700 bg-violet-600 text-white ring-2 ring-violet-300/80",
    selectedOverlay: "border-violet-500 bg-violet-400/20 ring-1 ring-violet-400",
  },
  {
    defaultClip: "border-sky-500/80 bg-sky-50 text-sky-950 hover:bg-sky-100 dark:bg-sky-400/20 dark:text-sky-100 dark:hover:bg-sky-400/30",
    key: "sky",
    overlay: "border-sky-400/70 bg-sky-300/10",
    selectedClip: "border-sky-700 bg-sky-600 text-white ring-2 ring-sky-300/80",
    selectedOverlay: "border-sky-500 bg-sky-400/20 ring-1 ring-sky-400",
  },
  {
    defaultClip: "border-fuchsia-500/80 bg-fuchsia-50 text-fuchsia-950 hover:bg-fuchsia-100 dark:bg-fuchsia-400/20 dark:text-fuchsia-100 dark:hover:bg-fuchsia-400/30",
    key: "fuchsia",
    overlay: "border-fuchsia-400/70 bg-fuchsia-300/10",
    selectedClip: "border-fuchsia-700 bg-fuchsia-600 text-white ring-2 ring-fuchsia-300/80",
    selectedOverlay: "border-fuchsia-500 bg-fuchsia-400/20 ring-1 ring-fuchsia-400",
  },
  {
    defaultClip: "border-amber-500/80 bg-amber-50 text-amber-950 hover:bg-amber-100 dark:bg-amber-400/20 dark:text-amber-100 dark:hover:bg-amber-400/30",
    key: "amber",
    overlay: "border-amber-400/70 bg-amber-300/10",
    selectedClip: "border-amber-700 bg-amber-600 text-white ring-2 ring-amber-300/80",
    selectedOverlay: "border-amber-500 bg-amber-400/20 ring-1 ring-amber-400",
  },
  {
    defaultClip: "border-emerald-500/80 bg-emerald-50 text-emerald-950 hover:bg-emerald-100 dark:bg-emerald-400/20 dark:text-emerald-100 dark:hover:bg-emerald-400/30",
    key: "emerald",
    overlay: "border-emerald-400/70 bg-emerald-300/10",
    selectedClip: "border-emerald-700 bg-emerald-600 text-white ring-2 ring-emerald-300/80",
    selectedOverlay: "border-emerald-500 bg-emerald-400/20 ring-1 ring-emerald-400",
  },
  {
    defaultClip: "border-rose-500/80 bg-rose-50 text-rose-950 hover:bg-rose-100 dark:bg-rose-400/20 dark:text-rose-100 dark:hover:bg-rose-400/30",
    key: "rose",
    overlay: "border-rose-400/70 bg-rose-300/10",
    selectedClip: "border-rose-700 bg-rose-600 text-white ring-2 ring-rose-300/80",
    selectedOverlay: "border-rose-500 bg-rose-400/20 ring-1 ring-rose-400",
  },
  {
    defaultClip: "border-indigo-500/80 bg-indigo-50 text-indigo-950 hover:bg-indigo-100 dark:bg-indigo-400/20 dark:text-indigo-100 dark:hover:bg-indigo-400/30",
    key: "indigo",
    overlay: "border-indigo-400/70 bg-indigo-300/10",
    selectedClip: "border-indigo-700 bg-indigo-600 text-white ring-2 ring-indigo-300/80",
    selectedOverlay: "border-indigo-500 bg-indigo-400/20 ring-1 ring-indigo-400",
  },
  {
    defaultClip: "border-orange-500/80 bg-orange-50 text-orange-950 hover:bg-orange-100 dark:bg-orange-400/20 dark:text-orange-100 dark:hover:bg-orange-400/30",
    key: "orange",
    overlay: "border-orange-400/70 bg-orange-300/10",
    selectedClip: "border-orange-700 bg-orange-600 text-white ring-2 ring-orange-300/80",
    selectedOverlay: "border-orange-500 bg-orange-400/20 ring-1 ring-orange-400",
  },
] as const;

export type CompositionGroupColor = typeof COMPOSITION_GROUP_COLORS[number];

type ResolvedGroup = {
  colorIndex: number;
  endSeconds: number;
  groupId: string;
  startSeconds: number;
};

/**
 * Colors simultaneous groups differently and reuses a color only after the
 * preceding group has ended. This keeps intersecting groups recognizable
 * without expanding the persisted composition contract.
 */
export function resolveCompositionGroupColors(
  document: Pick<CompositionEditorDocument, "clips" | "groups">,
): ReadonlyMap<string, CompositionGroupColor> {
  const groupsWithBounds = (document.groups || [])
    .flatMap((group) => {
      const bounds = resolveCompositionGroupBounds(document, group.id);
      return bounds ? [{ ...bounds, groupId: group.id, order: group.order }] : [];
    })
    .sort((left, right) => (
      left.startSeconds - right.startSeconds
      || left.endSeconds - right.endSeconds
      || left.order - right.order
      || left.groupId.localeCompare(right.groupId)
    ));

  const activeGroups: ResolvedGroup[] = [];
  const colorsByGroupId = new Map<string, CompositionGroupColor>();

  for (const group of groupsWithBounds) {
    const stillActiveGroups = activeGroups.filter((candidate) => candidate.endSeconds > group.startSeconds);
    activeGroups.splice(0, activeGroups.length, ...stillActiveGroups);
    const occupiedColorIndexes = new Set(activeGroups.map((candidate) => candidate.colorIndex));
    const availableColorIndex = COMPOSITION_GROUP_COLORS.findIndex((_, index) => !occupiedColorIndexes.has(index));
    const colorIndex = availableColorIndex >= 0
      ? availableColorIndex
      : activeGroups.length % COMPOSITION_GROUP_COLORS.length;

    colorsByGroupId.set(group.groupId, COMPOSITION_GROUP_COLORS[colorIndex]!);
    activeGroups.push({ colorIndex, endSeconds: group.endSeconds, groupId: group.groupId, startSeconds: group.startSeconds });
  }

  return colorsByGroupId;
}
