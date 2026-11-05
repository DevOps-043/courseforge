import type { CompositionEditorDocument, CompositionGroup } from "./composition-document.types";
import { buildCompositionGroupIndex } from "./composition-group-hierarchy";
import { resolveCompositionGroupBounds } from "./composition-group.service";
import { buildCompositionTimelineLayout } from "./composition-timeline-layout.service";

/** Proyección editorial: nunca altera el documento que consumen preview y render. */
export function resolveCompositionTimelineNesting(document: CompositionEditorDocument, editingGroupId: string | null) {
  const index = buildCompositionGroupIndex(document.groups);
  const hiddenClipIds = new Set<string>();
  const containers: Array<{ group: CompositionGroup; bounds: NonNullable<ReturnType<typeof resolveCompositionGroupBounds>> }> = [];
  const scope = editingGroupId ? new Set(index.leavesByGroupId.get(editingGroupId) ?? []) : null;
  const visit = (parentId: string | null) => {
    for (const group of document.groups ?? []) {
      if ((index.parentByGroupId.get(group.id) ?? null) !== parentId) continue;
      if (group.timelineMode !== "NESTED") { visit(group.id); continue; }
      const clipIds = index.leavesByGroupId.get(group.id) ?? [];
      const bounds = resolveCompositionGroupBounds(document, group.id, index);
      if (!bounds) continue;
      containers.push({ group: { ...group, clipIds }, bounds });
      for (const id of clipIds) hiddenClipIds.add(id);
    }
  };
  visit(editingGroupId);
  const clips = document.clips.filter(clip => !hiddenClipIds.has(clip.id) && (!scope || scope.has(clip.id)));
  const visibleIds = new Set(clips.map(clip => clip.id));
  // Resolver transiciones sobre el documento completo antes de ocultar miembros;
  // sus extremos pueden estar dentro y fuera del contenedor editorial.
  const layout = buildCompositionTimelineLayout(document);
  return {
    containers,
    clips,
    groups: layout.groups.map(group => ({
      ...group,
      clips: group.clips.filter(clip => visibleIds.has(clip.id)),
      lanes: group.lanes.map(lane => ({ ...lane, clips: lane.clips.filter(clip => visibleIds.has(clip.id)) })).filter(lane => lane.clips.length > 0),
    })).filter(group => group.clips.length > 0),
  };
}
