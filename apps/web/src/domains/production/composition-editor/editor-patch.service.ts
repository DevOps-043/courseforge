import {
  COMPOSITION_DOCUMENT_FORMAT,
  NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT,
  compositionEditorDocumentSchema,
  exceedsCompositionTimelineBoundary,
  type CompositionEditorDocument,
} from "./composition-document.types";
import type { CompositionEditorPatchOperation } from "./editor-patch.types";
import {
  createCompositionPresetAnimation,
  getCompositionMotionPresetDefinition,
} from "./composition-motion-preset.service";
import {
  resolveDefaultCompositionClipLayout,
  resolveDefaultCompositionMediaFit,
} from "./composition-default-layout.service";
import { deriveCompositionAnimationsForRetainedSegments } from "./composition-motion-derivation.service";
import {
  normalizeCompositionCropInsets,
  resolveCompositionCropInsets,
  scaleCompositionCropInsets,
} from "./composition-visual-crop.service";
import { compositionClipHasConfigurableAudio } from "./composition-clip-audio.service";
import { compositionClipExclusionKey } from "./composition-source-selection";
import { resolveAvatarAudioLink } from "./composition-avatar-audio-link.service";
import {
  appendDerivedClipToCompositionGroup,
  findCompositionGroupForClip,
  normalizeCompositionGroups,
  resolveCompositionGroupBounds,
} from "./composition-group.service";
import {
  assertCompositionTransitionsValid,
  removeTransitionsConnectedToClips,
  resolveCompositionTransitionEligibility,
  transferOutgoingTransitionsToDerivedClip,
} from "./composition-transition.service";
import {
  COMPOSITION_TRANSITION_SCHEMA_VERSION,
  compositionTransitionSchema,
  type CompositionTransition,
} from "./composition-transition.types";
import { normalizeCompositionColorGrading } from "./composition-color-grading.types";

export class CompositionEditorPatchError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const CLIP_BOUNDARY_EPSILON_SECONDS = 0.001;

function resolveLinkedAvatarAudioClipForMove(
  document: CompositionEditorDocument,
  clipId: string,
) {
  const resolution = resolveAvatarAudioLink(document, clipId);
  if (resolution.status === "AMBIGUOUS") {
    throw new CompositionEditorPatchError(
      `La escena ${resolution.sceneId} contiene varios clips de avatar o voz. Resuelve esa relación antes de moverla.`,
    );
  }
  if (resolution.status !== "LINKED") return null;
  if (resolution.avatar.id === clipId) return resolution.voice;
  if (resolution.voice.id === clipId) return resolution.avatar;
  return null;
}

function findCompositionGroupOrThrow(document: CompositionEditorDocument, groupId: string) {
  const group = document.groups?.find((candidate) => candidate.id === groupId);
  if (!group) throw new CompositionEditorPatchError("El grupo que intentas editar ya no existe.");
  return group;
}

function resolveGroupMoveClipIdsOrThrow(
  document: CompositionEditorDocument,
  groupId: string,
) {
  const group = findCompositionGroupOrThrow(document, groupId);
  const affectedClipIds = new Set(group.clipIds);
  for (const clipId of group.clipIds) {
    const resolution = resolveAvatarAudioLink(document, clipId);
    if (resolution.status === "AMBIGUOUS") {
      throw new CompositionEditorPatchError(
        `La escena ${resolution.sceneId} contiene varios clips de avatar o voz. Resuelve esa relación antes de mover el grupo.`,
      );
    }
    if (resolution.status !== "LINKED") continue;
    const counterpartId = resolution.avatar.id === clipId
      ? resolution.voice.id
      : resolution.avatar.id;
    const counterpartGroup = findCompositionGroupForClip(document, counterpartId);
    if (counterpartGroup && counterpartGroup.id !== group.id) {
      throw new CompositionEditorPatchError(
        "El vínculo avatar-voz atraviesa dos grupos distintos. Agrupa ambos clips juntos o retira uno de su grupo.",
      );
    }
    affectedClipIds.add(counterpartId);
  }
  return affectedClipIds;
}

function normalizeDocumentGroups(document: CompositionEditorDocument) {
  const normalized = normalizeCompositionGroups(document.groups, document.clips);
  if (normalized !== undefined) document.groups = normalized;
}

function assertTransitionEligibleOrThrow(
  document: CompositionEditorDocument,
  transition: CompositionTransition,
  excludeTransitionId?: string,
) {
  const eligibility = resolveCompositionTransitionEligibility({
    document,
    excludeTransitionId,
    transition,
  });
  if (!eligibility.available) {
    throw new CompositionEditorPatchError(
      eligibility.issues[0]?.message || "La transición no cumple las condiciones de uso.",
    );
  }
}

function parseTransitionOrThrow(input: unknown) {
  const parsed = compositionTransitionSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionEditorPatchError(
      parsed.error.issues[0]?.message || "La configuración de la transición no es válida.",
    );
  }
  return parsed.data;
}

function assertDocumentTransitionsOrThrow(document: CompositionEditorDocument) {
  try {
    assertCompositionTransitionsValid(document);
  } catch (error) {
    throw new CompositionEditorPatchError(
      error instanceof Error ? error.message : "El documento contiene una transición inválida.",
    );
  }
}

function assertDerivableMediaClip(clip: CompositionEditorDocument["clips"][number]) {
  if (clip.source.type !== "PRODUCTION_ASSET" || (clip.kind !== "VIDEO" && clip.kind !== "AUDIO")) {
    throw new CompositionEditorPatchError("Solo los clips de video o audio pueden dividirse o recortarse por intervalos.");
  }
}

function applyDerivedAnimationsOrThrow(
  document: CompositionEditorDocument,
  params: Parameters<typeof deriveCompositionAnimationsForRetainedSegments>[0],
  operationLabel: "corte" | "intervalo",
) {
  const derived = deriveCompositionAnimationsForRetainedSegments(params);
  if (derived.conflicts.length > 0) {
    const firstConflict = derived.conflicts[0]!;
    throw new CompositionEditorPatchError(
      operationLabel === "corte"
        ? `El corte atraviesa la animación ${firstConflict.id}. Mueve el cursor fuera de esa animación o ajusta su duración.`
        : `El intervalo contiene o atraviesa la animación ${firstConflict.id}. Ajusta las marcas o la duración de esa animación.`,
    );
  }
  document.motion.animations = derived.animations;
}

function assertNewDerivedClipIdentity(
  document: CompositionEditorDocument,
  clipId: string,
  hfId: string,
) {
  if (document.clips.some((clip) => clip.id === clipId || clip.hfId === hfId)) {
    throw new CompositionEditorPatchError("El identificador del clip derivado ya existe.");
  }
}

function removeClipOrThrow(document: CompositionEditorDocument, clipId: string) {
  if (document.clips.length === 1) {
    throw new CompositionEditorPatchError("La composición debe conservar al menos un clip.");
  }
  const removed = document.clips.find((candidate) => candidate.id === clipId)!;
  const exclusionKey = compositionClipExclusionKey(removed);
  document.clips = document.clips.filter((candidate) => candidate.id !== clipId);
  if (!document.clips.some((clip) => compositionClipExclusionKey(clip) === exclusionKey)) {
    document.excludedSources = [...new Set([...(document.excludedSources || []), exclusionKey])];
  }
  document.motion.animations = document.motion.animations.filter(
    (animation) => animation.target.clipId !== clipId,
  );
  removeTransitionsConnectedToClips(document.transitions, new Set([clipId]));
  normalizeDocumentGroups(document);
}

function assertClipCanCreateDerivedFragment(
  document: CompositionEditorDocument,
  clipId: string,
) {
  const resolution = resolveAvatarAudioLink(document, clipId);
  if (resolution.status !== "NONE") {
    throw new CompositionEditorPatchError(
      "Divide primero la relación avatar-voz mediante una operación sincronizada; un fragmento individual volvería ambiguo el vínculo.",
    );
  }
}

/**
 * Keeps timing edits atomic. A clip may extend the composition, but callers
 * should not have to issue a separate canvas edit first (which would leave a
 * partially-saved state if the second request failed).
 */
export function ensureCanvasDurationForClipPatches(
  document: CompositionEditorDocument,
  operations: CompositionEditorPatchOperation[],
): CompositionEditorPatchOperation[] {
  if (operations.some((operation) => operation.type === "composition.canvas-duration")) {
    return operations;
  }

  const timings = new Map(document.clips.map((clip) => [clip.id, {
    durationSeconds: clip.durationSeconds,
    startSeconds: clip.startSeconds,
  }]));
  let groups = structuredClone(document.groups || []);

  for (const operation of operations) {
    if (operation.type === "group.create") {
      groups.push({
        clipIds: [...operation.clipIds],
        id: operation.groupId,
        ...(operation.label ? { label: operation.label } : {}),
        order: groups.reduce((maximum, group) => Math.max(maximum, group.order), -1) + 1,
      });
    } else if (operation.type === "group.ungroup") {
      groups = groups.filter((group) => group.id !== operation.groupId);
    } else if (operation.type === "group.add-clips") {
      const group = groups.find((candidate) => candidate.id === operation.groupId);
      if (group) group.clipIds.push(...operation.clipIds);
    } else if (operation.type === "group.remove-clips") {
      const group = groups.find((candidate) => candidate.id === operation.groupId);
      if (group) {
        const removedIds = new Set(operation.clipIds);
        group.clipIds = group.clipIds.filter((clipId) => !removedIds.has(clipId));
        if (group.clipIds.length < 2) groups = groups.filter((candidate) => candidate.id !== group.id);
      }
    } else if (operation.type === "group.move") {
      const group = groups.find((candidate) => candidate.id === operation.groupId);
      const memberTimings = group?.clipIds.flatMap((clipId) => {
        const timing = timings.get(clipId);
        return timing ? [{ clipId, timing }] : [];
      }) || [];
      if (memberTimings.length === 0) continue;
      const previousStartSeconds = Math.min(...memberTimings.map(({ timing }) => timing.startSeconds));
      const deltaSeconds = operation.startSeconds - previousStartSeconds;
      const affectedClipIds = new Set(memberTimings.map(({ clipId }) => clipId));
      for (const { clipId } of memberTimings) {
        const resolution = resolveAvatarAudioLink(document, clipId);
        if (resolution.status === "AMBIGUOUS") {
          throw new CompositionEditorPatchError(
            `La escena ${resolution.sceneId} contiene varios clips de avatar o voz. Resuelve esa relación antes de mover el grupo.`,
          );
        }
        if (resolution.status === "LINKED") {
          affectedClipIds.add(resolution.avatar.id);
          affectedClipIds.add(resolution.voice.id);
        }
      }
      for (const clipId of affectedClipIds) {
        const timing = timings.get(clipId);
        if (timing) timing.startSeconds += deltaSeconds;
      }
    } else if (operation.type === "clip.add") {
      timings.set(operation.clip.id, {
        durationSeconds: operation.clip.durationSeconds,
        startSeconds: operation.clip.startSeconds,
      });
    } else if (operation.type === "clip.remove") {
      timings.delete(operation.clipId);
      groups = groups.flatMap((group) => {
        const clipIds = group.clipIds.filter((clipId) => clipId !== operation.clipId);
        return clipIds.length >= 2 ? [{ ...group, clipIds }] : [];
      });
    } else if (operation.type === "clip.move") {
      const timing = timings.get(operation.clipId);
      const previousStartSeconds = timing?.startSeconds;
      if (timing) timing.startSeconds = operation.startSeconds;
      const link = resolveAvatarAudioLink(document, operation.clipId);
      const linkedClip = link.status === "LINKED"
        ? link.avatar.id === operation.clipId ? link.voice : link.avatar
        : null;
      const linkedTiming = linkedClip ? timings.get(linkedClip.id) : null;
      if (linkedTiming && previousStartSeconds !== undefined) {
        linkedTiming.startSeconds += operation.startSeconds - previousStartSeconds;
      }
    } else if (operation.type === "clip.duration") {
      const timing = timings.get(operation.clipId);
      if (timing) timing.durationSeconds = operation.durationSeconds;
    } else if (operation.type === "clip.trim" || operation.type === "clip.template" || operation.type === "clip.estimated-timing") {
      const timing = timings.get(operation.clipId);
      if (timing) {
        timing.startSeconds = operation.startSeconds;
        timing.durationSeconds = operation.durationSeconds;
      }
    }
  }

  const requiredDuration = Math.max(
    document.canvas.durationSeconds,
    ...Array.from(timings.values(), (timing) => timing.startSeconds + timing.durationSeconds),
  );
  if (requiredDuration <= document.canvas.durationSeconds + 0.001) return operations;

  return [{
    clipId: "canvas",
    durationMode: "USER_EDITED",
    durationSeconds: Math.round(requiredDuration * 1_000) / 1_000,
    ...(document.canvas.durationSource ? { durationSource: document.canvas.durationSource } : {}),
    type: "composition.canvas-duration",
  }, ...operations];
}

/** Applies a small, allow-listed edit while retaining the immutable source references. */
export function applyCompositionEditorPatches(
  document: CompositionEditorDocument,
  operations: CompositionEditorPatchOperation[],
  source: "AGENT" | "SYSTEM" | "USER" = "USER",
) {
  let next = structuredClone(document);
  next.format = COMPOSITION_DOCUMENT_FORMAT;
  next.motion.schemaVersion = 2;

  for (const operation of operations) {
    if (operation.type === "document.reconcile") {
      if (source !== "SYSTEM") {
        throw new CompositionEditorPatchError("La reconciliación completa del documento es una operación exclusiva del sistema.");
      }
      next = structuredClone(operation.document);
      next.format = COMPOSITION_DOCUMENT_FORMAT;
      continue;
    }
    if (operation.type === "document.restore") {
      if (source !== "USER") {
        throw new CompositionEditorPatchError("Solo una acción explícita del usuario puede restaurar una versión anterior.");
      }
      next = structuredClone(operation.document);
      next.format = COMPOSITION_DOCUMENT_FORMAT;
      continue;
    }
    if (operation.type === "transition.add") {
      next.transitions ||= { items: [], schemaVersion: COMPOSITION_TRANSITION_SCHEMA_VERSION };
      if (next.transitions.items.some((transition) => transition.id === operation.transition.id)) {
        throw new CompositionEditorPatchError("El identificador de transición ya existe.");
      }
      if (next.transitions.items.length >= 499) {
        throw new CompositionEditorPatchError("La composición alcanzó el máximo de transiciones permitido.");
      }
      const transition = parseTransitionOrThrow({
        ...operation.transition,
        origin: source === "AGENT" ? "AGENT" : "USER",
      });
      assertTransitionEligibleOrThrow(next, transition);
      next.transitions.items.push(transition);
      continue;
    }
    if (operation.type === "transition.update") {
      const transitionIndex = next.transitions?.items.findIndex(
        (candidate) => candidate.id === operation.transitionId,
      ) ?? -1;
      if (transitionIndex < 0 || !next.transitions) {
        throw new CompositionEditorPatchError("La transición que intentas editar ya no existe.");
      }
      const current = next.transitions.items[transitionIndex]!;
      const candidateInput: Record<string, unknown> = {
        ...current,
        ...operation.settings,
        origin: source === "AGENT" ? "AGENT" : "USER",
      };
      if (operation.settings.parameters === null) delete candidateInput.parameters;
      const candidate = parseTransitionOrThrow(candidateInput);
      assertTransitionEligibleOrThrow(next, candidate, current.id);
      next.transitions.items[transitionIndex] = candidate;
      continue;
    }
    if (operation.type === "transition.remove") {
      const transitionIndex = next.transitions?.items.findIndex(
        (candidate) => candidate.id === operation.transitionId,
      ) ?? -1;
      if (transitionIndex < 0 || !next.transitions) {
        throw new CompositionEditorPatchError("La transición que intentas quitar ya no existe.");
      }
      next.transitions.items.splice(transitionIndex, 1);
      continue;
    }
    if (operation.type === "animation.add-preset") {
      const clip = next.clips.find((candidate) => candidate.id === operation.clipId);
      if (!clip) throw new CompositionEditorPatchError("El clip que intentas animar ya no existe.");
      if (clip.kind === "AUDIO") throw new CompositionEditorPatchError("Los clips de audio no admiten animaciones visuales.");
      const track = next.tracks.find((candidate) => candidate.id === clip.trackId);
      if (track?.locked) throw new CompositionEditorPatchError("No puedes animar un clip de un track bloqueado.");
      if (next.motion.animations.some((animation) => animation.id === operation.animationId)) {
        throw new CompositionEditorPatchError("El identificador de animación ya existe.");
      }
      next.motion.animations.push(createCompositionPresetAnimation({
        animationId: operation.animationId,
        clipDurationSeconds: clip.durationSeconds,
        clipId: clip.id,
        durationSeconds: Math.min(operation.durationSeconds, clip.durationSeconds),
        offsetSeconds: operation.offsetSeconds,
        origin: source === "AGENT" ? "AGENT" : "PRESET",
        presetId: operation.presetId,
      }));
      continue;
    }
    if (operation.type === "animation.configure-preset") {
      if (source !== "USER") {
        throw new CompositionEditorPatchError("Solo una acción explícita del usuario puede reconfigurar un preset.");
      }
      const animationIndex = next.motion.animations.findIndex((candidate) => candidate.id === operation.animationId);
      if (animationIndex < 0) throw new CompositionEditorPatchError("La animación que intentas editar ya no existe.");
      const animation = next.motion.animations[animationIndex]!;
      if (!animation.preset) throw new CompositionEditorPatchError("La animación no proviene de un preset configurable.");
      const clip = next.clips.find((candidate) => candidate.id === animation.target.clipId);
      if (!clip) throw new CompositionEditorPatchError("El clip de la animación ya no existe.");
      const track = next.tracks.find((candidate) => candidate.id === clip.trackId);
      if (track?.locked) throw new CompositionEditorPatchError("No puedes editar animaciones de un track bloqueado.");
      next.motion.animations[animationIndex] = createCompositionPresetAnimation({
        animationId: animation.id,
        clipDurationSeconds: clip.durationSeconds,
        clipId: clip.id,
        cycleDurationSeconds: operation.cycleDurationSeconds,
        cycles: operation.cycles,
        durationSeconds: operation.durationSeconds,
        intensity: operation.intensity,
        offsetSeconds: operation.offsetSeconds,
        origin: "USER",
        presetId: animation.preset.id,
      });
      continue;
    }
    if (operation.type === "animation.remove" || operation.type === "animation.update-keyframe" || operation.type === "animation.update-timing") {
      const animationIndex = next.motion.animations.findIndex((candidate) => candidate.id === operation.animationId);
      if (animationIndex < 0) throw new CompositionEditorPatchError("La animación que intentas editar ya no existe.");
      const animation = next.motion.animations[animationIndex]!;
      const clip = next.clips.find((candidate) => candidate.id === animation.target.clipId);
      const track = clip ? next.tracks.find((candidate) => candidate.id === clip.trackId) : null;
      if (track?.locked) throw new CompositionEditorPatchError("No puedes editar animaciones de un track bloqueado.");
      if (operation.type === "animation.remove") {
        next.motion.animations.splice(animationIndex, 1);
      } else if (operation.type === "animation.update-timing") {
        const timing = { ...animation.timing, ...operation.timing };
        if (animation.preset) {
          const definition = getCompositionMotionPresetDefinition(animation.preset.id);
          const expectedAnchor = definition.phase === "EXIT" ? "CLIP_END" : "CLIP_START";
          if (timing.anchor !== expectedAnchor) {
            throw new CompositionEditorPatchError("El anclaje del preset debe coincidir con su fase de animación.");
          }
          if (definition.maxDurationSeconds !== null && timing.durationSeconds > definition.maxDurationSeconds) {
            throw new CompositionEditorPatchError("Las animaciones de entrada y salida pueden durar como máximo 2 segundos.");
          }
        }
        animation.timing = timing;
        animation.origin = source === "AGENT" ? "AGENT" : "USER";
      } else {
        if (animation.loop) {
          throw new CompositionEditorPatchError("Los ciclos repetibles se editan mediante cadencia, no por poses individuales.");
        }
        const keyframe = animation.keyframes[operation.keyframeIndex];
        if (!keyframe) throw new CompositionEditorPatchError("El keyframe que intentas editar ya no existe.");
        if (operation.values) keyframe.values = operation.values;
        if (operation.ease === null) delete keyframe.ease;
        else if (operation.ease) keyframe.ease = operation.ease;
        animation.origin = "USER";
      }
      continue;
    }
    if (operation.type === "audio-mix.update") {
      Object.assign(next.audioMix.ducking, operation.settings);
      continue;
    }
    if (operation.type === "track.update") {
      const track = next.tracks.find((candidate) => candidate.id === operation.trackId);
      if (!track) throw new CompositionEditorPatchError("La capa que intentas editar ya no existe.");
      Object.assign(track, operation.settings);
      continue;
    }
    if (operation.type === "composition.canvas-duration") {
      if (operation.clipId !== "canvas") {
        throw new CompositionEditorPatchError("La operación de duración debe dirigirse al canvas.");
      }
      if (next.clips.some((clip) => exceedsCompositionTimelineBoundary(
        clip.startSeconds + clip.durationSeconds,
        operation.durationSeconds,
      ))) {
        throw new CompositionEditorPatchError("Reduce primero los clips que terminan después de la nueva duración.");
      }
      next.canvas.durationSeconds = operation.durationSeconds;
      next.canvas.durationMode = operation.durationMode || "USER_EDITED";
      if (operation.durationSource) next.canvas.durationSource = operation.durationSource;
      continue;
    }

    if (operation.type.startsWith("group.") && source !== "USER") {
      throw new CompositionEditorPatchError("La edición de grupos requiere una acción explícita del usuario.");
    }
    if (operation.type === "group.create") {
      next.groups ||= [];
      if (next.groups.some((group) => group.id === operation.groupId)) {
        throw new CompositionEditorPatchError("El identificador del grupo ya existe.");
      }
      const selectedClipIds = new Set(operation.clipIds);
      if (selectedClipIds.size < 2 || operation.clipIds.some((clipId) => !next.clips.some((clip) => clip.id === clipId))) {
        throw new CompositionEditorPatchError("Un grupo requiere al menos dos clips existentes.");
      }
      const alreadyGrouped = operation.clipIds.find((clipId) => findCompositionGroupForClip(next, clipId));
      if (alreadyGrouped) {
        throw new CompositionEditorPatchError("Cada clip solo puede pertenecer a un grupo.");
      }
      next.groups.push({
        clipIds: [...operation.clipIds],
        id: operation.groupId,
        ...(operation.label ? { label: operation.label } : {}),
        order: next.groups.reduce((maximum, group) => Math.max(maximum, group.order), -1) + 1,
      });
      continue;
    }
    if (operation.type === "group.ungroup") {
      findCompositionGroupOrThrow(next, operation.groupId);
      next.groups = next.groups!.filter((group) => group.id !== operation.groupId);
      continue;
    }
    if (operation.type === "group.add-clips") {
      const group = findCompositionGroupOrThrow(next, operation.groupId);
      if (group.clipIds.length + operation.clipIds.length > 500) {
        throw new CompositionEditorPatchError("Un grupo no puede contener más de 500 clips.");
      }
      for (const clipId of operation.clipIds) {
        if (!next.clips.some((clip) => clip.id === clipId)) {
          throw new CompositionEditorPatchError("No puedes añadir al grupo un clip inexistente.");
        }
        if (findCompositionGroupForClip(next, clipId)) {
          throw new CompositionEditorPatchError("Cada clip solo puede pertenecer a un grupo.");
        }
      }
      group.clipIds.push(...operation.clipIds);
      continue;
    }
    if (operation.type === "group.remove-clips") {
      const group = findCompositionGroupOrThrow(next, operation.groupId);
      if (operation.clipIds.some((clipId) => !group.clipIds.includes(clipId))) {
        throw new CompositionEditorPatchError("Solo puedes retirar clips que pertenecen al grupo.");
      }
      const removedClipIds = new Set(operation.clipIds);
      group.clipIds = group.clipIds.filter((clipId) => !removedClipIds.has(clipId));
      if (group.clipIds.length < 2) {
        next.groups = next.groups!.filter((candidate) => candidate.id !== group.id);
      }
      continue;
    }
    if (operation.type === "group.move") {
      const bounds = resolveCompositionGroupBounds(next, operation.groupId);
      if (!bounds) throw new CompositionEditorPatchError("El grupo no contiene clips válidos suficientes.");
      const affectedClipIds = resolveGroupMoveClipIdsOrThrow(next, operation.groupId);
      const deltaSeconds = operation.startSeconds - bounds.startSeconds;
      const affectedClips = next.clips.filter((clip) => affectedClipIds.has(clip.id));
      for (const affectedClip of affectedClips) {
        const track = next.tracks.find((candidate) => candidate.id === affectedClip.trackId);
        if (!track || track.locked) {
          throw new CompositionEditorPatchError("No puedes mover un grupo mientras una de sus pistas está bloqueada.");
        }
        const nextStartSeconds = affectedClip.startSeconds + deltaSeconds;
        if (nextStartSeconds < 0) {
          throw new CompositionEditorPatchError("El movimiento dejaría un clip del grupo antes del inicio del video.");
        }
        if (exceedsCompositionTimelineBoundary(
          nextStartSeconds + affectedClip.durationSeconds,
          next.canvas.durationSeconds,
        )) {
          throw new CompositionEditorPatchError("El grupo no puede terminar después del final del video.");
        }
      }
      for (const affectedClip of affectedClips) {
        affectedClip.startSeconds += deltaSeconds;
        affectedClip.timingSource = "USER_EDITED";
      }
      continue;
    }

    if (operation.type === "clip.add") {
      if (operation.clip.id !== operation.clipId) {
        throw new CompositionEditorPatchError("El identificador del nuevo clip no coincide con la operación.");
      }
      if (next.clips.some((candidate) => candidate.id === operation.clip.id || candidate.hfId === operation.clip.hfId)) {
        throw new CompositionEditorPatchError("Este asset ya está presente en la línea de tiempo.");
      }

      const destinationTrack = next.tracks.find((candidate) => candidate.id === operation.clip.trackId);
      if (!destinationTrack) {
        if (!operation.track || operation.track.id !== operation.clip.trackId) {
          throw new CompositionEditorPatchError("El nuevo clip requiere un track válido.");
        }
        next.tracks.push(operation.track);
      } else if (destinationTrack.locked) {
        throw new CompositionEditorPatchError("No puedes agregar un clip a un track bloqueado.");
      }

      if (operation.clip.startSeconds + operation.clip.durationSeconds > next.canvas.durationSeconds) {
        throw new CompositionEditorPatchError("El clip no puede terminar después del final del video.");
      }
      next.clips.push(operation.clip);
      if (next.excludedSources) {
        const key = compositionClipExclusionKey(operation.clip);
        next.excludedSources = next.excludedSources.filter((excluded) => excluded !== key
          && !(operation.clip.source.type === "DECK_SLIDE" && excluded === `deck:${operation.clip.source.slideIndex}`));
      }
      continue;
    }

    const clip = next.clips.find((candidate) => candidate.id === operation.clipId);
    if (!clip) throw new CompositionEditorPatchError("El clip que intentas editar ya no existe.");

    const currentTrack = next.tracks.find((track) => track.id === clip.trackId);
    if (!currentTrack) throw new CompositionEditorPatchError("El clip no tiene un track válido.");

    if (operation.type === "clip.reset-asset") {
      if (source !== "USER") {
        throw new CompositionEditorPatchError("Solo una acción explícita del usuario puede reiniciar un asset.");
      }
      if (currentTrack.locked) throw new CompositionEditorPatchError("No puedes reiniciar un asset de un track bloqueado.");
      if (clip.source.type !== "PRODUCTION_ASSET") {
        throw new CompositionEditorPatchError("Solo los assets multimedia pueden reiniciarse.");
      }
      const productionAssetId = clip.source.productionAssetId;
      const siblingClips = next.clips.filter((candidate) => (
        candidate.source.type === "PRODUCTION_ASSET"
        && candidate.source.productionAssetId === productionAssetId
      ));
      const siblingIds = new Set(siblingClips.map((candidate) => candidate.id));
      const untrimmedSiblings = siblingClips.filter((candidate) => (candidate.sourceOffsetSeconds || 0) <= CLIP_BOUNDARY_EPSILON_SECONDS);
      const originalStartSeconds = untrimmedSiblings.length > 0
        ? Math.min(...untrimmedSiblings.map((candidate) => candidate.startSeconds))
        : Math.max(0, Math.min(...siblingClips.map((candidate) => candidate.startSeconds - (candidate.sourceOffsetSeconds || 0))));
      const knownSourceDuration = Math.max(
        ...siblingClips.map((candidate) => candidate.sourceDurationSeconds || 0),
      );
      const observedSourceDuration = Math.max(
        ...siblingClips.map((candidate) => (candidate.sourceOffsetSeconds || 0) + candidate.durationSeconds),
      );
      const restoredDurationSeconds = quantizeToDocumentFrame(
        knownSourceDuration > 0 ? knownSourceDuration : observedSourceDuration,
        next.canvas.fps,
      );
      clip.startSeconds = quantizeToDocumentFrame(originalStartSeconds, next.canvas.fps);
      clip.durationSeconds = restoredDurationSeconds;
      clip.sourceOffsetSeconds = 0;
      clip.timingSource = "ESTIMATED";
      clip.hidden = false;
      clip.layout = resolveDefaultCompositionClipLayout({
        canvas: next.canvas,
        clipKind: clip.kind,
        sourceDimensions: clip.source.type === "PRODUCTION_ASSET" && clip.source.sourceWidth && clip.source.sourceHeight
          ? { height: clip.source.sourceHeight, width: clip.source.sourceWidth }
          : null,
        track: currentTrack,
      });
      clip.mediaFit = resolveDefaultCompositionMediaFit({ clipKind: clip.kind, track: currentTrack });
      delete clip.crop;
      delete clip.colorGrading;
      delete clip.volume;
      delete clip.fadeInSeconds;
      delete clip.fadeOutSeconds;
      next.clips = next.clips.filter((candidate) => candidate.id === clip.id || !siblingIds.has(candidate.id));
      next.motion.animations = next.motion.animations.filter((animation) => !siblingIds.has(animation.target.clipId));
      removeTransitionsConnectedToClips(next.transitions, siblingIds);
      normalizeDocumentGroups(next);
      const requiredCanvasDuration = clip.startSeconds + clip.durationSeconds;
      if (requiredCanvasDuration > next.canvas.durationSeconds) {
        next.canvas.durationSeconds = quantizeToDocumentFrame(requiredCanvasDuration, next.canvas.fps);
        next.canvas.durationMode = "USER_EDITED";
      }
      continue;
    }

    if (operation.type === "clip.split") {
      if (currentTrack.locked) throw new CompositionEditorPatchError("No puedes dividir un clip de un track bloqueado.");
      assertDerivableMediaClip(clip);
      assertClipCanCreateDerivedFragment(next, clip.id);
      assertNewDerivedClipIdentity(next, operation.newClipId, operation.newHfId);
      const splitAtSeconds = quantizeToDocumentFrame(operation.atSeconds, next.canvas.fps);
      const splitOffset = splitAtSeconds - clip.startSeconds;
      const minimumClipDuration = minimumDerivedClipDuration(next.canvas.fps);
      if (
        splitOffset < minimumClipDuration - CLIP_BOUNDARY_EPSILON_SECONDS ||
        splitOffset > clip.durationSeconds - minimumClipDuration + CLIP_BOUNDARY_EPSILON_SECONDS
      ) {
        throw new CompositionEditorPatchError("El corte debe dejar al menos un frame válido a ambos lados del clip.");
      }
      const rightClip = structuredClone(clip);
      rightClip.id = operation.newClipId;
      rightClip.hfId = operation.newHfId;
      rightClip.durationSeconds = quantizeToDocumentFrame(clip.durationSeconds - splitOffset, next.canvas.fps);
      rightClip.sourceOffsetSeconds = normalizeVideoSourceOffset(
        clip,
        quantizeToDocumentFrame((clip.sourceOffsetSeconds || 0) + splitOffset, next.canvas.fps),
      );
      rightClip.startSeconds = splitAtSeconds;
      rightClip.timingSource = "USER_EDITED";
      const leftClipDuration = quantizeToDocumentFrame(splitOffset, next.canvas.fps);
      applyDerivedAnimationsOrThrow(next, {
        animations: next.motion.animations,
        clipDurationSeconds: clip.durationSeconds,
        clipId: clip.id,
        segments: [
          {
            sourceEndSeconds: leftClipDuration,
            sourceStartSeconds: 0,
            targetClipDurationSeconds: leftClipDuration,
            targetClipId: clip.id,
          },
          {
            sourceEndSeconds: clip.durationSeconds,
            sourceStartSeconds: splitOffset,
            targetClipDurationSeconds: rightClip.durationSeconds,
            targetClipId: rightClip.id,
          },
        ],
      }, "corte");
      clip.durationSeconds = leftClipDuration;
      clip.timingSource = "USER_EDITED";
      next.clips.push(rightClip);
      transferOutgoingTransitionsToDerivedClip(next.transitions, clip.id, rightClip.id);
      appendDerivedClipToCompositionGroup(next.groups, clip.id, rightClip.id);
      continue;
    }

    if (operation.type === "clip.remove-range") {
      if (currentTrack.locked) throw new CompositionEditorPatchError("No puedes eliminar un intervalo de un track bloqueado.");
      assertDerivableMediaClip(clip);
      const clipEnd = clip.startSeconds + clip.durationSeconds;
      const rangeStartSeconds = Math.max(clip.startSeconds, quantizeToDocumentFrame(operation.startSeconds, next.canvas.fps));
      const rangeEndSeconds = Math.min(clipEnd, quantizeToDocumentFrame(operation.endSeconds, next.canvas.fps));
      if (
        operation.startSeconds < clip.startSeconds - CLIP_BOUNDARY_EPSILON_SECONDS ||
        operation.endSeconds > clipEnd + CLIP_BOUNDARY_EPSILON_SECONDS ||
        rangeEndSeconds <= rangeStartSeconds
      ) {
        throw new CompositionEditorPatchError("El intervalo debe quedar dentro del clip seleccionado.");
      }
      const leftDuration = rangeStartSeconds - clip.startSeconds;
      const rightDuration = clipEnd - rangeEndSeconds;
      const minimumClipDuration = minimumDerivedClipDuration(next.canvas.fps);
      if (rangeEndSeconds - rangeStartSeconds < minimumClipDuration - CLIP_BOUNDARY_EPSILON_SECONDS) {
        throw new CompositionEditorPatchError("El intervalo debe durar al menos un frame.");
      }
      const removesFromStart = leftDuration < minimumClipDuration;
      const removesThroughEnd = rightDuration < minimumClipDuration;

      if (removesFromStart && removesThroughEnd) {
        removeClipOrThrow(next, clip.id);
        continue;
      }

      if (removesFromStart) {
        const retainedDuration = quantizeToDocumentFrame(rightDuration, next.canvas.fps);
        applyDerivedAnimationsOrThrow(next, {
          animations: next.motion.animations,
          clipDurationSeconds: clip.durationSeconds,
          clipId: clip.id,
          segments: [{
            sourceEndSeconds: clip.durationSeconds,
            sourceStartSeconds: rangeEndSeconds - clip.startSeconds,
            targetClipDurationSeconds: retainedDuration,
            targetClipId: clip.id,
          }],
        }, "intervalo");
        clip.durationSeconds = retainedDuration;
        clip.sourceOffsetSeconds = normalizeVideoSourceOffset(
          clip,
          quantizeToDocumentFrame((clip.sourceOffsetSeconds || 0) + (rangeEndSeconds - clip.startSeconds), next.canvas.fps),
        );
        clip.startSeconds = quantizeToDocumentFrame(operation.ripple ? clip.startSeconds : rangeEndSeconds, next.canvas.fps);
        clip.timingSource = "USER_EDITED";
        continue;
      }

      if (removesThroughEnd) {
        const retainedDuration = quantizeToDocumentFrame(leftDuration, next.canvas.fps);
        applyDerivedAnimationsOrThrow(next, {
          animations: next.motion.animations,
          clipDurationSeconds: clip.durationSeconds,
          clipId: clip.id,
          segments: [{
            sourceEndSeconds: leftDuration,
            sourceStartSeconds: 0,
            targetClipDurationSeconds: retainedDuration,
            targetClipId: clip.id,
          }],
        }, "intervalo");
        clip.durationSeconds = retainedDuration;
        clip.timingSource = "USER_EDITED";
        continue;
      }

      if (!operation.newClipId || !operation.newHfId) {
        throw new CompositionEditorPatchError("Eliminar un segmento intermedio requiere un identificador para el clip restante.");
      }
      assertClipCanCreateDerivedFragment(next, clip.id);
      assertNewDerivedClipIdentity(next, operation.newClipId, operation.newHfId);
      const rightClip = structuredClone(clip);
      rightClip.id = operation.newClipId;
      rightClip.hfId = operation.newHfId;
      rightClip.durationSeconds = quantizeToDocumentFrame(rightDuration, next.canvas.fps);
      rightClip.sourceOffsetSeconds = normalizeVideoSourceOffset(
        clip,
        quantizeToDocumentFrame(
          (clip.sourceOffsetSeconds || 0) + (rangeEndSeconds - clip.startSeconds),
          next.canvas.fps,
        ),
      );
      rightClip.startSeconds = quantizeToDocumentFrame(
        operation.ripple ? rangeStartSeconds : rangeEndSeconds,
        next.canvas.fps,
      );
      rightClip.timingSource = "USER_EDITED";
      const leftClipDuration = quantizeToDocumentFrame(leftDuration, next.canvas.fps);
      applyDerivedAnimationsOrThrow(next, {
        animations: next.motion.animations,
        clipDurationSeconds: clip.durationSeconds,
        clipId: clip.id,
        segments: [
          {
            sourceEndSeconds: leftDuration,
            sourceStartSeconds: 0,
            targetClipDurationSeconds: leftClipDuration,
            targetClipId: clip.id,
          },
          {
            sourceEndSeconds: clip.durationSeconds,
            sourceStartSeconds: rangeEndSeconds - clip.startSeconds,
            targetClipDurationSeconds: rightClip.durationSeconds,
            targetClipId: rightClip.id,
          },
        ],
      }, "intervalo");
      clip.durationSeconds = leftClipDuration;
      clip.timingSource = "USER_EDITED";
      next.clips.push(rightClip);
      transferOutgoingTransitionsToDerivedClip(next.transitions, clip.id, rightClip.id);
      appendDerivedClipToCompositionGroup(next.groups, clip.id, rightClip.id);
      continue;
    }

    if (operation.type === "clip.remove") {
      if (currentTrack.locked) throw new CompositionEditorPatchError("No puedes quitar un clip de un track bloqueado.");
      removeClipOrThrow(next, clip.id);
      continue;
    }

    if (operation.type === "clip.move") {
      const destinationTrack = next.tracks.find((track) => track.id === (operation.trackId ?? clip.trackId));
      if (!destinationTrack) throw new CompositionEditorPatchError("El track de destino no existe.");
      if (currentTrack.locked || destinationTrack.locked) {
        throw new CompositionEditorPatchError("No puedes mover un clip desde o hacia un track bloqueado.");
      }
      const linkedClip = resolveLinkedAvatarAudioClipForMove(next, clip.id);
      const linkedTrack = linkedClip
        ? next.tracks.find((track) => track.id === linkedClip.trackId)
        : null;
      if (linkedClip && (!linkedTrack || linkedTrack.locked)) {
        throw new CompositionEditorPatchError("No puedes mover clips vinculados mientras una de sus pistas está bloqueada.");
      }
      const moveDeltaSeconds = operation.startSeconds - clip.startSeconds;
      const linkedStartSeconds = linkedClip
        ? linkedClip.startSeconds + moveDeltaSeconds
        : null;
      if (linkedStartSeconds !== null && linkedStartSeconds < 0) {
        throw new CompositionEditorPatchError("El movimiento dejaría un clip vinculado antes del inicio del video.");
      }
      clip.startSeconds = operation.startSeconds;
      clip.trackId = destinationTrack.id;
      clip.timingSource = "USER_EDITED";
      if (linkedClip) {
        // Keep each medium on its own semantic track. The link owns timing,
        // not track assignment, so narration remains independently mixable.
        linkedClip.startSeconds = linkedStartSeconds!;
        linkedClip.timingSource = "USER_EDITED";
      }
    }

    if (operation.type === "clip.duration") {
      if (currentTrack.locked) throw new CompositionEditorPatchError("No puedes cambiar la duración de un track bloqueado.");
      clip.durationSeconds = operation.durationSeconds;
      clip.timingSource = "USER_EDITED";
    }

    if (operation.type === "clip.estimated-timing") {
      if (currentTrack.locked) throw new CompositionEditorPatchError("No puedes recalcular un track bloqueado.");
      if (clip.timingSource === "USER_EDITED") {
        throw new CompositionEditorPatchError("El tiempo editado manualmente no puede reemplazarse con un cálculo automático.");
      }
      clip.durationSeconds = operation.durationSeconds;
      clip.startSeconds = operation.startSeconds;
      clip.timingSource = "ESTIMATED";
    }

    if (operation.type === "clip.trim") {
      if (currentTrack.locked) throw new CompositionEditorPatchError("No puedes recortar un track bloqueado.");
      clip.durationSeconds = operation.durationSeconds;
      clip.sourceOffsetSeconds = normalizeVideoSourceOffset(clip, operation.sourceOffsetSeconds);
      clip.startSeconds = operation.startSeconds;
      clip.timingSource = "USER_EDITED";
    }

    if (operation.type === "clip.layout") {
      if (currentTrack.locked) throw new CompositionEditorPatchError("No puedes editar el layout de un track bloqueado.");
      const previousLayout = clip.layout;
      const nextLayout = { ...previousLayout, ...operation.layout };
      if (clip.crop && (nextLayout.width !== previousLayout.width || nextLayout.height !== previousLayout.height)) {
        clip.crop = scaleCompositionCropInsets(clip.crop, previousLayout, nextLayout);
      }
      clip.layout = nextLayout;
    }

    if (operation.type === "clip.crop") {
      if (currentTrack.locked) throw new CompositionEditorPatchError("No puedes recortar visualmente un track bloqueado.");
      if (clip.kind !== "VIDEO" && clip.kind !== "IMAGE" && clip.kind !== "DECK_SLIDE") {
        throw new CompositionEditorPatchError("El recorte visual solo está disponible para videos, imágenes y diapositivas.");
      }
      if (operation.crop) {
        clip.crop = normalizeCompositionCropInsets(
          resolveCompositionCropInsets(operation.crop, clip.layout),
          clip.layout,
        );
      }
      else delete clip.crop;
    }

    if (operation.type === "clip.media-fit") {
      if (currentTrack.locked) throw new CompositionEditorPatchError("No puedes cambiar el ajuste visual de un track bloqueado.");
      if (clip.kind !== "VIDEO" && clip.kind !== "IMAGE") {
        throw new CompositionEditorPatchError("El ajuste visual solo está disponible para videos e imágenes.");
      }
      clip.mediaFit = operation.mediaFit;
    }

    if (operation.type === "clip.color-grading") {
      if (source !== "USER") {
        throw new CompositionEditorPatchError("Solo una acción explícita del usuario puede corregir el color de un clip.");
      }
      if (currentTrack.locked) {
        throw new CompositionEditorPatchError("No puedes corregir el color de un track bloqueado.");
      }
      if (clip.kind !== "VIDEO" && clip.kind !== "IMAGE") {
        throw new CompositionEditorPatchError("La corrección de color solo está disponible para videos e imágenes.");
      }
      const colorGrading = normalizeCompositionColorGrading(operation.colorGrading);
      if (colorGrading) clip.colorGrading = colorGrading;
      else delete clip.colorGrading;
    }

    if (operation.type === "clip.visibility") {
      if (currentTrack.locked) throw new CompositionEditorPatchError("No puedes ocultar o mostrar un clip de un track bloqueado.");
      clip.hidden = operation.hidden;
    }

    if (operation.type === "clip.volume") {
      if (currentTrack.locked) throw new CompositionEditorPatchError("No puedes cambiar el volumen de un track bloqueado.");
      if (!compositionClipHasConfigurableAudio(clip, currentTrack)) {
        throw new CompositionEditorPatchError("El volumen individual solo está disponible para clips con una fuente de audio confirmada.");
      }
      clip.volume = operation.volume;
    }

    if (operation.type === "clip.audio-fades") {
      if (currentTrack.locked) throw new CompositionEditorPatchError("No puedes cambiar los fades de un track bloqueado.");
      if (!compositionClipHasConfigurableAudio(clip, currentTrack)) {
        throw new CompositionEditorPatchError("Los fades solo están disponibles para clips con una fuente de audio confirmada.");
      }
      if (operation.fadeInSeconds + operation.fadeOutSeconds > clip.durationSeconds + CLIP_BOUNDARY_EPSILON_SECONDS) {
        throw new CompositionEditorPatchError("La suma de los fades no puede exceder la duración del clip.");
      }
      clip.fadeInSeconds = operation.fadeInSeconds;
      clip.fadeOutSeconds = operation.fadeOutSeconds;
    }

    if (operation.type === "clip.text-content") {
      if (currentTrack.locked) throw new CompositionEditorPatchError("No puedes editar texto en un track bloqueado.");
      if (clip.source.type !== "NATIVE_TEXT") {
        throw new CompositionEditorPatchError("Esta operación solo está disponible para capas de texto nativo.");
      }
      clip.source.text = operation.text;
    }

    if (operation.type === "clip.caption-cues") {
      if (currentTrack.locked) throw new CompositionEditorPatchError("No puedes editar captions en un track bloqueado.");
      if (clip.source.type !== "NATIVE_CAPTIONS") {
        throw new CompositionEditorPatchError("Esta operación solo está disponible para capas de captions.");
      }
      clip.source.cues = operation.cues;
      if (operation.origin) clip.source.origin = operation.origin;
    }

    if (operation.type === "clip.text-style") {
      if (currentTrack.locked) throw new CompositionEditorPatchError("No puedes editar el estilo en un track bloqueado.");
      if (clip.source.type !== "NATIVE_TEXT" && clip.source.type !== "NATIVE_CAPTIONS") {
        throw new CompositionEditorPatchError("El estilo tipográfico solo está disponible para texto y captions.");
      }
      const { fontAssetId, ...style } = operation.style;
      clip.source.style = { ...clip.source.style, ...style };
      if (fontAssetId === null) delete clip.source.style.fontAssetId;
      else if (fontAssetId !== undefined) clip.source.style.fontAssetId = fontAssetId;
    }

    if (operation.type === "clip.template") {
      if (currentTrack.locked) throw new CompositionEditorPatchError("No puedes aplicar una plantilla a un track bloqueado.");
      clip.durationSeconds = operation.durationSeconds;
      clip.layout = operation.layout;
      clip.startSeconds = operation.startSeconds;
      clip.timingSource = operation.timingSource || "USER_EDITED";
    }

    if (clip.startSeconds + clip.durationSeconds > next.canvas.durationSeconds) {
      throw new CompositionEditorPatchError("El clip no puede terminar después del final del video.");
    }
  }

  // Every newly appended document uses the current motion contract, including restores.
  next.format = next.clips.some((clip) => clip.kind === "TEXT" || clip.kind === "CAPTION")
    ? NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT
    : COMPOSITION_DOCUMENT_FORMAT;
  next.motion.schemaVersion = 2;
  if (next.transitions) next.transitions.schemaVersion = COMPOSITION_TRANSITION_SCHEMA_VERSION;
  const parsed = compositionEditorDocumentSchema.safeParse(next);
  if (!parsed.success) {
    throw new CompositionEditorPatchError(
      parsed.error.issues[0]?.message || "El documento resultante no es válido.",
    );
  }
  assertDocumentTransitionsOrThrow(parsed.data);
  return parsed.data;
}

function minimumDerivedClipDuration(fps: number) {
  return Math.max(0.05, 1 / fps);
}

function quantizeToDocumentFrame(value: number, fps: number) {
  return Math.round(value * fps) / fps;
}

function normalizeVideoSourceOffset(
  clip: CompositionEditorDocument["clips"][number],
  sourceOffsetSeconds: number,
) {
  if (clip.kind !== "VIDEO" || !clip.sourceDurationSeconds) return sourceOffsetSeconds;
  return sourceOffsetSeconds % clip.sourceDurationSeconds;
}
