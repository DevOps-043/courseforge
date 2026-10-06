import { z } from "zod";
import { assertCompositionAgentOperationsAllowed } from "./composition-agent-policy.service";
import { compositionAgentProposalEnvelopeSchema } from "./composition-agent-proposal.types";
import { assertCompositionAgentJsonInputBudget, CompositionAgentInputBudgetError } from "./composition-agent-input-budget.service";
import { compositionAgentPlanInputSchema } from "./composition-agent-plan.service";

/** Proposed host integration DTOs. Not wired to store/API/DB; parsing is not authorization. */
export const COMPOSITION_AGENT_INTEGRATION_LIMITS = Object.freeze({
  maxPayloadBytes: 128 * 1024,
  maxTtlMs: 15 * 60 * 1_000,
});
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const revisionSchema = z.number().int().positive().safe();
const timestampSchema = z.iso.datetime({ precision: 3, offset: false });

export const compositionAgentProposalBindingSchema = z.object({
  kind: z.literal("COMPOSITION_AGENT_PROPOSAL_BINDING"),
  schemaVersion: z.literal(1),
  digestFormat: z.literal("SORTED_JSON_UTF8_V1"),
  proposalId: z.string().uuid(),
  documentId: z.string().uuid(), // video_composition_drafts.id, not a new document identity
  organizationId: z.string().uuid(),
  ownerUserId: z.string().uuid(),
  baseRevision: revisionSchema,
  baseDocumentHash: sha256Schema,
  candidateDocumentHash: sha256Schema,
  policy: z.object({
    id: z.string().regex(/^[a-z][a-z0-9._-]{0,79}$/i),
    version: revisionSchema,
    sha256: sha256Schema,
  }).strict(),
  model: z.object({
    provider: z.enum(["gemini", "openai"]),
    id: z.string().trim().min(1).max(120),
  }).strict(),
  envelopeSha256: sha256Schema,
  planSha256: sha256Schema.nullable(),
  issuedAt: timestampSchema,
  expiresAt: timestampSchema,
}).strict().superRefine((binding, context) => {
  const ttl = Date.parse(binding.expiresAt) - Date.parse(binding.issuedAt);
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > COMPOSITION_AGENT_INTEGRATION_LIMITS.maxTtlMs) {
    context.addIssue({ code: "custom", path: ["expiresAt"], message: "El TTL propuesto debe ser positivo y de hasta 15 minutos." });
  }
  if (binding.baseDocumentHash === binding.candidateDocumentHash) {
    context.addIssue({ code: "custom", path: ["candidateDocumentHash"], message: "El binding debe identificar un cambio documental." });
  }
});
export type CompositionAgentProposalBinding = z.infer<typeof compositionAgentProposalBindingSchema>;

/** Host-produced record; these fields must never be accepted as client authority. */
export const compositionAgentBoundProposalSchema = z.object({
  binding: compositionAgentProposalBindingSchema,
  bindingSha256: sha256Schema, // external to binding: no self-referential digest
  envelope: compositionAgentProposalEnvelopeSchema,
  plan: compositionAgentPlanInputSchema.nullable(),
}).strict().superRefine((record, context) => {
  if (record.binding.proposalId !== record.envelope.proposalId || record.binding.baseDocumentHash !== record.envelope.baseDocumentHash) {
    context.addIssue({ code: "custom", path: ["envelope"], message: "El envelope no corresponde al binding." });
  }
  if (!record.envelope.validation.passed || record.envelope.validation.issues.some((issue) => issue.severity === "ERROR")) {
    context.addIssue({ code: "custom", path: ["envelope", "validation"], message: "Una propuesta rechazada no puede entrar al contrato de persistencia." });
  }
  if ((record.plan === null) !== (record.binding.planSha256 === null)) {
    context.addIssue({ code: "custom", path: ["plan"], message: "La presencia de plan debe coincidir con su digest declarado." });
  }
  if (record.plan && (record.plan.baseRevision !== record.binding.baseRevision
    || record.plan.baseDocumentHash !== record.binding.baseDocumentHash
    || JSON.stringify(record.plan.steps.flatMap((step) => step.operations)) !== JSON.stringify(record.envelope.operations))) {
    context.addIssue({ code: "custom", path: ["plan"], message: "El plan debe identificar la misma base y operaciones ordenadas del envelope." });
  }
  try {
    assertCompositionAgentOperationsAllowed(record.envelope.operations);
  } catch {
    context.addIssue({ code: "custom", path: ["envelope", "operations"], message: "El contrato conserva la allow-list ejecutable del agente." });
  }
});
export type CompositionAgentBoundProposal = z.infer<typeof compositionAgentBoundProposalSchema>;

/** Proposed apply body. Actor, delegation, timestamps and policy come only from the host. */
export const compositionAgentProposalConsentSchema = z.object({
  schemaVersion: z.literal(1),
  bindingSha256: sha256Schema,
  confirmed: z.literal(true),
  reinforcedConfirmation: z.boolean(),
}).strict();
export type CompositionAgentProposalConsent = z.infer<typeof compositionAgentProposalConsentSchema>;

const versionReferenceSchema = z.object({ revision: revisionSchema, documentHash: sha256Schema }).strict();
export const compositionAgentProposalReceiptSchema = z.object({
  kind: z.literal("COMPOSITION_AGENT_APPLY_RECEIPT"),
  schemaVersion: z.literal(1),
  proposalId: z.string().uuid(),
  documentId: z.string().uuid(),
  organizationId: z.string().uuid(),
  bindingSha256: sha256Schema,
  outcome: z.enum(["APPLIED", "ALREADY_APPLIED", "ALREADY_UNDONE"]),
  applied: versionReferenceSchema,
  undone: versionReferenceSchema.nullable(),
}).strict().superRefine((receipt, context) => {
  if ((receipt.outcome === "ALREADY_UNDONE") !== (receipt.undone !== null)) {
    context.addIssue({ code: "custom", path: ["undone"], message: "El recibo debe identificar exactamente el estado histórico devuelto." });
  }
  if (receipt.undone && receipt.undone.revision <= receipt.applied.revision) {
    context.addIssue({ code: "custom", path: ["undone", "revision"], message: "Undo debe referenciar una revisión posterior a apply." });
  }
});
export type CompositionAgentProposalReceipt = z.infer<typeof compositionAgentProposalReceiptSchema>;

export class CompositionAgentIntegrationContractError extends Error {
  constructor(readonly code: "AGENT_INTEGRATION_PAYLOAD_LIMIT" | "AGENT_CONSENT_BINDING_MISMATCH" | "AGENT_CONSENT_REINFORCEMENT_REQUIRED" | "AGENT_RECEIPT_BINDING_MISMATCH") {
    super(code);
  }
}

/** Structural decoder only: host must independently authenticate, hash, simulate and persist. */
export function parseCompositionAgentBoundProposal(input: unknown) {
  assertPayloadBudget(input);
  return compositionAgentBoundProposalSchema.parse(input);
}

/** Correlates explicit consent to host-owned metadata, without granting apply permission. */
export function parseCompositionAgentProposalConsent(input: unknown, expected: { bindingSha256: string; requiresReinforcedConfirmation: boolean }) {
  assertPayloadBudget(input);
  const consent = compositionAgentProposalConsentSchema.parse(input);
  const host = z.object({ bindingSha256: sha256Schema, requiresReinforcedConfirmation: z.boolean() }).strict().parse(expected);
  if (consent.bindingSha256 !== host.bindingSha256) throw new CompositionAgentIntegrationContractError("AGENT_CONSENT_BINDING_MISMATCH");
  if (host.requiresReinforcedConfirmation && !consent.reinforcedConfirmation) {
    throw new CompositionAgentIntegrationContractError("AGENT_CONSENT_REINFORCEMENT_REQUIRED");
  }
  return consent;
}

/** Transport correlation only. A matching receipt is not proof of a durable transaction. */
export function parseCompositionAgentProposalReceipt(input: unknown, expected: { binding: CompositionAgentProposalBinding; bindingSha256: string }) {
  assertPayloadBudget(input);
  const binding = compositionAgentProposalBindingSchema.parse(expected.binding);
  const digest = sha256Schema.parse(expected.bindingSha256);
  const receipt = compositionAgentProposalReceiptSchema.parse(input);
  if (receipt.proposalId !== binding.proposalId || receipt.documentId !== binding.documentId
    || receipt.organizationId !== binding.organizationId || receipt.bindingSha256 !== digest
    || receipt.applied.revision !== binding.baseRevision + 1
    || receipt.applied.documentHash !== binding.candidateDocumentHash
    || (receipt.undone && receipt.undone.documentHash !== binding.baseDocumentHash)) {
    throw new CompositionAgentIntegrationContractError("AGENT_RECEIPT_BINDING_MISMATCH");
  }
  return receipt;
}

function assertPayloadBudget(input: unknown) {
  try {
    assertCompositionAgentJsonInputBudget(input, COMPOSITION_AGENT_INTEGRATION_LIMITS.maxPayloadBytes);
  } catch (error) {
    if (error instanceof CompositionAgentInputBudgetError && error.code === "AGENT_INPUT_LIMIT_EXCEEDED") {
      throw new CompositionAgentIntegrationContractError("AGENT_INTEGRATION_PAYLOAD_LIMIT");
    }
    throw error;
  }
}
