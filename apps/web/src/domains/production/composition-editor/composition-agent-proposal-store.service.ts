import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCompositionAgentProposal } from "./composition-agent-proposal.service";
import {
  compositionAgentProposalEnvelopeSchema,
  type CompositionAgentProposalEnvelope,
} from "./composition-agent-proposal.types";
import { simulateCompositionAgentOperations } from "./composition-agent-simulation.service";
import {
  getCurrentCompositionDocument,
  hashCompositionDocument,
} from "./composition-document.service";
import { applyCompositionEditorPatches } from "./editor-patch.service";
import type { CompositionEditorDocument } from "./composition-document.types";
import type { CompositionAgentRecoveryMetadata } from "./composition-agent-recovery.service";

export const COMPOSITION_AGENT_PROPOSAL_TTL_MS = 15 * 60 * 1_000;

const PROPOSAL_STATUSES = ["APPLIED", "DISMISSED", "EXPIRED", "PENDING", "UNDONE"] as const;
type ProposalStatus = typeof PROPOSAL_STATUSES[number];

interface StoredCompositionAgentProposal {
  appliedDocumentHash: string | null;
  appliedVersion: number | null;
  baseDocumentHash: string;
  envelope: CompositionAgentProposalEnvelope;
  expiresAt: string;
  model: string;
  status: ProposalStatus;
  undoneDocumentHash: string | null;
  undoneVersion: number | null;
}

export class CompositionAgentProposalStoreError extends Error {
  constructor(
    message: string,
    readonly code:
      | "PROPOSAL_CONFIRMATION_REQUIRED"
      | "PROPOSAL_CONFLICT"
      | "PROPOSAL_EXPIRED"
      | "PROPOSAL_STORAGE_NOT_READY"
      | "PROPOSAL_UNAVAILABLE"
      | "PROPOSAL_UNDO_CONFLICT",
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export async function persistCompositionAgentProposal(params: {
  draftId: string;
  envelope: CompositionAgentProposalEnvelope;
  model: string;
  organizationId: string;
  recovery: CompositionAgentRecoveryMetadata;
  supabase: SupabaseClient<any, "public", any>;
  userId: string;
}) {
  const envelope = compositionAgentProposalEnvelopeSchema.parse(params.envelope);
  const expiresAt = new Date(Date.now() + COMPOSITION_AGENT_PROPOSAL_TTL_MS).toISOString();
  const { error } = await params.supabase.from("video_composition_agent_proposals").insert({
    base_document_hash: envelope.baseDocumentHash,
    created_by: params.userId,
    draft_id: params.draftId,
    envelope,
    expires_at: expiresAt,
    id: envelope.proposalId,
    model: params.model,
    organization_id: params.organizationId,
    recovery_attempt_count: params.recovery.attemptCount,
    recovery_repaired: params.recovery.repaired,
    recovery_used_fallback: params.recovery.usedFallback,
    schema_version: envelope.schemaVersion,
    status: "PENDING",
  });
  if (error) throw normalizeProposalStorageError(error);
  return { expiresAt };
}

export async function getCompositionAgentPreviewDocument(params: ProposalLookupParams) {
  const stored = await getStoredProposal(params);
  assertPendingProposalAvailable(stored);
  const current = await getCurrentCompositionDocument(params);
  if (current.documentHash !== stored.baseDocumentHash) throw proposalConflict();
  return rebuildAndSimulate(stored, current.document).document;
}

export async function applyStoredCompositionAgentProposal(params: ProposalLookupParams & {
  expectedDocumentHash: string;
  reinforcedConfirmation: boolean;
  signal?: AbortSignal;
  userId: string;
}) {
  const stored = await getStoredProposal(params);
  const current = await getCurrentCompositionDocument(params);

  if (stored.status === "APPLIED" || stored.status === "UNDONE") {
    return { ...(await getCurrentCompositionDocument(params)), idempotentReplay: true, proposalStatus: stored.status };
  }
  assertPendingProposalAvailable(stored);
  if (params.expectedDocumentHash !== stored.baseDocumentHash || current.documentHash !== stored.baseDocumentHash) {
    throw proposalConflict();
  }

  const rebuilt = rebuildAndSimulate(stored, current.document);
  if (rebuilt.envelope.risk.requiresReinforcedConfirmation && !params.reinforcedConfirmation) {
    throw new CompositionAgentProposalStoreError(
      "Esta propuesta requiere una confirmación reforzada antes de aplicarse.",
      "PROPOSAL_CONFIRMATION_REQUIRED",
      409,
    );
  }
  const nextHash = hashCompositionDocument(rebuilt.document);
  let request = params.supabase.rpc("apply_video_composition_agent_proposal", {
    p_actor_id: params.userId,
    p_document: rebuilt.document,
    p_document_hash: nextHash,
    p_draft_id: params.draftId,
    p_expected_document_hash: params.expectedDocumentHash,
    p_format: rebuilt.document.format,
    p_metadata: proposalAuditMetadata(stored, rebuilt.envelope),
    p_organization_id: params.organizationId,
    p_proposal_id: params.proposalId,
    p_reinforced_confirmation: params.reinforcedConfirmation,
    p_summary: rebuilt.envelope.summary,
  }).retry(false);
  if (params.signal) request = request.abortSignal(params.signal);
  const { data, error } = await request;
  if (error) throw normalizeProposalStorageError(error);
  const outcome = parseRpcOutcome(data);
  assertApplyOutcome(outcome.outcome);
  return {
    ...(await getCurrentCompositionDocument(params)),
    idempotentReplay: outcome.outcome === "ALREADY_APPLIED" || outcome.outcome === "ALREADY_UNDONE",
    proposalStatus: outcome.outcome === "ALREADY_UNDONE" ? "UNDONE" as const : "APPLIED" as const,
  };
}

export async function undoStoredCompositionAgentProposal(params: ProposalLookupParams & {
  expectedDocumentHash: string;
  signal?: AbortSignal;
  userId: string;
}) {
  const stored = await getStoredProposal(params);
  if (stored.status === "UNDONE") {
    return { ...(await getCurrentCompositionDocument(params)), idempotentReplay: true, proposalStatus: "UNDONE" as const };
  }
  if (stored.status !== "APPLIED" || !stored.appliedDocumentHash) {
    throw new CompositionAgentProposalStoreError(
      "La propuesta no está aplicada y no se puede deshacer.",
      "PROPOSAL_UNDO_CONFLICT",
      409,
    );
  }
  const current = await getCurrentCompositionDocument(params);
  if (
    params.expectedDocumentHash !== stored.appliedDocumentHash
    || current.documentHash !== stored.appliedDocumentHash
  ) {
    throw new CompositionAgentProposalStoreError(
      "La composición cambió después de aplicar la propuesta. Restaura una versión desde el historial para evitar perder cambios posteriores.",
      "PROPOSAL_UNDO_CONFLICT",
      409,
    );
  }

  const { document: nextDocument, documentHash: nextHash } = prepareCompositionAgentProposalUndo({
    appliedDocument: current.document,
    envelope: stored.envelope,
  });

  let request = params.supabase.rpc("undo_video_composition_agent_proposal", {
    p_actor_id: params.userId,
    p_document: nextDocument,
    p_document_hash: nextHash,
    p_draft_id: params.draftId,
    p_expected_document_hash: params.expectedDocumentHash,
    p_format: nextDocument.format,
    p_metadata: { inverseOperationTypes: stored.envelope.inverseOperations.map((operation) => operation.type) },
    p_organization_id: params.organizationId,
    p_proposal_id: params.proposalId,
    p_summary: `Deshizo la propuesta: ${stored.envelope.summary}`.slice(0, 300),
  }).retry(false);
  if (params.signal) request = request.abortSignal(params.signal);
  const { data, error } = await request;
  if (error) throw normalizeProposalStorageError(error);
  const outcome = parseRpcOutcome(data);
  if (outcome.outcome === "UNDO_CONFLICT") {
    throw new CompositionAgentProposalStoreError(
      "La composición cambió después de aplicar la propuesta y no puede deshacerse automáticamente.",
      "PROPOSAL_UNDO_CONFLICT",
      409,
    );
  }
  if (outcome.outcome !== "UNDONE" && outcome.outcome !== "ALREADY_UNDONE") {
    assertCommonMutationOutcome(outcome.outcome);
  }
  return {
    ...(await getCurrentCompositionDocument(params)),
    idempotentReplay: outcome.outcome === "ALREADY_UNDONE",
    proposalStatus: "UNDONE" as const,
  };
}

export async function dismissStoredCompositionAgentProposal(params: ProposalLookupParams) {
  const { error } = await params.supabase
    .from("video_composition_agent_proposals")
    .update({ status: "DISMISSED", updated_at: new Date().toISOString() })
    .eq("id", params.proposalId)
    .eq("draft_id", params.draftId)
    .eq("organization_id", params.organizationId)
    .eq("status", "PENDING");
  if (error) throw normalizeProposalStorageError(error);
}

interface ProposalLookupParams {
  draftId: string;
  organizationId: string;
  proposalId: string;
  supabase: SupabaseClient<any, "public", any>;
}

async function getStoredProposal(params: ProposalLookupParams): Promise<StoredCompositionAgentProposal> {
  const { data, error } = await params.supabase
    .from("video_composition_agent_proposals")
    .select("applied_document_hash, applied_version, base_document_hash, envelope, expires_at, model, status, undone_document_hash, undone_version")
    .eq("id", params.proposalId)
    .eq("draft_id", params.draftId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (error) throw normalizeProposalStorageError(error);
  if (!data || !PROPOSAL_STATUSES.includes(data.status as ProposalStatus)) {
    throw new CompositionAgentProposalStoreError("La propuesta ya no está disponible.", "PROPOSAL_UNAVAILABLE", 404);
  }
  return {
    appliedDocumentHash: data.applied_document_hash as string | null,
    appliedVersion: data.applied_version as number | null,
    baseDocumentHash: data.base_document_hash as string,
    envelope: compositionAgentProposalEnvelopeSchema.parse(data.envelope),
    expiresAt: data.expires_at as string,
    model: data.model as string,
    status: data.status as ProposalStatus,
    undoneDocumentHash: data.undone_document_hash as string | null,
    undoneVersion: data.undone_version as number | null,
  };
}

function assertPendingProposalAvailable(stored: StoredCompositionAgentProposal) {
  if (stored.status !== "PENDING") {
    throw new CompositionAgentProposalStoreError("La propuesta ya no está pendiente.", "PROPOSAL_UNAVAILABLE", 409);
  }
  if (Date.parse(stored.expiresAt) <= Date.now()) {
    throw new CompositionAgentProposalStoreError("La propuesta expiró. Solicita una nueva para trabajar sobre la versión actual.", "PROPOSAL_EXPIRED", 410);
  }
}

export function prepareCompositionAgentProposalApplication(params: {
  baseDocumentHash: string;
  document: CompositionEditorDocument;
  envelope: CompositionAgentProposalEnvelope;
}) {
  const envelope = buildCompositionAgentProposal({
    baseDocumentHash: params.baseDocumentHash,
    document: params.document,
    patch: { operations: params.envelope.operations, source: "AGENT", summary: params.envelope.summary },
    proposalId: params.envelope.proposalId,
  });
  const simulation = simulateCompositionAgentOperations(params.document, envelope.operations);
  return { document: simulation.document, envelope };
}

export function prepareCompositionAgentProposalUndo(params: {
  appliedDocument: CompositionEditorDocument;
  envelope: CompositionAgentProposalEnvelope;
}) {
  const document = applyCompositionEditorPatches(
    params.appliedDocument,
    params.envelope.inverseOperations,
    "USER",
  );
  const documentHash = hashCompositionDocument(document);
  if (documentHash !== params.envelope.baseDocumentHash) {
    throw new CompositionAgentProposalStoreError(
      "La reversión ya no reproduce exactamente la versión original.",
      "PROPOSAL_UNDO_CONFLICT",
      409,
    );
  }
  return { document, documentHash };
}

function rebuildAndSimulate(stored: StoredCompositionAgentProposal, document: CompositionEditorDocument) {
  return prepareCompositionAgentProposalApplication({
    baseDocumentHash: stored.baseDocumentHash,
    document,
    envelope: stored.envelope,
  });
}

function proposalAuditMetadata(stored: StoredCompositionAgentProposal, envelope: CompositionAgentProposalEnvelope) {
  return {
    model: stored.model,
    operationTypes: envelope.operations.map((operation) => operation.type),
    riskLevel: envelope.risk.level,
    schemaVersion: envelope.schemaVersion,
    validationCodes: envelope.validation.issues.map((issue) => issue.code),
  };
}

function parseRpcOutcome(data: unknown) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object" || typeof (row as { outcome?: unknown }).outcome !== "string") {
    throw new CompositionAgentProposalStoreError("El almacenamiento devolvió un resultado inválido.", "PROPOSAL_STORAGE_NOT_READY", 503, true);
  }
  return row as { document_hash: string | null; outcome: string; version: number | null };
}

function assertApplyOutcome(outcome: string) {
  if (outcome === "APPLIED" || outcome === "ALREADY_APPLIED" || outcome === "ALREADY_UNDONE") return;
  if (outcome === "CONFIRMATION_REQUIRED") {
    throw new CompositionAgentProposalStoreError("La propuesta requiere confirmación reforzada.", "PROPOSAL_CONFIRMATION_REQUIRED", 409);
  }
  if (outcome === "PROPOSAL_EXPIRED") {
    throw new CompositionAgentProposalStoreError("La propuesta expiró.", "PROPOSAL_EXPIRED", 410);
  }
  assertCommonMutationOutcome(outcome);
}

function assertCommonMutationOutcome(outcome: string) {
  if (outcome === "CONFLICT" || outcome === "UNDO_CONFLICT") throw proposalConflict();
  if (outcome === "PROPOSAL_UNAVAILABLE" || outcome === "NOT_EDITABLE") {
    throw new CompositionAgentProposalStoreError("La propuesta o el borrador ya no están disponibles.", "PROPOSAL_UNAVAILABLE", 409);
  }
  if (outcome === "BUSY") {
    throw new CompositionAgentProposalStoreError("Ya hay otro cambio guardándose. Vuelve a intentar.", "PROPOSAL_CONFLICT", 409, true);
  }
  throw new CompositionAgentProposalStoreError("No se pudo guardar la propuesta.", "PROPOSAL_STORAGE_NOT_READY", 503, true);
}

function proposalConflict() {
  return new CompositionAgentProposalStoreError(
    "La composición cambió desde que se creó la propuesta. Solicita una nueva propuesta.",
    "PROPOSAL_CONFLICT",
    409,
  );
}

function normalizeProposalStorageError(error: unknown) {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
  if (candidate.code === "PGRST202" || /Could not find the function|relation .* does not exist/i.test(String(candidate.message || ""))) {
    return new CompositionAgentProposalStoreError(
      "El almacenamiento de propuestas aún no está disponible. Aplica la migración correspondiente.",
      "PROPOSAL_STORAGE_NOT_READY",
      503,
      true,
    );
  }
  return error;
}
