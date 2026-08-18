import type { CompositionEditorPatchOperation } from "./editor-patch.types";

export const COMPOSITION_AGENT_MAX_OPERATIONS = 12;

/**
 * Manual editor operations intentionally have a wider surface than the agent.
 * This executable allow-list is the security boundary; prompt instructions are
 * guidance only and must never be treated as authorization.
 */
export const COMPOSITION_AGENT_ALLOWED_OPERATION_TYPES = [
  "animation.add-preset",
  "animation.update-timing",
  "audio-mix.update",
  "clip.duration",
  "clip.layout",
  "clip.move",
  "clip.visibility",
  "track.update",
] as const satisfies ReadonlyArray<CompositionEditorPatchOperation["type"]>;

const allowedOperationTypes = new Set<string>(COMPOSITION_AGENT_ALLOWED_OPERATION_TYPES);

export class CompositionAgentPolicyError extends Error {
  constructor(
    message: string,
    readonly code: "AGENT_OPERATION_FORBIDDEN" | "AGENT_OPERATION_LIMIT_EXCEEDED",
  ) {
    super(message);
  }
}

export function assertCompositionAgentOperationsAllowed(
  operations: CompositionEditorPatchOperation[],
) {
  if (operations.length > COMPOSITION_AGENT_MAX_OPERATIONS) {
    throw new CompositionAgentPolicyError(
      `El agente no puede proponer más de ${COMPOSITION_AGENT_MAX_OPERATIONS} operaciones a la vez.`,
      "AGENT_OPERATION_LIMIT_EXCEEDED",
    );
  }

  const forbiddenOperation = operations.find(
    (operation) => !allowedOperationTypes.has(operation.type),
  );
  if (forbiddenOperation) {
    throw new CompositionAgentPolicyError(
      `La operación ${forbiddenOperation.type} requiere una acción manual explícita.`,
      "AGENT_OPERATION_FORBIDDEN",
    );
  }
}
