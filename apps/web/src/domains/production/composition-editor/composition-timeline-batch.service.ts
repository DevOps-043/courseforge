import type { CompositionEditorDocument } from "./composition-document.types";
import { COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS } from "./composition-document.types.constants";
import { resolveAvatarAudioLink } from "./composition-avatar-audio-link.service";
import type { CompositionEditorPatchOperation } from "./editor-patch.types";

const MAX_BATCH_OPERATIONS = 100;
const TIMELINE_EPSILON_SECONDS = 0.001;

export class CompositionTimelineBatchError extends Error {
  constructor(message: string) {
    super(message);
  }
}

type IdFactory = (kind: "animation" | "clip" | "group" | "scene", sourceId: string) => string;

export type CompositionDuplicateSelectionPlan = {
  duplicateClipIds: string[];
  duplicateHfIds: string[];
  operations: CompositionEditorPatchOperation[];
};

export function buildCompositionInsertGapPlan(params: {
  atSeconds: number;
  document: CompositionEditorDocument;
  durationSeconds: number;
  trackIds: Iterable<string>;
}): { operations: CompositionEditorPatchOperation[] } {
  const atSeconds = quantizeToFrame(params.atSeconds, params.document.canvas.fps);
  const durationSeconds = quantizeToFrame(params.durationSeconds, params.document.canvas.fps);
  if (durationSeconds < 1 / params.document.canvas.fps - TIMELINE_EPSILON_SECONDS) {
    throw new CompositionTimelineBatchError("El hueco debe durar al menos un frame.");
  }
  const trackIds = new Set(params.trackIds);
  if (trackIds.size === 0) throw new CompositionTimelineBatchError("Indica al menos una pista para insertar el hueco.");
  assertEditableTracks(params.document, trackIds);
  const targetStarts = new Map<string, number>();
  for (const clip of params.document.clips) {
    if (!trackIds.has(clip.trackId)) continue;
    const clipEnd = clip.startSeconds + clip.durationSeconds;
    if (clip.startSeconds < atSeconds - TIMELINE_EPSILON_SECONDS && clipEnd > atSeconds + TIMELINE_EPSILON_SECONDS) {
      throw new CompositionTimelineBatchError(
        `No se puede insertar en ${atSeconds.toFixed(3)} s porque ${clip.label} atraviesa ese punto.`,
      );
    }
    if (clip.startSeconds >= atSeconds - TIMELINE_EPSILON_SECONDS) {
      targetStarts.set(clip.id, quantizeToFrame(clip.startSeconds + durationSeconds, params.document.canvas.fps));
    }
  }
  synchronizeLinkedMoveTargets(params.document, targetStarts, new Set());
  assertEditableTracks(
    params.document,
    [...targetStarts.keys()].map((clipId) => requireClip(params.document, clipId).trackId),
  );
  for (const transition of params.document.transitions?.items || []) {
    const fromMoves = targetStarts.has(transition.fromClipId);
    const toMoves = targetStarts.has(transition.toClipId);
    if (fromMoves !== toMoves) {
      throw new CompositionTimelineBatchError(
        "La inserción atraviesa una transición. Mueve o elimina esa transición antes de abrir el hueco.",
      );
    }
  }
  const operations: CompositionEditorPatchOperation[] = [];
  appendMoveOperations(params.document, targetStarts, new Set(), operations);
  assertOperationBudget(operations);
  return { operations };
}

export function buildCompositionDuplicateSelectionPlan(params: {
  clipIds: Iterable<string>;
  createId?: IdFactory;
  destinationStartSeconds?: number;
  document: CompositionEditorDocument;
}): CompositionDuplicateSelectionPlan {
  const selectedIds = normalizeSelection(params.clipIds);
  const selectedIdSet = new Set(selectedIds);
  const selectedClips = selectedIds.map((clipId) => requireClip(params.document, clipId));
  if (params.document.clips.length + selectedClips.length > 500) {
    throw new CompositionTimelineBatchError("La duplicación excede el máximo de 500 clips por composición.");
  }
  assertEditableTracks(params.document, selectedClips.map((clip) => clip.trackId));
  assertCompleteLinkedSelection(params.document, selectedIdSet);
  assertCompleteGroupSelection(params.document, selectedIdSet);

  const selectionStart = Math.min(...selectedClips.map((clip) => clip.startSeconds));
  const selectionEnd = Math.max(...selectedClips.map((clip) => clip.startSeconds + clip.durationSeconds));
  const offsetSeconds = Math.max(1 / params.document.canvas.fps, selectionEnd - selectionStart);
  if (params.destinationStartSeconds !== undefined && !Number.isFinite(params.destinationStartSeconds)) {
    throw new CompositionTimelineBatchError("La posición de pegado debe ser un tiempo válido.");
  }
  const destinationStart = params.destinationStartSeconds === undefined
    ? quantizeToFrame(selectionStart + offsetSeconds, params.document.canvas.fps)
    : quantizeToFrame(params.destinationStartSeconds, params.document.canvas.fps);
  if (destinationStart + offsetSeconds > COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS + TIMELINE_EPSILON_SECONDS) {
    throw new CompositionTimelineBatchError("La copia excedería la duración máxima admitida por el editor.");
  }

  const createId = params.createId || defaultIdFactory;
  const occupiedIds = new Set(params.document.clips.flatMap((clip) => [clip.id, clip.hfId, ...(clip.sceneId ? [clip.sceneId] : [])]));
  const occupiedAnimationIds = new Set(params.document.motion.animations.map((animation) => animation.id));
  const occupiedGroupIds = new Set((params.document.groups || []).map((group) => group.id));
  const sceneIds = new Map<string, string>();
  const duplicateBySourceId = new Map<string, { clipId: string; hfId: string }>();
  const operations: CompositionEditorPatchOperation[] = [];
  const selectedTrackIds = new Set(selectedClips.map((clip) => clip.trackId));
  if (params.destinationStartSeconds !== undefined) {
    operations.push(...buildCompositionInsertGapPlan({
      atSeconds: destinationStart,
      document: params.document,
      durationSeconds: offsetSeconds,
      trackIds: selectedTrackIds,
    }).operations);
  } else {
    const insertMoveTargets = new Map<string, number>();
    for (const clip of params.document.clips) {
      if (selectedIdSet.has(clip.id) || !selectedTrackIds.has(clip.trackId)) continue;
      if (rangesOverlap(
        clip.startSeconds,
        clip.startSeconds + clip.durationSeconds,
        selectionStart,
        selectionEnd,
      )) {
        throw new CompositionTimelineBatchError(
          `No se puede insertar la copia porque ${clip.label} se solapa con el bloque seleccionado.`,
        );
      }
      if (clip.startSeconds >= selectionEnd - TIMELINE_EPSILON_SECONDS) {
        insertMoveTargets.set(
          clip.id,
          quantizeToFrame(clip.startSeconds + offsetSeconds, params.document.canvas.fps),
        );
      }
    }
    synchronizeLinkedMoveTargets(params.document, insertMoveTargets, selectedIdSet);
    appendMoveOperations(params.document, insertMoveTargets, selectedIdSet, operations);
  }

  for (const clip of selectedClips) {
    const newClipId = createUniqueId(createId("clip", clip.id), occupiedIds);
    const newHfId = createUniqueId(createId("clip", clip.hfId), occupiedIds);
    const animationIds = params.document.motion.animations
      .filter((animation) => animation.target.clipId === clip.id)
      .map((animation) => ({
        newAnimationId: createUniqueId(createId("animation", animation.id), occupiedAnimationIds),
        sourceAnimationId: animation.id,
      }));
    const newSceneId = clip.sceneId
      ? resolveDuplicateSceneId(clip.sceneId, sceneIds, occupiedIds, createId)
      : undefined;
    operations.push({
      animationIds,
      clipId: clip.id,
      newClipId,
      newHfId,
      ...(newSceneId ? { newSceneId } : {}),
      startSeconds: quantizeToFrame(
        destinationStart + clip.startSeconds - selectionStart,
        params.document.canvas.fps,
      ),
      type: "clip.duplicate",
    });
    duplicateBySourceId.set(clip.id, { clipId: newClipId, hfId: newHfId });
  }

  for (const group of params.document.groups || []) {
    if (!group.clipIds.every((clipId) => selectedIdSet.has(clipId))) continue;
    operations.push({
      clipIds: group.clipIds.map((clipId) => duplicateBySourceId.get(clipId)!.clipId),
      groupId: createUniqueId(createId("group", group.id), occupiedGroupIds),
      ...(group.label ? { label: `${group.label} copia`.slice(0, 120) } : {}),
      type: "group.create",
    });
  }
  assertOperationBudget(operations);

  return {
    duplicateClipIds: selectedClips.map((clip) => duplicateBySourceId.get(clip.id)!.clipId),
    duplicateHfIds: selectedClips.map((clip) => duplicateBySourceId.get(clip.id)!.hfId),
    operations,
  };
}

export function buildCompositionDeleteSelectionPlan(params: {
  clipIds: Iterable<string>;
  document: CompositionEditorDocument;
  ripple: boolean;
}): { operations: CompositionEditorPatchOperation[] } {
  const selectedIds = normalizeSelection(params.clipIds);
  const selectedIdSet = new Set(selectedIds);
  const selectedClips = selectedIds.map((clipId) => requireClip(params.document, clipId));
  assertEditableTracks(params.document, selectedClips.map((clip) => clip.trackId));
  assertCompleteLinkedSelection(params.document, selectedIdSet);

  const operations: CompositionEditorPatchOperation[] = selectedClips
    .slice()
    .sort((left, right) => right.startSeconds - left.startSeconds || left.id.localeCompare(right.id))
    .map((clip) => ({ clipId: clip.id, type: "clip.remove" }));
  if (!params.ripple) {
    assertOperationBudget(operations);
    return { operations };
  }

  const intervalsByTrack = buildRemovedIntervalsByTrack(selectedClips);
  const targetStarts = new Map<string, number>();
  for (const clip of params.document.clips) {
    if (selectedIdSet.has(clip.id)) continue;
    const intervals = intervalsByTrack.get(clip.trackId);
    if (!intervals) continue;
    if (intervals.some((interval) => rangesOverlap(
      clip.startSeconds,
      clip.startSeconds + clip.durationSeconds,
      interval.start,
      interval.end,
    ))) {
      throw new CompositionTimelineBatchError(
        `No se puede cerrar el hueco porque ${clip.label} se solapa con la selección en la misma pista.`,
      );
    }
    const shiftSeconds = intervals
      .filter((interval) => interval.end <= clip.startSeconds + TIMELINE_EPSILON_SECONDS)
      .reduce((total, interval) => total + interval.end - interval.start, 0);
    if (shiftSeconds > TIMELINE_EPSILON_SECONDS) {
      targetStarts.set(clip.id, quantizeToFrame(clip.startSeconds - shiftSeconds, params.document.canvas.fps));
    }
  }

  synchronizeLinkedMoveTargets(params.document, targetStarts, selectedIdSet);
  appendMoveOperations(params.document, targetStarts, selectedIdSet, operations);
  assertOperationBudget(operations);
  return { operations };
}

function normalizeSelection(clipIds: Iterable<string>) {
  const selectedIds = [...new Set(clipIds)];
  if (selectedIds.length === 0) throw new CompositionTimelineBatchError("Selecciona al menos un clip.");
  if (selectedIds.length > MAX_BATCH_OPERATIONS) {
    throw new CompositionTimelineBatchError(`Una acción masiva admite como máximo ${MAX_BATCH_OPERATIONS} clips.`);
  }
  return selectedIds;
}

function requireClip(document: CompositionEditorDocument, clipId: string) {
  const clip = document.clips.find((candidate) => candidate.id === clipId);
  if (!clip) throw new CompositionTimelineBatchError("La selección contiene un clip que ya no existe.");
  return clip;
}

function assertEditableTracks(document: CompositionEditorDocument, trackIds: Iterable<string>) {
  const tracksById = new Map(document.tracks.map((track) => [track.id, track]));
  for (const trackId of new Set(trackIds)) {
    const track = tracksById.get(trackId);
    if (!track) throw new CompositionTimelineBatchError("La selección contiene un clip sin pista válida.");
    if (track.locked) throw new CompositionTimelineBatchError(`Desbloquea la pista ${track.label} antes de editar la selección.`);
  }
}

function assertCompleteLinkedSelection(document: CompositionEditorDocument, selectedIds: ReadonlySet<string>) {
  for (const clipId of selectedIds) {
    const link = resolveAvatarAudioLink(document, clipId);
    if (link.status === "AMBIGUOUS") {
      throw new CompositionTimelineBatchError(`La escena ${link.sceneId} tiene un vínculo avatar-voz ambiguo.`);
    }
    if (link.status !== "LINKED") continue;
    const counterpartId = link.avatar.id === clipId ? link.voice.id : link.avatar.id;
    if (!selectedIds.has(counterpartId)) {
      throw new CompositionTimelineBatchError("Selecciona juntos el avatar y su voz vinculada antes de aplicar esta acción.");
    }
  }
}

function assertCompleteGroupSelection(document: CompositionEditorDocument, selectedIds: ReadonlySet<string>) {
  for (const group of document.groups || []) {
    const selectedMemberCount = group.clipIds.filter((clipId) => selectedIds.has(clipId)).length;
    if (selectedMemberCount > 0 && selectedMemberCount !== group.clipIds.length) {
      throw new CompositionTimelineBatchError("Selecciona el grupo completo antes de duplicarlo.");
    }
  }
}

function buildRemovedIntervalsByTrack(clips: CompositionEditorDocument["clips"]) {
  const intervalsByTrack = new Map<string, Array<{ end: number; start: number }>>();
  for (const clip of clips) {
    const intervals = intervalsByTrack.get(clip.trackId) || [];
    intervals.push({ end: clip.startSeconds + clip.durationSeconds, start: clip.startSeconds });
    intervalsByTrack.set(clip.trackId, intervals);
  }
  for (const [trackId, intervals] of intervalsByTrack) {
    const merged: Array<{ end: number; start: number }> = [];
    for (const interval of intervals.sort((left, right) => left.start - right.start || left.end - right.end)) {
      const previous = merged.at(-1);
      if (!previous || interval.start > previous.end + TIMELINE_EPSILON_SECONDS) merged.push({ ...interval });
      else previous.end = Math.max(previous.end, interval.end);
    }
    intervalsByTrack.set(trackId, merged);
  }
  return intervalsByTrack;
}

function synchronizeLinkedMoveTargets(
  document: CompositionEditorDocument,
  targetStarts: Map<string, number>,
  selectedIds: ReadonlySet<string>,
) {
  const processedScenes = new Set<string>();
  for (const clip of document.clips) {
    if (selectedIds.has(clip.id)) continue;
    const link = resolveAvatarAudioLink(document, clip.id);
    if (link.status === "AMBIGUOUS") {
      throw new CompositionTimelineBatchError(`La escena ${link.sceneId} tiene un vínculo avatar-voz ambiguo.`);
    }
    if (link.status !== "LINKED" || processedScenes.has(link.sceneId)) continue;
    processedScenes.add(link.sceneId);
    const avatarTarget = targetStarts.get(link.avatar.id);
    const voiceTarget = targetStarts.get(link.voice.id);
    if (avatarTarget === undefined && voiceTarget === undefined) continue;
    const avatarDelta = avatarTarget === undefined ? undefined : avatarTarget - link.avatar.startSeconds;
    const voiceDelta = voiceTarget === undefined ? undefined : voiceTarget - link.voice.startSeconds;
    if (avatarDelta !== undefined && voiceDelta !== undefined && Math.abs(avatarDelta - voiceDelta) > TIMELINE_EPSILON_SECONDS) {
      throw new CompositionTimelineBatchError("El ripple produciría desplazamientos distintos para un avatar y su voz vinculada.");
    }
    const delta = avatarDelta ?? voiceDelta!;
    assertEditableTracks(document, [link.avatar.trackId, link.voice.trackId]);
    targetStarts.set(link.avatar.id, quantizeToFrame(link.avatar.startSeconds + delta, document.canvas.fps));
    targetStarts.set(link.voice.id, quantizeToFrame(link.voice.startSeconds + delta, document.canvas.fps));
  }
}

function appendMoveOperations(
  document: CompositionEditorDocument,
  targetStarts: ReadonlyMap<string, number>,
  excludedIds: ReadonlySet<string>,
  operations: CompositionEditorPatchOperation[],
) {
  const emittedMoveIds = new Set<string>();
  for (const clip of document.clips) {
    if (excludedIds.has(clip.id)) continue;
    const startSeconds = targetStarts.get(clip.id);
    if (startSeconds === undefined || emittedMoveIds.has(clip.id)) continue;
    const link = resolveAvatarAudioLink(document, clip.id);
    if (link.status === "AMBIGUOUS") {
      throw new CompositionTimelineBatchError(`La escena ${link.sceneId} tiene un vínculo avatar-voz ambiguo.`);
    }
    if (link.status === "LINKED") {
      if (clip.id !== link.avatar.id) continue;
      emittedMoveIds.add(link.avatar.id);
      emittedMoveIds.add(link.voice.id);
      operations.push({ clipId: link.avatar.id, startSeconds, type: "clip.move" });
      continue;
    }
    emittedMoveIds.add(clip.id);
    operations.push({ clipId: clip.id, startSeconds, type: "clip.move" });
  }
}

function resolveDuplicateSceneId(
  sourceSceneId: string,
  sceneIds: Map<string, string>,
  occupiedIds: Set<string>,
  createId: IdFactory,
) {
  const existing = sceneIds.get(sourceSceneId);
  if (existing) return existing;
  const next = createUniqueId(createId("scene", sourceSceneId), occupiedIds);
  sceneIds.set(sourceSceneId, next);
  return next;
}

function createUniqueId(candidate: string, occupiedIds: Set<string>) {
  const normalized = candidate.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  const base = /^[a-z]/.test(normalized) ? normalized : `id-${normalized || "copy"}`;
  let unique = base;
  let suffix = 2;
  while (occupiedIds.has(unique)) unique = `${base.slice(0, 116)}-${suffix++}`;
  occupiedIds.add(unique);
  return unique;
}

function defaultIdFactory(kind: "animation" | "clip" | "group" | "scene", sourceId: string) {
  return `${kind}-${sourceId.slice(0, 64)}-${crypto.randomUUID().slice(0, 8)}`;
}

function rangesOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  return leftStart < rightEnd - TIMELINE_EPSILON_SECONDS && leftEnd > rightStart + TIMELINE_EPSILON_SECONDS;
}

function quantizeToFrame(value: number, fps: number) {
  return Math.round(Math.max(0, value) * fps) / fps;
}

function assertOperationBudget(operations: CompositionEditorPatchOperation[]) {
  if (operations.length > MAX_BATCH_OPERATIONS) {
    throw new CompositionTimelineBatchError(
      `La acción necesita ${operations.length} operaciones y supera el máximo atómico de ${MAX_BATCH_OPERATIONS}.`,
    );
  }
}
