/** Contrato compartido por validadores y operaciones; sin dependencia del framework. */
export const COMPOSITION_GROUP_MAX_DEPTH = 8;
export const COMPOSITION_MAX_GROUPS = 250;
export const COMPOSITION_MAX_CLIPS = 500;
export const COMPOSITION_GROUP_MAX_DIRECT_MEMBERS = 500;
export const COMPOSITION_GROUPING_VERSION = 2;

export interface CompositionGroupNode {
  timelineMode?: "NESTED";
  id: string;
  clipIds: string[];
  childGroupIds?: string[];
  order: number;
  label?: string;
}

export interface CompositionGroupIndex {
  groupsById: Map<string, CompositionGroupNode>;
  parentByClipId: Map<string, string>;
  parentByGroupId: Map<string, string>;
  leavesByGroupId: Map<string, string[]>;
  depthByGroupId: Map<string, number>;
}

export function buildCompositionGroupIndex(groups: readonly CompositionGroupNode[] = []): CompositionGroupIndex {
  const groupsById = new Map(groups.map(group => [group.id, group]));
  const parentByClipId = new Map<string, string>();
  const parentByGroupId = new Map<string, string>();
  for (const group of groups) {
    for (const id of group.clipIds) parentByClipId.set(id, group.id);
    for (const id of group.childGroupIds ?? []) parentByGroupId.set(id, group.id);
  }
  const leavesByGroupId = new Map<string, string[]>();
  const depthByGroupId = new Map<string, number>();
  const visit = (id: string, path: Set<string>): string[] => {
    if (path.has(id) || path.size >= COMPOSITION_GROUP_MAX_DEPTH) throw new Error("La jerarquía contiene un ciclo o excede ocho niveles.");
    const cached = leavesByGroupId.get(id);
    if (cached) return cached;
    const group = groupsById.get(id);
    if (!group) throw new Error("La jerarquía apunta a un grupo inexistente.");
    const nextPath = new Set(path).add(id);
    const leaves = [...group.clipIds, ...(group.childGroupIds ?? []).flatMap(child => visit(child, nextPath))];
    leavesByGroupId.set(id, leaves);
    return leaves;
  };
  for (const group of groups) {
    visit(group.id, new Set());
    let current = group.id;
    let depth = 1;
    const seen = new Set([current]);
    while (parentByGroupId.has(current)) {
      current = parentByGroupId.get(current)!;
      if (seen.has(current) || ++depth > COMPOSITION_GROUP_MAX_DEPTH) throw new Error("La jerarquía contiene un ciclo o excede ocho niveles.");
      seen.add(current);
    }
    depthByGroupId.set(group.id, depth);
  }
  return { groupsById, parentByClipId, parentByGroupId, leavesByGroupId, depthByGroupId };
}

export function validateCompositionGroupGraph(
  groups: readonly CompositionGroupNode[], clipIds: ReadonlySet<string>, groupingVersion?: number,
): string[] {
  const issues: string[] = [];
  const groupIds = new Set(groups.map(group => group.id));
  // Padre único implica un máximo lineal de membresías. Rechazar antes de
  // generar miles de errores para listas duplicadas dentro del límite HTTP.
  const membershipCount = groups.reduce((total, group) => total + group.clipIds.length + (group.childGroupIds?.length ?? 0), 0);
  if (membershipCount > clipIds.size + groupIds.size) return ["La cantidad de membresías excede los elementos de la composición."];
  const orders = new Set<number>();
  const claimedClips = new Set<string>();
  const claimedGroups = new Set<string>();
  if (groupingVersion !== undefined && groupingVersion !== 2) issues.push("La versión de agrupaciones no es compatible.");
  if (groups.length > COMPOSITION_MAX_GROUPS || clipIds.size > COMPOSITION_MAX_CLIPS) issues.push("La composición excede el límite de grupos o clips.");
  if (groupIds.size !== groups.length) issues.push("Hay identificadores de grupo duplicados.");
  for (const group of groups) {
    const children = group.childGroupIds ?? [];
    if (orders.has(group.order)) issues.push("El orden de grupos está repetido.");
    orders.add(group.order);
    if (groupingVersion !== 2 && group.childGroupIds !== undefined) issues.push("Los grupos hijos requieren groupingVersion 2.");
    if (group.clipIds.length + children.length < 2 || group.clipIds.length + children.length > COMPOSITION_GROUP_MAX_DIRECT_MEMBERS) issues.push("Un grupo requiere entre dos y 500 miembros directos.");
    for (const id of group.clipIds) {
      if (!clipIds.has(id)) issues.push(`El grupo ${group.id} apunta al clip inexistente ${id}.`);
      if (claimedClips.has(id)) issues.push(`El clip ${id} pertenece a más de un grupo.`);
      claimedClips.add(id);
    }
    for (const id of children) {
      if (!groupIds.has(id)) issues.push("El grupo hijo no existe.");
      if (claimedGroups.has(id)) issues.push("Un grupo hijo tiene más de un padre.");
      claimedGroups.add(id);
    }
  }
  if (!issues.length) {
    try { buildCompositionGroupIndex(groups); }
    catch (error) { issues.push(error instanceof Error ? error.message : "La jerarquía no es válida."); }
  }
  return issues;
}

export function resolveCompositionGroupClipIds(document: { groups?: CompositionGroupNode[] }, groupId: string): string[] {
  return buildCompositionGroupIndex(document.groups).leavesByGroupId.get(groupId) ?? [];
}

/** Unidad visible que contiene el clip en el nivel actual; null indica clip directo. */
export function resolveCompositionGroupAtLevel(
  index: CompositionGroupIndex, clipId: string, editingGroupId: string | null = null,
): CompositionGroupNode | null {
  let id = index.parentByClipId.get(clipId);
  if (!id || id === editingGroupId) return null;
  while (index.parentByGroupId.has(id) && index.parentByGroupId.get(id) !== editingGroupId) id = index.parentByGroupId.get(id)!;
  return index.groupsById.get(id) ?? null;
}

export function resolveCompositionGroupSelection(
  document: { groups?: CompositionGroupNode[] }, selectedClipIds: ReadonlySet<string>, editingGroupId: string | null = null,
  timelineMode?: "NESTED",
): { clipIds: string[]; childGroupIds: string[] } | null {
  const index = buildCompositionGroupIndex(document.groups);
  const clipIds: string[] = [];
  const childGroupIds = new Set<string>();
  for (const clipId of selectedClipIds) {
    const group = resolveCompositionGroupAtLevel(index, clipId, editingGroupId);
    if (group) {
      if ((index.parentByGroupId.get(group.id) ?? null) !== editingGroupId) return null;
      if (!index.leavesByGroupId.get(group.id)!.every(id => selectedClipIds.has(id))) return null;
      childGroupIds.add(group.id);
    } else {
      if ((index.parentByClipId.get(clipId) ?? null) !== editingGroupId) return null;
      clipIds.push(clipId);
    }
  }
  const selection = { clipIds, childGroupIds: [...childGroupIds] };
  if (clipIds.length + childGroupIds.size >= 2) return selection;
  const [groupId] = selection.childGroupIds;
  return timelineMode === "NESTED" && groupId && !index.groupsById.get(groupId)?.timelineMode ? selection : null;
}

export function compositionGroupsChildrenFirst(groups: readonly CompositionGroupNode[]): CompositionGroupNode[] {
  const index = buildCompositionGroupIndex(groups);
  return [...groups].sort((left, right) => index.depthByGroupId.get(right.id)! - index.depthByGroupId.get(left.id)! || left.order - right.order);
}

/** Selección explícita de unidades completas del nivel editorial actual. */
export function toggleCompositionGroupSelection(document: { groups?: CompositionGroupNode[] }, selectedClipIds: ReadonlySet<string>, groupId: string, editingGroupId: string | null = null): Set<string> {
  const index = buildCompositionGroupIndex(document.groups);
  if (!index.groupsById.has(groupId) || (index.parentByGroupId.get(groupId) ?? null) !== editingGroupId) {
    throw new Error("Selecciona un grupo del nivel actual.");
  }
  const leaves = index.leavesByGroupId.get(groupId)!;
  const next = new Set(selectedClipIds);
  const remove = leaves.every(id => next.has(id));
  for (const id of leaves) { if (remove) next.delete(id); else next.add(id); }
  return next;
}
