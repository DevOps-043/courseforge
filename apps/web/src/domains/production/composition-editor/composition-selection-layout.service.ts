import type { CompositionClip, CompositionEditorDocument } from "./composition-document.types";
import type { CompositionEditorPatchOperation } from "./editor-patch.types";

const LAYOUT_EPSILON = 0.000_001;
const MAX_LAYOUT_OPERATIONS = 100;

export const COMPOSITION_SELECTION_ALIGNMENTS = [
  "LEFT",
  "HORIZONTAL_CENTER",
  "RIGHT",
  "TOP",
  "VERTICAL_CENTER",
  "BOTTOM",
] as const;
export type CompositionSelectionAlignment = typeof COMPOSITION_SELECTION_ALIGNMENTS[number];
export type CompositionSelectionAlignmentTarget = "CANVAS" | "SELECTION";
export type CompositionSelectionDistributionAxis = "HORIZONTAL" | "VERTICAL";

export class CompositionSelectionLayoutError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Builds an atomic layout-only patch. Coordinates use the persisted, unrotated
 * layout box so preview and render receive exactly the same deterministic data.
 */
export function buildCompositionSelectionAlignmentPlan(params: {
  alignment: CompositionSelectionAlignment;
  clipIds: Iterable<string>;
  document: CompositionEditorDocument;
  target: CompositionSelectionAlignmentTarget;
}): { operations: CompositionEditorPatchOperation[]; visualClipCount: number } {
  const selectedIds = normalizeSelection(params.clipIds);
  const clips = resolveEditableVisualClips(params.document, selectedIds);
  if (params.target === "SELECTION" && clips.length < 2) {
    throw new CompositionSelectionLayoutError("Selecciona al menos dos elementos visuales para alinearlos entre sí.");
  }
  assertCompleteVisualGroups(params.document, selectedIds);

  const bounds = params.target === "CANVAS"
    ? { bottom: params.document.canvas.height, left: 0, right: params.document.canvas.width, top: 0 }
    : resolveSelectionBounds(clips);
  const operations = clips.flatMap((clip) => {
    const layout = resolveAlignedLayout(clip, params.alignment, bounds);
    return hasLayoutChange(clip, layout)
      ? [{ clipId: clip.id, layout, type: "clip.layout" as const }]
      : [];
  });
  assertUsefulPlan(operations);
  return { operations, visualClipCount: clips.length };
}

/** Equalizes edge-to-edge spacing while keeping the two outer objects fixed. */
export function buildCompositionSelectionDistributionPlan(params: {
  axis: CompositionSelectionDistributionAxis;
  clipIds: Iterable<string>;
  document: CompositionEditorDocument;
}): { operations: CompositionEditorPatchOperation[]; visualClipCount: number } {
  const selectedIds = normalizeSelection(params.clipIds);
  const clips = resolveEditableVisualClips(params.document, selectedIds);
  if (clips.length < 3) {
    throw new CompositionSelectionLayoutError("Selecciona al menos tres elementos visuales para distribuirlos.");
  }
  assertCompleteVisualGroups(params.document, selectedIds);

  const horizontal = params.axis === "HORIZONTAL";
  const ordered = [...clips].sort((left, right) => {
    const primary = horizontal ? left.layout.x - right.layout.x : left.layout.y - right.layout.y;
    return Math.abs(primary) > LAYOUT_EPSILON ? primary : left.id.localeCompare(right.id);
  });
  const first = ordered[0]!;
  const last = ordered.at(-1)!;
  const firstStart = horizontal ? first.layout.x : first.layout.y;
  const lastEnd = horizontal
    ? last.layout.x + last.layout.width
    : last.layout.y + last.layout.height;
  const occupiedSize = ordered.reduce(
    (total, clip) => total + (horizontal ? clip.layout.width : clip.layout.height),
    0,
  );
  const spacing = (lastEnd - firstStart - occupiedSize) / (ordered.length - 1);
  let cursor = firstStart;
  const operations: CompositionEditorPatchOperation[] = [];
  for (const clip of ordered) {
    const layout = horizontal ? { x: normalizeCoordinate(cursor) } : { y: normalizeCoordinate(cursor) };
    if (hasLayoutChange(clip, layout)) operations.push({ clipId: clip.id, layout, type: "clip.layout" });
    cursor += (horizontal ? clip.layout.width : clip.layout.height) + spacing;
  }
  assertUsefulPlan(operations);
  return { operations, visualClipCount: clips.length };
}

function normalizeSelection(clipIds: Iterable<string>) {
  const ids = new Set(clipIds);
  if (ids.size === 0) throw new CompositionSelectionLayoutError("Selecciona al menos un elemento.");
  if (ids.size > MAX_LAYOUT_OPERATIONS) {
    throw new CompositionSelectionLayoutError(`La acción admite como máximo ${MAX_LAYOUT_OPERATIONS} elementos.`);
  }
  return ids;
}

function resolveEditableVisualClips(document: CompositionEditorDocument, selectedIds: ReadonlySet<string>) {
  const tracksById = new Map(document.tracks.map((track) => [track.id, track]));
  const missingId = [...selectedIds].find((id) => !document.clips.some((clip) => clip.id === id));
  if (missingId) throw new CompositionSelectionLayoutError("La selección contiene un elemento que ya no existe.");
  const clips = document.clips.filter((clip) => {
    if (!selectedIds.has(clip.id)) return false;
    const track = tracksById.get(clip.trackId);
    if (!track) throw new CompositionSelectionLayoutError("La selección contiene un elemento sin pista válida.");
    if (track.kind === "AUDIO") return false;
    if (track.locked) throw new CompositionSelectionLayoutError(`Desbloquea la pista ${track.label} antes de modificar el layout.`);
    return true;
  });
  if (clips.length === 0) {
    throw new CompositionSelectionLayoutError("La selección no contiene elementos visuales editables.");
  }
  return clips;
}

function assertCompleteVisualGroups(document: CompositionEditorDocument, selectedIds: ReadonlySet<string>) {
  const visualTrackIds = new Set(document.tracks.filter((track) => track.kind !== "AUDIO").map((track) => track.id));
  for (const group of document.groups || []) {
    const visualIds = group.clipIds.filter((clipId) => {
      const clip = document.clips.find((candidate) => candidate.id === clipId);
      return clip && visualTrackIds.has(clip.trackId);
    });
    const selectedCount = visualIds.filter((clipId) => selectedIds.has(clipId)).length;
    if (selectedCount > 0 && selectedCount !== visualIds.length) {
      throw new CompositionSelectionLayoutError("Selecciona todos los elementos visuales del grupo antes de cambiar su layout.");
    }
  }
}

function resolveSelectionBounds(clips: CompositionClip[]) {
  return {
    bottom: Math.max(...clips.map((clip) => clip.layout.y + clip.layout.height)),
    left: Math.min(...clips.map((clip) => clip.layout.x)),
    right: Math.max(...clips.map((clip) => clip.layout.x + clip.layout.width)),
    top: Math.min(...clips.map((clip) => clip.layout.y)),
  };
}

function resolveAlignedLayout(
  clip: CompositionClip,
  alignment: CompositionSelectionAlignment,
  bounds: { bottom: number; left: number; right: number; top: number },
) {
  if (alignment === "LEFT") return { x: normalizeCoordinate(bounds.left) };
  if (alignment === "HORIZONTAL_CENTER") {
    return { x: normalizeCoordinate((bounds.left + bounds.right - clip.layout.width) / 2) };
  }
  if (alignment === "RIGHT") return { x: normalizeCoordinate(bounds.right - clip.layout.width) };
  if (alignment === "TOP") return { y: normalizeCoordinate(bounds.top) };
  if (alignment === "VERTICAL_CENTER") {
    return { y: normalizeCoordinate((bounds.top + bounds.bottom - clip.layout.height) / 2) };
  }
  return { y: normalizeCoordinate(bounds.bottom - clip.layout.height) };
}

function hasLayoutChange(clip: CompositionClip, layout: { x?: number; y?: number }) {
  return (layout.x !== undefined && Math.abs(layout.x - clip.layout.x) > LAYOUT_EPSILON)
    || (layout.y !== undefined && Math.abs(layout.y - clip.layout.y) > LAYOUT_EPSILON);
}

function normalizeCoordinate(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function assertUsefulPlan(operations: CompositionEditorPatchOperation[]) {
  if (operations.length === 0) throw new CompositionSelectionLayoutError("La selección ya tiene esa distribución.");
  if (operations.length > MAX_LAYOUT_OPERATIONS) {
    throw new CompositionSelectionLayoutError(`La acción supera el máximo de ${MAX_LAYOUT_OPERATIONS} operaciones atómicas.`);
  }
}
