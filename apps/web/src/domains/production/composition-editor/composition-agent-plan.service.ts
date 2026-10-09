import { z } from "zod";
import { assertCompositionAgentJsonInputBudget, CompositionAgentInputBudgetError } from "./composition-agent-input-budget.service";
import type { CompositionEditorDocument } from "./composition-document.types";
import { hashCompositionDocument } from "./composition-document-hash";
import { applyCompositionEditorPatches } from "./editor-patch.service";
import { compositionEditorPatchOperationSchema } from "./editor-patch.types";
import { assertCompositionAgentOperationsAllowed, COMPOSITION_AGENT_MAX_OPERATIONS } from "./composition-agent-policy.service";
import { buildCompositionAgentProposal } from "./composition-agent-proposal.service";
import { simulateCompositionAgentOperations } from "./composition-agent-simulation.service";
import {
  assertCompositionAgentScope,
  prepareCompositionAgentAuthorizedDocument,
  type CompositionAgentAuthorization,
  type CompositionAgentScope,
} from "./composition-agent-read-session.service";
import { CompositionAgentReadError, freezeCompositionAgentReadValue } from "./composition-agent-read-tools.service";

export const COMPOSITION_AGENT_PLAN_LIMITS = Object.freeze({ maxSteps: 6, maxInputBytes: 16 * 1024 });
const stepIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/i);

export const compositionAgentPlanInputSchema = z.object({
  baseDocumentHash: z.string().regex(/^[a-f0-9]{64}$/),
  baseRevision: z.number().int().positive().safe(),
  summary: z.string().trim().min(3).max(300),
  steps: z.array(z.object({
    id: stepIdSchema,
    dependsOn: z.array(stepIdSchema).max(COMPOSITION_AGENT_PLAN_LIMITS.maxSteps).default([]),
    summary: z.string().trim().min(3).max(300),
    operations: z.array(compositionEditorPatchOperationSchema).min(1).max(COMPOSITION_AGENT_MAX_OPERATIONS),
  }).strict()).min(1).max(COMPOSITION_AGENT_PLAN_LIMITS.maxSteps),
}).strict();

export class CompositionAgentPlanError extends Error {
  constructor(readonly code: "AGENT_PLAN_DEPENDENCY_INVALID" | "AGENT_PLAN_INVERSE_MISMATCH" | "AGENT_PLAN_LIMIT_EXCEEDED", message: string) {
    super(message);
  }
}

/**
 * Sequential planning over detached, authorized state. No provider, store, gateway,
 * preview, jobs or callbacks that can apply changes are dependencies of this module.
 * Candidate document is host-only; expose only proposal/reports to model or UI.
 */
export function simulateCompositionAgentPlan(params: {
  document: CompositionEditorDocument;
  scope: CompositionAgentScope;
  authorization: CompositionAgentAuthorization;
  input: unknown;
  proposalId: string;
  now?: () => number;
}) {
  const now = params.now ?? Date.now;
  const { document, scope, authorization } = prepareCompositionAgentAuthorizedDocument({ ...params, now: now() });
  if (!authorization.canSimulate) forbidden();
  z.string().uuid().parse(params.proposalId);
  try {
    assertCompositionAgentJsonInputBudget(params.input, COMPOSITION_AGENT_PLAN_LIMITS.maxInputBytes);
  } catch (error) {
    if (error instanceof CompositionAgentInputBudgetError && error.code === "AGENT_INPUT_LIMIT_EXCEEDED") {
      throw new CompositionAgentPlanError("AGENT_PLAN_LIMIT_EXCEEDED", "El plan excede el presupuesto de entrada.");
    }
    throw error;
  }
  const plan = compositionAgentPlanInputSchema.parse(params.input);
  if (plan.baseDocumentHash !== scope.documentHash || plan.baseRevision !== scope.revision) {
    throw new CompositionAgentReadError("AGENT_READ_STALE", "El plan corresponde a una revisión obsoleta.");
  }
  const seen = new Set<string>();
  for (const step of plan.steps) {
    if (seen.has(step.id) || new Set(step.dependsOn).size !== step.dependsOn.length || step.dependsOn.some((id) => !seen.has(id))) {
      throw new CompositionAgentPlanError("AGENT_PLAN_DEPENDENCY_INVALID", "Los pasos deben tener IDs únicos y depender solo de pasos anteriores.");
    }
    seen.add(step.id);
  }
  const operations = plan.steps.flatMap((step) => step.operations);
  // Validate the complete batch before evaluating even its first step.
  assertCompositionAgentOperationsAllowed(operations);
  if (operations.some((operation) => !authorization.operationTypes.some((type) => type === operation.type))) forbidden();

  let current = document;
  const steps = plan.steps.map((step) => {
    assertCompositionAgentScope(scope, authorization, now());
    const baseDocumentHash = hashCompositionDocument(current);
    const proposal = buildCompositionAgentProposal({
      baseDocumentHash,
      document: current,
      patch: { operations: step.operations, source: "AGENT", summary: step.summary },
      proposalId: params.proposalId,
    });
    current = simulateCompositionAgentOperations(current, proposal.operations).document;
    return {
      id: step.id,
      dependsOn: step.dependsOn,
      baseDocumentHash,
      candidateDocumentHash: hashCompositionDocument(current),
      diff: proposal.diff,
      affectedRanges: proposal.affectedRanges,
      inverseOperations: proposal.inverseOperations,
      risk: proposal.risk,
      summary: proposal.summary,
      validation: proposal.validation,
    };
  });

  const proposal = buildCompositionAgentProposal({
    baseDocumentHash: scope.documentHash,
    document,
    patch: { operations, source: "AGENT", summary: plan.summary },
    proposalId: params.proposalId,
  });
  // Inverse execution is a local check, never authorization to apply USER patches.
  const restored = applyCompositionEditorPatches(current, proposal.inverseOperations, "USER");
  if (hashCompositionDocument(restored) !== scope.documentHash) {
    throw new CompositionAgentPlanError("AGENT_PLAN_INVERSE_MISMATCH", "La simulación no reproduce el documento base al revertirse.");
  }
  assertCompositionAgentScope(scope, authorization, now());
  return freezeCompositionAgentReadValue({
    baseRevision: scope.revision,
    candidateDocument: current,
    candidateDocumentHash: hashCompositionDocument(current),
    proposal,
    steps,
    operationCount: operations.length,
    automaticApply: false as const,
  });
}

function forbidden(): never {
  throw new CompositionAgentReadError("AGENT_READ_FORBIDDEN", "El host no autorizó la simulación o los tipos de operación del plan.");
}
