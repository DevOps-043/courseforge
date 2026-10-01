import { resolveAvatarAudioLink } from "./composition-avatar-audio-link.service";
import type { CompositionClip, CompositionEditorDocument, CompositionTrack } from "./composition-document.types";
import { findCompositionGroupForClip } from "./composition-group.service";
import { buildCompositionInsertGapPlan } from "./composition-timeline-batch.service";
import type { CompositionEditorPatchOperation } from "./editor-patch.types";

const EDIT_EPSILON_SECONDS = 0.001;

export const COMPOSITION_ASSET_INSERTION_MODES = ["APPEND", "INSERT", "OVERWRITE"] as const;
export type CompositionAssetInsertionMode = typeof COMPOSITION_ASSET_INSERTION_MODES[number];

export class CompositionTimelineEditError extends Error {
  constructor(message: string) {
    super(message);
  }
}

type DerivedIdFactory = (sourceId: string, kind: "clip" | "hf") => string;

export type CompositionAssetPlacementEditPlan = {
  coordinatedRemovedClipIds: string[];
  operations: CompositionEditorPatchOperation[];
};

export function buildCompositionAssetPlacementEditPlan(params: {
  clip: CompositionClip;
  createDerivedId?: DerivedIdFactory;
  document: CompositionEditorDocument;
  mode: CompositionAssetInsertionMode;
  track?: CompositionTrack;
}): CompositionAssetPlacementEditPlan {
  const addOperation: CompositionEditorPatchOperation = {
    clip: params.clip,
    clipId: params.clip.id,
    ...(params.track ? { track: params.track } : {}),
    type: "clip.add",
  };
  if (params.mode === "APPEND") return { coordinatedRemovedClipIds: [], operations: [addOperation] };

  const existingTrack = params.document.tracks.find((track) => track.id === params.clip.trackId);
  if (existingTrack?.locked) throw new CompositionTimelineEditError(`Desbloquea la pista ${existingTrack.label} antes de editarla.`);
  if (!existingTrack && (!params.track || params.track.id !== params.clip.trackId)) {
    throw new CompositionTimelineEditError("El asset necesita una pista válida.");
  }
  if (params.mode === "INSERT") {
    const gap = buildCompositionInsertGapPlan({
      atSeconds: params.clip.startSeconds,
      document: params.document,
      durationSeconds: params.clip.durationSeconds,
      trackIds: [params.clip.trackId],
    });
    return { coordinatedRemovedClipIds: [], operations: [...gap.operations, addOperation] };
  }

  const insertionStart = quantize(params.clip.startSeconds, params.document.canvas.fps);
  const insertionEnd = quantize(insertionStart + params.clip.durationSeconds, params.document.canvas.fps);
  const primaryAffectedClips = params.document.clips.filter((clip) => (
    clip.trackId === params.clip.trackId
    && rangesOverlap(clip.startSeconds, clip.startSeconds + clip.durationSeconds, insertionStart, insertionEnd)
  ));
  const affectedClips = resolveOverwriteAffectedClips({
    document: params.document,
    insertionEnd,
    insertionStart,
    primaryAffectedClips,
  });
  const operations: CompositionEditorPatchOperation[] = [];
  const removedTransitionIds = new Set<string>();
  const fullyRemovedClipIds = new Set(affectedClips.flatMap((clip) => {
    const clipEnd = clip.startSeconds + clip.durationSeconds;
    const keepsLeft = clip.startSeconds < insertionStart - EDIT_EPSILON_SECONDS;
    const keepsRight = clipEnd > insertionEnd + EDIT_EPSILON_SECONDS;
    return !keepsLeft && !keepsRight ? [clip.id] : [];
  }));
  for (const transition of params.document.transitions?.items || []) {
    if (fullyRemovedClipIds.has(transition.fromClipId) || fullyRemovedClipIds.has(transition.toClipId)) {
      // clip.remove owns removal of every connected transition. Marking it here
      // prevents a later partial neighbour from emitting a stale duplicate.
      removedTransitionIds.add(transition.id);
    }
  }
  const createDerivedId = params.createDerivedId || defaultDerivedIdFactory;
  for (const clip of affectedClips) {
    assertOverwriteSafe(params.document, clip, fullyRemovedClipIds);
    const clipEnd = clip.startSeconds + clip.durationSeconds;
    const keepsLeft = clip.startSeconds < insertionStart - EDIT_EPSILON_SECONDS;
    const keepsRight = clipEnd > insertionEnd + EDIT_EPSILON_SECONDS;
    if (!keepsLeft && !keepsRight) {
      operations.push({ clipId: clip.id, type: "clip.remove" });
      continue;
    }
    if (params.document.motion.animations.some((animation) => animation.target.clipId === clip.id)) {
      throw new CompositionTimelineEditError(
        `Quita o ajusta las animaciones de ${clip.label} antes de sobrescribir parcialmente ese clip.`,
      );
    }
    if (keepsLeft && keepsRight) {
      if (clip.source.type !== "PRODUCTION_ASSET" || (clip.kind !== "VIDEO" && clip.kind !== "AUDIO")) {
        throw new CompositionTimelineEditError(
          `La sobrescritura atraviesa el centro de ${clip.label}; divide primero esa capa no multimedia.`,
        );
      }
      operations.push({
        clipId: clip.id,
        endSeconds: insertionEnd,
        newClipId: createDerivedId(clip.id, "clip"),
        newHfId: createDerivedId(clip.hfId, "hf"),
        ripple: false,
        startSeconds: insertionStart,
        type: "clip.remove-range",
      });
      continue;
    }
    if (keepsLeft) {
      appendInvalidatedTransitionRemovals(params.document, clip, "RIGHT", removedTransitionIds, operations);
      operations.push({
        clipId: clip.id,
        durationSeconds: quantize(insertionStart - clip.startSeconds, params.document.canvas.fps),
        sourceOffsetSeconds: clip.sourceOffsetSeconds || 0,
        startSeconds: clip.startSeconds,
        type: "clip.trim",
      });
      continue;
    }
    const nextStart = insertionEnd;
    appendInvalidatedTransitionRemovals(params.document, clip, "LEFT", removedTransitionIds, operations);
    operations.push({
      clipId: clip.id,
      durationSeconds: quantize(clipEnd - nextStart, params.document.canvas.fps),
      sourceOffsetSeconds: resolveSourceOffsetForStart(clip, nextStart),
      startSeconds: nextStart,
      type: "clip.trim",
    });
  }
  if (operations.length + 1 > 100) {
    throw new CompositionTimelineEditError("Overwrite afecta más de 99 clips y excede el límite atómico permitido.");
  }
  // Add first so replacing the only clip in an automatically generated
  // document never crosses the invariant that at least one clip must exist.
  return {
    coordinatedRemovedClipIds: [...fullyRemovedClipIds].filter((clipId) => (
      !primaryAffectedClips.some((clip) => clip.id === clipId)
    )),
    operations: [addOperation, ...operations],
  };
}

export function buildCompositionRollEditPlan(params: {
  deltaFrames: number;
  document: CompositionEditorDocument;
  edge: "LEFT" | "RIGHT";
  selectedClipId?: string;
  selectedClipIds?: Iterable<string>;
}): { operations: CompositionEditorPatchOperation[] } {
  assertFrameDelta(params.deltaFrames);
  const selectedClips = resolveCoordinatedSelection(params.document, params);
  assertAlignedSelection(params.document, selectedClips);
  const selectedIds = new Set(selectedClips.map((clip) => clip.id));
  const pairs = selectedClips.map((selected) => {
    const adjacency = resolveAdjacentClips(params.document, selected, selectedIds);
    const fromClip = params.edge === "LEFT" ? adjacency.previous : selected;
    const toClip = params.edge === "LEFT" ? selected : adjacency.next;
    if (!fromClip || !toClip) {
      throw new CompositionTimelineEditError("El borde elegido no tiene un clip adyacente en todas las pistas coordinadas.");
    }
    assertAdjacentPair(params.document, fromClip, toClip);
    return { fromClip, toClip };
  });
  assertSingleCoordinatedCut(params.document, pairs);
  assertCoupledSetComplete(
    params.document,
    new Set(pairs.flatMap(({ fromClip, toClip }) => [fromClip.id, toClip.id])),
    "roll",
  );
  const deltaSeconds = params.deltaFrames / params.document.canvas.fps;
  const operations = pairs.flatMap(({ fromClip, toClip }) => {
    const nextFromDuration = quantize(fromClip.durationSeconds + deltaSeconds, params.document.canvas.fps);
    const nextToStart = quantize(toClip.startSeconds + deltaSeconds, params.document.canvas.fps);
    const nextToDuration = quantize(toClip.durationSeconds - deltaSeconds, params.document.canvas.fps);
    const nextToOffset = resolveSourceOffsetForStart(toClip, nextToStart);
    assertSourceWindow(params.document, fromClip, fromClip.startSeconds, nextFromDuration, fromClip.sourceOffsetSeconds || 0);
    assertSourceWindow(params.document, toClip, nextToStart, nextToDuration, nextToOffset);
    return [
      buildTrimOperation(fromClip, fromClip.startSeconds, nextFromDuration, fromClip.sourceOffsetSeconds || 0),
      buildTrimOperation(toClip, nextToStart, nextToDuration, nextToOffset),
    ];
  });
  return { operations: assertUniqueOperations(operations) };
}

export function buildCompositionSlideEditPlan(params: {
  deltaFrames: number;
  document: CompositionEditorDocument;
  selectedClipId?: string;
  selectedClipIds?: Iterable<string>;
}): { operations: CompositionEditorPatchOperation[] } {
  assertFrameDelta(params.deltaFrames);
  const selectedClips = resolveCoordinatedSelection(params.document, params);
  assertAlignedSelection(params.document, selectedClips);
  const selectedIds = new Set(selectedClips.map((clip) => clip.id));
  const lanes = selectedClips.map((selected) => {
    const { next, previous } = resolveAdjacentClips(params.document, selected, selectedIds);
    if (!previous || !next) {
      throw new CompositionTimelineEditError("Slide requiere clips adyacentes a ambos lados en todas las pistas coordinadas.");
    }
    assertAdjacentPair(params.document, previous, selected);
    assertAdjacentPair(params.document, selected, next);
    return { next, previous, selected };
  });
  assertCoupledSetComplete(
    params.document,
    new Set(lanes.flatMap(({ next, previous, selected }) => [previous.id, selected.id, next.id])),
    "slide",
  );
  const deltaSeconds = params.deltaFrames / params.document.canvas.fps;
  const operations = lanes.flatMap(({ next, previous, selected }) => {
    const previousDuration = quantize(previous.durationSeconds + deltaSeconds, params.document.canvas.fps);
    const selectedStart = quantize(selected.startSeconds + deltaSeconds, params.document.canvas.fps);
    const nextStart = quantize(next.startSeconds + deltaSeconds, params.document.canvas.fps);
    const nextDuration = quantize(next.durationSeconds - deltaSeconds, params.document.canvas.fps);
    const nextOffset = resolveSourceOffsetForStart(next, nextStart);
    assertSourceWindow(params.document, previous, previous.startSeconds, previousDuration, previous.sourceOffsetSeconds || 0);
    assertSourceWindow(params.document, selected, selectedStart, selected.durationSeconds, selected.sourceOffsetSeconds || 0);
    assertSourceWindow(params.document, next, nextStart, nextDuration, nextOffset);
    return [
      buildTrimOperation(previous, previous.startSeconds, previousDuration, previous.sourceOffsetSeconds || 0),
      // A trim with an unchanged source window moves linked media independently.
      // clip.move owns avatar/voice synchronization and would otherwise apply the
      // same delta twice when both coordinated members are present in this batch.
      buildTrimOperation(selected, selectedStart, selected.durationSeconds, selected.sourceOffsetSeconds || 0),
      buildTrimOperation(next, nextStart, nextDuration, nextOffset),
    ];
  });
  return { operations: assertUniqueOperations(operations) };
}

function assertOverwriteSafe(
  document: CompositionEditorDocument,
  clip: CompositionClip,
  fullyRemovedClipIds: ReadonlySet<string>,
) {
  const track = document.tracks.find((candidate) => candidate.id === clip.trackId);
  if (!track || track.locked) throw new CompositionTimelineEditError("La sobrescritura afecta una pista bloqueada o inexistente.");
  const link = resolveAvatarAudioLink(document, clip.id);
  if (link.status === "AMBIGUOUS") {
    throw new CompositionTimelineEditError(`La escena ${link.sceneId} tiene un vínculo avatar-voz ambiguo.`);
  }
  if (
    link.status === "LINKED"
    && (!fullyRemovedClipIds.has(link.avatar.id) || !fullyRemovedClipIds.has(link.voice.id))
  ) {
    throw new CompositionTimelineEditError("Overwrite parcial no puede romper un par avatar-voz; cubre la escena completa o sepárala primero.");
  }
  const group = findCompositionGroupForClip(document, clip.id);
  if (group && group.clipIds.some((clipId) => !fullyRemovedClipIds.has(clipId))) {
    throw new CompositionTimelineEditError(
      `Overwrite parcial no puede romper ${group.label || "un grupo"}; cubre todos sus miembros o desagrúpalos primero.`,
    );
  }
}

function resolveOverwriteAffectedClips(params: {
  document: CompositionEditorDocument;
  insertionEnd: number;
  insertionStart: number;
  primaryAffectedClips: CompositionClip[];
}) {
  const affectedById = new Map(params.primaryAffectedClips.map((clip) => [clip.id, clip]));
  const pending = [...params.primaryAffectedClips];
  while (pending.length > 0) {
    const clip = pending.shift()!;
    const coordinatedIds = new Set<string>();
    const group = findCompositionGroupForClip(params.document, clip.id);
    for (const groupClipId of group?.clipIds || []) coordinatedIds.add(groupClipId);
    const link = resolveAvatarAudioLink(params.document, clip.id);
    if (link.status === "AMBIGUOUS") {
      throw new CompositionTimelineEditError(`La escena ${link.sceneId} tiene un vínculo avatar-voz ambiguo.`);
    }
    if (link.status === "LINKED") {
      coordinatedIds.add(link.avatar.id);
      coordinatedIds.add(link.voice.id);
    }
    if (coordinatedIds.size === 0) continue;
    const coordinatedClips = [...coordinatedIds].map((clipId) => requireClip(params.document, clipId));
    if (coordinatedClips.some((candidate) => !isFullyCovered(
      candidate,
      params.insertionStart,
      params.insertionEnd,
    ))) {
      throw new CompositionTimelineEditError(
        `Overwrite debe cubrir completamente ${group?.label || (link.status === "LINKED" ? "el par avatar-voz" : clip.label)} para editarlo de forma coordinada.`,
      );
    }
    for (const coordinatedClip of coordinatedClips) {
      if (affectedById.has(coordinatedClip.id)) continue;
      affectedById.set(coordinatedClip.id, coordinatedClip);
      pending.push(coordinatedClip);
    }
  }
  return [...affectedById.values()];
}

function isFullyCovered(clip: CompositionClip, rangeStart: number, rangeEnd: number) {
  return (
    clip.startSeconds >= rangeStart - EDIT_EPSILON_SECONDS
    && clip.startSeconds + clip.durationSeconds <= rangeEnd + EDIT_EPSILON_SECONDS
  );
}

function appendInvalidatedTransitionRemovals(
  document: CompositionEditorDocument,
  clip: CompositionClip,
  changedEdge: "LEFT" | "RIGHT",
  removedTransitionIds: Set<string>,
  operations: CompositionEditorPatchOperation[],
) {
  for (const transition of document.transitions?.items || []) {
    const invalidated = changedEdge === "LEFT"
      ? transition.toClipId === clip.id
      : transition.fromClipId === clip.id;
    if (!invalidated || removedTransitionIds.has(transition.id)) continue;
    removedTransitionIds.add(transition.id);
    operations.push({ transitionId: transition.id, type: "transition.remove" });
  }
}

function assertAdjacentPair(document: CompositionEditorDocument, fromClip: CompositionClip, toClip: CompositionClip) {
  if (fromClip.trackId !== toClip.trackId) throw new CompositionTimelineEditError("Los clips deben pertenecer a la misma pista.");
  if (fromClip.layout.zIndex !== toClip.layout.zIndex) {
    throw new CompositionTimelineEditError("Los clips deben compartir la misma profundidad visual para editar el corte.");
  }
  const track = document.tracks.find((candidate) => candidate.id === fromClip.trackId);
  if (!track || track.locked) throw new CompositionTimelineEditError("Desbloquea la pista antes de editar el corte.");
  if (Math.abs(fromClip.startSeconds + fromClip.durationSeconds - toClip.startSeconds) > 1 / document.canvas.fps + EDIT_EPSILON_SECONDS) {
    throw new CompositionTimelineEditError("Los clips deben ser adyacentes para editar el corte.");
  }
}

function resolveAdjacentClips(
  document: CompositionEditorDocument,
  selected: CompositionClip,
  excludedClipIds: ReadonlySet<string> = new Set(),
) {
  const clips = document.clips
    .filter((clip) => (
      clip.trackId === selected.trackId
      && clip.id !== selected.id
      && !excludedClipIds.has(clip.id)
    ))
    .slice()
    .sort((left, right) => left.startSeconds - right.startSeconds || left.id.localeCompare(right.id));
  const frameTolerance = 1 / document.canvas.fps + EDIT_EPSILON_SECONDS;
  const nextCandidates = clips.filter((clip) => (
    clip.layout.zIndex === selected.layout.zIndex
    && Math.abs(clip.startSeconds - (selected.startSeconds + selected.durationSeconds)) <= frameTolerance
  ));
  const previousCandidates = clips.filter((clip) => (
    clip.layout.zIndex === selected.layout.zIndex
    && Math.abs(clip.startSeconds + clip.durationSeconds - selected.startSeconds) <= frameTolerance
  ));
  if (nextCandidates.length > 1 || previousCandidates.length > 1) {
    throw new CompositionTimelineEditError("El punto de edición es ambiguo porque varias subfilas comparten el mismo corte.");
  }
  return {
    next: nextCandidates[0] || null,
    previous: previousCandidates[0] || null,
  };
}

function resolveCoordinatedSelection(
  document: CompositionEditorDocument,
  params: { selectedClipId?: string; selectedClipIds?: Iterable<string> },
) {
  const pending = [...new Set([
    ...(params.selectedClipIds ? [...params.selectedClipIds] : []),
    ...(params.selectedClipId ? [params.selectedClipId] : []),
  ])];
  if (pending.length === 0) throw new CompositionTimelineEditError("Selecciona al menos un clip para editar.");
  const resolvedIds = new Set<string>();
  while (pending.length > 0) {
    const clipId = pending.shift()!;
    if (resolvedIds.has(clipId)) continue;
    const clip = requireClip(document, clipId);
    resolvedIds.add(clip.id);
    const group = findCompositionGroupForClip(document, clip.id);
    for (const memberId of group?.clipIds || []) {
      if (!resolvedIds.has(memberId)) pending.push(memberId);
    }
    const link = resolveAvatarAudioLink(document, clip.id);
    if (link.status === "AMBIGUOUS") {
      throw new CompositionTimelineEditError(`La escena ${link.sceneId} tiene un vínculo avatar-voz ambiguo.`);
    }
    if (link.status === "LINKED") {
      for (const linkedId of [link.avatar.id, link.voice.id]) {
        if (!resolvedIds.has(linkedId)) pending.push(linkedId);
      }
    }
  }
  return [...resolvedIds]
    .map((clipId) => requireClip(document, clipId))
    .sort((left, right) => left.trackId.localeCompare(right.trackId) || left.id.localeCompare(right.id));
}

function assertAlignedSelection(document: CompositionEditorDocument, clips: CompositionClip[]) {
  const [reference, ...rest] = clips;
  if (!reference) throw new CompositionTimelineEditError("Selecciona al menos un clip para editar.");
  const tolerance = 1 / document.canvas.fps + EDIT_EPSILON_SECONDS;
  if (rest.some((clip) => (
    Math.abs(clip.startSeconds - reference.startSeconds) > tolerance
    || Math.abs(clip.durationSeconds - reference.durationSeconds) > tolerance
  ))) {
    throw new CompositionTimelineEditError(
      "Los clips coordinados deben compartir inicio y duración antes de aplicar roll o slide.",
    );
  }
}

function assertSingleCoordinatedCut(
  document: CompositionEditorDocument,
  pairs: Array<{ fromClip: CompositionClip; toClip: CompositionClip }>,
) {
  const [reference, ...rest] = pairs;
  if (!reference) return;
  const cut = reference.fromClip.startSeconds + reference.fromClip.durationSeconds;
  const tolerance = 1 / document.canvas.fps + EDIT_EPSILON_SECONDS;
  if (rest.some(({ fromClip }) => Math.abs(fromClip.startSeconds + fromClip.durationSeconds - cut) > tolerance)) {
    throw new CompositionTimelineEditError("Las pistas coordinadas no comparten el mismo punto de corte.");
  }
}

function assertCoupledSetComplete(
  document: CompositionEditorDocument,
  affectedClipIds: ReadonlySet<string>,
  operationLabel: "roll" | "slide",
) {
  for (const clipId of affectedClipIds) {
    const group = findCompositionGroupForClip(document, clipId);
    if (group && group.clipIds.some((memberId) => !affectedClipIds.has(memberId))) {
      throw new CompositionTimelineEditError(
        `El ${operationLabel} afectaría solo una parte de ${group.label || "un grupo"}; alinea todos sus miembros primero.`,
      );
    }
    const link = resolveAvatarAudioLink(document, clipId);
    if (link.status === "AMBIGUOUS") {
      throw new CompositionTimelineEditError(`La escena ${link.sceneId} tiene un vínculo avatar-voz ambiguo.`);
    }
    if (
      link.status === "LINKED"
      && (!affectedClipIds.has(link.avatar.id) || !affectedClipIds.has(link.voice.id))
    ) {
      throw new CompositionTimelineEditError(`El ${operationLabel} debe conservar completo el par avatar-voz.`);
    }
  }
}

function buildTrimOperation(
  clip: CompositionClip,
  startSeconds: number,
  durationSeconds: number,
  sourceOffsetSeconds: number,
): CompositionEditorPatchOperation {
  return {
    clipId: clip.id,
    durationSeconds,
    sourceOffsetSeconds,
    startSeconds,
    type: "clip.trim",
  };
}

function assertUniqueOperations(operations: CompositionEditorPatchOperation[]) {
  const clipIds = new Set<string>();
  for (const operation of operations) {
    if (!("clipId" in operation) || !operation.clipId) continue;
    if (clipIds.has(operation.clipId)) {
      throw new CompositionTimelineEditError("La selección coordinada produce operaciones duplicadas sobre un mismo clip.");
    }
    clipIds.add(operation.clipId);
  }
  if (operations.length > 100) {
    throw new CompositionTimelineEditError("La edición coordinada excede el límite atómico de 100 operaciones.");
  }
  return operations;
}

function assertSourceWindow(
  document: CompositionEditorDocument,
  clip: CompositionClip,
  startSeconds: number,
  durationSeconds: number,
  sourceOffsetSeconds: number,
) {
  const minimumDuration = 1 / document.canvas.fps;
  if (startSeconds < -EDIT_EPSILON_SECONDS || durationSeconds < minimumDuration - EDIT_EPSILON_SECONDS) {
    throw new CompositionTimelineEditError("La edición debe conservar al menos un frame válido por clip.");
  }
  if (clip.kind !== "VIDEO" && clip.kind !== "AUDIO") return;
  if (sourceOffsetSeconds < -EDIT_EPSILON_SECONDS) {
    throw new CompositionTimelineEditError(`${clip.label} no tiene suficiente material antes de su inicio.`);
  }
  if (!clip.sourceDurationSeconds) {
    if (
      sourceOffsetSeconds < (clip.sourceOffsetSeconds || 0) - EDIT_EPSILON_SECONDS
      || sourceOffsetSeconds + durationSeconds > (clip.sourceOffsetSeconds || 0) + clip.durationSeconds + EDIT_EPSILON_SECONDS
    ) {
      throw new CompositionTimelineEditError(`Verifica la duración fuente de ${clip.label} antes de extenderlo.`);
    }
    return;
  }
  if (sourceOffsetSeconds + durationSeconds > clip.sourceDurationSeconds + EDIT_EPSILON_SECONDS) {
    throw new CompositionTimelineEditError(`${clip.label} no tiene suficiente material después de su final.`);
  }
}

function resolveSourceOffsetForStart(clip: CompositionClip, nextStartSeconds: number) {
  if (clip.kind !== "VIDEO" && clip.kind !== "AUDIO") return clip.sourceOffsetSeconds || 0;
  return quantize((clip.sourceOffsetSeconds || 0) + nextStartSeconds - clip.startSeconds, 1_000);
}

function requireClip(document: CompositionEditorDocument, clipId: string) {
  const clip = document.clips.find((candidate) => candidate.id === clipId);
  if (!clip) throw new CompositionTimelineEditError("El clip seleccionado ya no existe.");
  return clip;
}

function assertFrameDelta(deltaFrames: number) {
  if (!Number.isInteger(deltaFrames) || deltaFrames === 0 || Math.abs(deltaFrames) > 300) {
    throw new CompositionTimelineEditError("El ajuste debe usar entre 1 y 300 frames completos.");
  }
}

function rangesOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  return leftStart < rightEnd - EDIT_EPSILON_SECONDS && leftEnd > rightStart + EDIT_EPSILON_SECONDS;
}

function quantize(value: number, fps: number) {
  return Math.round(value * fps) / fps;
}

function defaultDerivedIdFactory(sourceId: string, kind: "clip" | "hf") {
  return `${kind}-${sourceId.slice(0, 72)}-${crypto.randomUUID().slice(0, 8)}`;
}
