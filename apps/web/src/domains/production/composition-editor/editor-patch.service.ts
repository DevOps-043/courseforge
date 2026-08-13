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
    const clip = next.clips.find((candidate) => candidate.id === operation.clipId);
    if (!clip) throw new CompositionEditorPatchError("El clip que intentas editar ya no existe.");

    const currentTrack = next.tracks.find((track) => track.id === clip.trackId);
    if (!currentTrack) throw new CompositionEditorPatchError("El clip no tiene un track vÃ¡lido.");

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

    if (clip.startSeconds + clip.durationSeconds > next.canvas.durationSeconds) {
      throw new CompositionEditorPatchError("El clip no puede terminar despuÃ©s del final del video.");
    }
  }

  return compositionEditorDocumentSchema.parse(next);
}
