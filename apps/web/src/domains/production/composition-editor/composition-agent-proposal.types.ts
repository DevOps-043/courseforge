import { z } from "zod";
import { compositionEditorPatchOperationSchema } from "./editor-patch.types";

export const COMPOSITION_AGENT_PROPOSAL_SCHEMA_VERSION = 2 as const;

export const compositionAgentValidationIssueSchema = z.object({
  code: z.string().trim().min(1).max(80),
  entityId: z.string().trim().min(1).max(160).optional(),
  message: z.string().trim().min(1).max(300),
  severity: z.enum(["ERROR", "WARNING"]),
}).strict();

export const compositionAgentFieldChangeSchema = z.object({
  after: z.unknown(),
  before: z.unknown(),
  entityId: z.string().trim().min(1).max(160),
  entityType: z.enum(["ANIMATION", "AUDIO_MIX", "CLIP", "TRACK"]),
  path: z.string().trim().min(1).max(300),
}).strict();

export const compositionAgentRiskSchema = z.object({
  level: z.enum(["LOW", "MEDIUM", "HIGH"]),
  reasons: z.array(z.string().trim().min(1).max(200)).max(20),
  requiresConfirmation: z.literal(true),
  requiresReinforcedConfirmation: z.boolean(),
}).strict();

export const compositionAgentAffectedRangeSchema = z.object({
  endSeconds: z.number().finite().positive(),
  startSeconds: z.number().finite().min(0),
}).strict().refine(
  (range) => range.endSeconds > range.startSeconds,
  "El rango afectado debe tener una duración positiva.",
);

export const compositionAgentProposalEnvelopeSchema = z.object({
  affectedRanges: z.array(compositionAgentAffectedRangeSchema).max(100),
  baseDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  diff: z.array(compositionAgentFieldChangeSchema).min(1).max(500),
  inverseOperations: z.array(compositionEditorPatchOperationSchema).min(1).max(100),
  operations: z.array(compositionEditorPatchOperationSchema).min(1).max(12),
  proposalId: z.string().uuid(),
  risk: compositionAgentRiskSchema,
  schemaVersion: z.literal(COMPOSITION_AGENT_PROPOSAL_SCHEMA_VERSION),
  source: z.literal("AGENT"),
  summary: z.string().trim().min(3).max(300),
  validation: z.object({
    issues: z.array(compositionAgentValidationIssueSchema).max(100),
    passed: z.boolean(),
  }).strict(),
}).strict();

export type CompositionAgentAffectedRange = z.infer<typeof compositionAgentAffectedRangeSchema>;
export type CompositionAgentFieldChange = z.infer<typeof compositionAgentFieldChangeSchema>;
export type CompositionAgentProposalEnvelope = z.infer<typeof compositionAgentProposalEnvelopeSchema>;
export type CompositionAgentRisk = z.infer<typeof compositionAgentRiskSchema>;
export type CompositionAgentValidationIssue = z.infer<typeof compositionAgentValidationIssueSchema>;
