import type { CompositionEditorDocument } from "./composition-document.types";
import { applyCompositionEditorPatches, CompositionEditorPatchError } from "./editor-patch.service";
import {
  compositionEditorPatchOperationSchema,
  type CompositionEditorPatchOperation,
} from "./editor-patch.types";

export interface CompositionAgentSimulationResult {
  document: CompositionEditorDocument;
  inverseOperations: CompositionEditorPatchOperation[];
}

/**
 * Executes the proposed operations one at a time on immutable copies. Building
 * the inverse from each intermediate state makes multi-operation undo exact.
 */
export function simulateCompositionAgentOperations(
  document: CompositionEditorDocument,
  operations: CompositionEditorPatchOperation[],
): CompositionAgentSimulationResult {
  let current = structuredClone(document);
  const inverseOperations: CompositionEditorPatchOperation[] = [];

  for (const operation of operations) {
    const inverse = buildInverseOperation(current, operation);
    current = applyCompositionEditorPatches(current, [operation], "AGENT");
    inverseOperations.unshift(compositionEditorPatchOperationSchema.parse(inverse));
  }

  return { document: current, inverseOperations };
}

function buildInverseOperation(
  document: CompositionEditorDocument,
  operation: CompositionEditorPatchOperation,
): CompositionEditorPatchOperation {
  switch (operation.type) {
    case "clip.move": {
      const clip = findClip(document, operation.clipId);
      return {
        clipId: clip.id,
        startSeconds: clip.startSeconds,
        trackId: clip.trackId,
        type: "clip.move",
      };
    }
    case "clip.duration": {
      const clip = findClip(document, operation.clipId);
      return {
        clipId: clip.id,
        durationSeconds: clip.durationSeconds,
        type: "clip.duration",
      };
    }
    case "clip.layout": {
      const clip = findClip(document, operation.clipId);
      const layout = Object.fromEntries(
        Object.keys(operation.layout).map((field) => [
          field,
          clip.layout[field as keyof typeof clip.layout],
        ]),
      ) as typeof operation.layout;
      return { clipId: clip.id, layout, type: "clip.layout" };
    }
    case "clip.visibility": {
      const clip = findClip(document, operation.clipId);
      return { clipId: clip.id, hidden: clip.hidden, type: "clip.visibility" };
    }
    case "track.update": {
      const track = document.tracks.find((candidate) => candidate.id === operation.trackId);
      if (!track) throw new CompositionEditorPatchError("La capa que intentas editar ya no existe.");
      const settings = Object.fromEntries(
        Object.keys(operation.settings).map((field) => {
          const key = field as keyof typeof operation.settings;
          const currentValue = track[key as keyof typeof track];
          return [field, currentValue ?? (field === "volume" ? 1 : false)];
        }),
      ) as typeof operation.settings;
      return { settings, trackId: track.id, type: "track.update" };
    }
    case "audio-mix.update": {
      const settings = Object.fromEntries(
        Object.keys(operation.settings).map((field) => {
          const key = field as keyof typeof operation.settings;
          return [field, document.audioMix.ducking[key]];
        }),
      ) as typeof operation.settings;
      return { settings, type: "audio-mix.update" };
    }
    case "animation.add-preset":
      return { animationId: operation.animationId, type: "animation.remove" };
    case "animation.update-timing": {
      const animation = document.motion.animations.find(
        (candidate) => candidate.id === operation.animationId,
      );
      if (!animation) throw new CompositionEditorPatchError("La animación que intentas editar ya no existe.");
      const timing = Object.fromEntries(
        Object.keys(operation.timing).map((field) => {
          const key = field as keyof typeof operation.timing;
          return [field, animation.timing[key]];
        }),
      ) as typeof operation.timing;
      return { animationId: animation.id, timing, type: "animation.update-timing" };
    }
    default:
      throw new CompositionEditorPatchError(
        `La operación ${operation.type} no tiene una estrategia de reversión segura para el agente.`,
      );
  }
}

function findClip(document: CompositionEditorDocument, clipId: string) {
  const clip = document.clips.find((candidate) => candidate.id === clipId);
  if (!clip) throw new CompositionEditorPatchError("El clip que intentas editar ya no existe.");
  return clip;
}
