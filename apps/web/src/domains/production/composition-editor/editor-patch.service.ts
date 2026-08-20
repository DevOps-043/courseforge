import {
  COMPOSITION_DOCUMENT_FORMAT,
  compositionEditorDocumentSchema,
  type CompositionEditorDocument,
} from "./composition-document.types";
import type { CompositionEditorPatchOperation } from "./editor-patch.types";
import {
  createCompositionPresetAnimation,
  getCompositionMotionPresetDefinition,
} from "./composition-motion-preset.service";
import { resolveDefaultCompositionClipLayout } from "./composition-default-layout.service";
import { deriveCompositionAnimationsForRetainedSegments } from "./composition-motion-derivation.service";

export class CompositionEditorPatchError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const CLIP_BOUNDARY_EPSILON_SECONDS = 0.001;

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
  document.clips = document.clips.filter((candidate) => candidate.id !== clipId);
  document.motion.animations = document.motion.animations.filter(
    (animation) => animation.target.clipId !== clipId,
  );
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

  for (const operation of operations) {
    if (operation.type === "clip.add") {
      timings.set(operation.clip.id, {
        durationSeconds: operation.clip.durationSeconds,
        startSeconds: operation.clip.startSeconds,
      });
    } else if (operation.type === "clip.remove") {
      timings.delete(operation.clipId);
    } else if (operation.type === "clip.move") {
      const timing = timings.get(operation.clipId);
      if (timing) timing.startSeconds = operation.startSeconds;
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

  for (const operation of operations) {
    if (operation.type === "document.restore") {
      if (source !== "USER") {
        throw new CompositionEditorPatchError("Solo una acción explícita del usuario puede restaurar una versión anterior.");
      }
      next = structuredClone(operation.document);
      next.format = COMPOSITION_DOCUMENT_FORMAT;
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
      if (next.clips.some((clip) => clip.startSeconds + clip.durationSeconds > operation.durationSeconds)) {
        throw new CompositionEditorPatchError("Reduce primero los clips que terminan después de la nueva duración.");
      }
      next.canvas.durationSeconds = operation.durationSeconds;
      next.canvas.durationMode = operation.durationMode || "USER_EDITED";
      if (operation.durationSource) next.canvas.durationSource = operation.durationSource;
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
      clip.layout = resolveDefaultCompositionClipLayout({ canvas: next.canvas, clipKind: clip.kind, track: currentTrack });
      delete clip.crop;
      next.clips = next.clips.filter((candidate) => candidate.id === clip.id || !siblingIds.has(candidate.id));
      next.motion.animations = next.motion.animations.filter((animation) => !siblingIds.has(animation.target.clipId));
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
      clip.startSeconds = operation.startSeconds;
      clip.trackId = destinationTrack.id;
      clip.timingSource = "USER_EDITED";
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
      clip.layout = { ...clip.layout, ...operation.layout };
    }

    if (operation.type === "clip.crop") {
      if (currentTrack.locked) throw new CompositionEditorPatchError("No puedes recortar visualmente un track bloqueado.");
      if (clip.kind !== "VIDEO" && clip.kind !== "IMAGE") {
        throw new CompositionEditorPatchError("El recorte visual solo está disponible para videos e imágenes.");
      }
      if (operation.crop) clip.crop = normalizeVisualCrop(operation.crop);
      else delete clip.crop;
    }

    if (operation.type === "clip.visibility") {
      if (currentTrack.locked) throw new CompositionEditorPatchError("No puedes ocultar o mostrar un clip de un track bloqueado.");
      clip.hidden = operation.hidden;
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

  const parsed = compositionEditorDocumentSchema.safeParse(next);
  if (!parsed.success) {
    throw new CompositionEditorPatchError(
      parsed.error.issues[0]?.message || "El documento resultante no es válido.",
    );
  }
  return parsed.data;
}

function minimumDerivedClipDuration(fps: number) {
  return Math.max(0.05, 1 / fps);
}

function normalizeVisualCrop(crop: { focusX: number; focusY: number; zoom: number }) {
  const minimumFocus = 0.5 / crop.zoom;
  const maximumFocus = 1 - minimumFocus;
  return {
    focusX: Math.max(minimumFocus, Math.min(maximumFocus, crop.focusX)),
    focusY: Math.max(minimumFocus, Math.min(maximumFocus, crop.focusY)),
    zoom: crop.zoom,
  };
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
