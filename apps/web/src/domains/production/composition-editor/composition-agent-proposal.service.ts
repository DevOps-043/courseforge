import {
  buildCompositionAgentAffectedRanges,
  buildCompositionAgentDiff,
} from "./composition-agent-diff.service";
import { assertCompositionAgentOperationsAllowed } from "./composition-agent-policy.service";
import {
  COMPOSITION_AGENT_PROPOSAL_SCHEMA_VERSION,
  compositionAgentProposalEnvelopeSchema,
} from "./composition-agent-proposal.types";
import { classifyCompositionAgentRisk } from "./composition-agent-risk.service";
import { simulateCompositionAgentOperations } from "./composition-agent-simulation.service";
import { validateCompositionAgentSimulation } from "./composition-agent-validation.service";
import type { CompositionEditorDocument } from "./composition-document.types";
import type { CompositionEditorPatchRequest } from "./editor-patch.types";

/** Builds a fully simulated, auditable proposal without persisting any state. */
export function buildCompositionAgentProposal(params: {
  baseDocumentHash: string;
  document: CompositionEditorDocument;
  patch: CompositionEditorPatchRequest;
  proposalId: string;
}) {
  assertCompositionAgentOperationsAllowed(params.patch.operations);
  const simulation = simulateCompositionAgentOperations(params.document, params.patch.operations);
  const diff = buildCompositionAgentDiff(params.document, simulation.document);
  const validation = validateCompositionAgentSimulation({
    after: simulation.document,
    before: params.document,
    diff,
  });

  return compositionAgentProposalEnvelopeSchema.parse({
    affectedRanges: buildCompositionAgentAffectedRanges({
      after: simulation.document,
      before: params.document,
      operations: params.patch.operations,
    }),
    baseDocumentHash: params.baseDocumentHash,
    diff,
    inverseOperations: simulation.inverseOperations,
    operations: params.patch.operations,
    proposalId: params.proposalId,
    risk: classifyCompositionAgentRisk(params.patch.operations),
    schemaVersion: COMPOSITION_AGENT_PROPOSAL_SCHEMA_VERSION,
    source: "AGENT",
    summary: params.patch.summary,
    validation,
  });
}
