import {
  compositionEditorDocumentSchema,
  type CompositionEditorDocument,
} from "./composition-document.types";
import type { CompositionEditorPatchOperation } from "./editor-patch.types";

export class CompositionEditorPatchError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** Applies a small, allow-listed edit while retaining the immutable source references. */
export function applyCompositionEditorPatches(
  document: CompositionEditorDocument,
  operations: CompositionEditorPatchOperation[],
) {
  const next = structuredClone(document);

  for (const operation of operations) {
    if (operation.type === "composition.canvas-duration") {
      if (operation.clipId !== "canvas") {
        throw new CompositionEditorPatchError("La operación de duración debe dirigirse al canvas.");
      }
      if (next.clips.some((clip) => clip.startSeconds + clip.durationSeconds > operation.durationSeconds)) {
        throw new CompositionEditorPatchError("Reduce primero los clips que terminan después de la nueva duración.");
      }
      next.canvas.durationSeconds = operation.durationSeconds;
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
    if (!currentTrack) throw new CompositionEditorPatchError("El clip no tiene un track vÃ¡lido.");

    if (operation.type === "clip.remove") {
      if (currentTrack.locked) throw new CompositionEditorPatchError("No puedes quitar un clip de un track bloqueado.");
      if (next.clips.length === 1) throw new CompositionEditorPatchError("La composición debe conservar al menos un clip.");
      next.clips = next.clips.filter((candidate) => candidate.id !== clip.id);
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
      if (currentTrack.locked) throw new CompositionEditorPatchError("No puedes cambiar la duraciÃ³n de un track bloqueado.");
      clip.durationSeconds = operation.durationSeconds;
      clip.timingSource = "USER_EDITED";
    }

    if (operation.type === "clip.layout") {
      if (currentTrack.locked) throw new CompositionEditorPatchError("No puedes editar el layout de un track bloqueado.");
      clip.layout = { ...clip.layout, ...operation.layout };
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
      clip.timingSource = "USER_EDITED";
    }

    if (clip.startSeconds + clip.durationSeconds > next.canvas.durationSeconds) {
      throw new CompositionEditorPatchError("El clip no puede terminar despuÃ©s del final del video.");
    }
  }

  return compositionEditorDocumentSchema.parse(next);
}
