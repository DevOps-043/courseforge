import type { CompositionEditorDocument, CompositionGroup } from "./composition-document.types";
import { buildCompositionGroupIndex, COMPOSITION_MAX_GROUPS, resolveCompositionGroupAtLevel, validateCompositionGroupGraph, type CompositionGroupIndex } from "./composition-group-hierarchy";

export interface CompositionGroupBounds {
  durationSeconds: number;
  endSeconds: number;
  startSeconds: number;
}

/** Las operaciones coordinadas existentes actúan sobre la raíz completa. */
export function findCompositionGroupForClip(document: Pick<CompositionEditorDocument, "groups">, clipId: string): CompositionGroup | null {
  const index = buildCompositionGroupIndex(document.groups);
  const group = resolveCompositionGroupAtLevel(index, clipId);
  return group ? { ...group, clipIds: index.leavesByGroupId.get(group.id)! } : null;
}

export function resolveCompositionGroupBounds(document: Pick<CompositionEditorDocument, "clips" | "groups">, groupId: string, index: CompositionGroupIndex = buildCompositionGroupIndex(document.groups)): CompositionGroupBounds | null {
  const ids = index.leavesByGroupId.get(groupId) ?? [];
  const byId = new Map(document.clips.map(clip => [clip.id, clip]));
  const members = ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  if (members.length !== ids.length || members.length < 2) return null;
  const startSeconds = Math.min(...members.map(clip => clip.startSeconds));
  const endSeconds = Math.max(...members.map(clip => clip.startSeconds + clip.durationSeconds));
  return { startSeconds, endSeconds, durationSeconds: endSeconds - startSeconds };
}

/** Normaliza exclusivamente el resultado de una edición válida; nunca repara entrada externa. */
export function normalizeCompositionGroups(groups: CompositionGroup[] | undefined, clips: Pick<CompositionEditorDocument["clips"][number], "id">[]): CompositionGroup[] | undefined {
  if (!groups) return undefined;
  const available = new Set(clips.map(clip => clip.id));
  let normalized = groups.map(group => ({ ...group, clipIds: group.clipIds.filter(id => available.has(id)),
    ...(group.childGroupIds ? { childGroupIds: [...group.childGroupIds] } : {}) }));
  for (;;) {
    const invalid = normalized.find(group => group.clipIds.length + (group.childGroupIds?.length ?? 0) < 2);
    if (!invalid) break;
    for (const parent of normalized) {
      if (!parent.childGroupIds?.includes(invalid.id)) continue;
      parent.childGroupIds = parent.childGroupIds.flatMap(id => id === invalid.id ? invalid.childGroupIds ?? [] : [id]);
      parent.clipIds.push(...invalid.clipIds);
    }
    normalized = normalized.filter(group => group.id !== invalid.id);
  }
  return normalized.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map((group, order) => ({ ...group, order }));
}

export function appendDerivedClipToCompositionGroup(groups: CompositionGroup[] | undefined, sourceClipId: string, derivedClipId: string) {
  const group = groups?.find(candidate => candidate.clipIds.includes(sourceClipId));
  if (group && !group.clipIds.includes(derivedClipId)) group.clipIds.push(derivedClipId);
}

export function ungroupCompositionGroup(groups: CompositionGroup[], groupId: string): CompositionGroup[] {
  const removed = groups.find(group => group.id === groupId)!;
  return groups.filter(group => group.id !== groupId).map(group => !group.childGroupIds?.includes(groupId) ? group : ({
    ...group, clipIds: [...group.clipIds, ...removed.clipIds],
    childGroupIds: group.childGroupIds.flatMap(id => id === groupId ? removed.childGroupIds ?? [] : [id]),
  }));
}

/** Un único reducer de pertenencia para el patch y la proyección de duración. */
export function wrapCompositionGroup(document: {
  clips: Array<{ id: string }>;
  groups?: CompositionGroup[];
  groupingVersion?: 2;
}, operation: { groupId: string; clipIds: string[]; childGroupIds?: string[]; label?: string }) {
  const groups = document.groups ?? [];
  const index = buildCompositionGroupIndex(groups);
  const children = operation.childGroupIds ?? [];
  if (index.groupsById.has(operation.groupId) || groups.length >= COMPOSITION_MAX_GROUPS) throw new Error("El grupo ya existe o se alcanzó el máximo de grupos.");
  const available = new Set(document.clips.map(clip => clip.id));
  if (operation.clipIds.length + children.length < 2 || new Set(operation.clipIds).size !== operation.clipIds.length
    || new Set(children).size !== children.length || operation.clipIds.some(id => !available.has(id))
    || children.some(id => !index.groupsById.has(id))) throw new Error("Un grupo requiere al menos dos miembros existentes y distintos.");
  const parents = new Set([...operation.clipIds.map(id => index.parentByClipId.get(id) ?? null), ...children.map(id => index.parentByGroupId.get(id) ?? null)]);
  if (parents.size !== 1) throw new Error("Selecciona miembros del mismo nivel y padre.");
  const parentId = [...parents][0];
  if (parentId && operation.childGroupIds === undefined && document.groupingVersion !== 2) throw new Error("Cada clip solo puede pertenecer a un grupo.");
  if (children.length || parentId) document.groupingVersion = 2;
  if (parentId) {
    const parent = groups.find(group => group.id === parentId)!;
    parent.clipIds = parent.clipIds.filter(id => !operation.clipIds.includes(id));
    parent.childGroupIds = [...(parent.childGroupIds ?? []).filter(id => !children.includes(id)), operation.groupId];
  }
  groups.sort((left, right) => left.order - right.order).forEach((group, order) => { group.order = order; });
  groups.push({ clipIds: [...operation.clipIds], id: operation.groupId, ...(children.length ? { childGroupIds: [...children] } : {}),
    ...(operation.label ? { label: operation.label } : {}), order: groups.length });
  document.groups = normalizeCompositionGroups(groups, document.clips);
  const issues = validateCompositionGroupGraph(document.groups ?? [], available, document.groupingVersion);
  if (issues.length) throw new Error(issues[0]);
}
