"use client";

import { useCallback, useState } from "react";
import { applyCompositionEditorPatches } from "@/domains/production/composition-editor/editor-patch.service";
import {
  COMPOSITION_VERSION_FALLBACK_HEADER,
  formatCompositionDocumentEtag,
  resolveCompositionDocumentVersion,
} from "@/domains/production/composition-editor/composition-document-version";
import { readCompositionApiResponse } from "@/domains/production/composition-editor/composition-editor-api.client";
import type { CompositionAgentProposal, CompositionDocumentPayload } from "./composition-studio.types";

interface UseCompositionAgentProposalControllerOptions {
  draftId: string;
  getCurrentPayload: () => CompositionDocumentPayload | null;
  isSaveInFlight: () => boolean;
  onError: (message: string | null) => void;
  onMutationFailed: (previousPayload: CompositionDocumentPayload) => void;
  onMutationFinished: () => void;
  onMutationStarted: (optimisticPayload: CompositionDocumentPayload) => void;
  onMutationSucceeded: (payload: CompositionDocumentPayload) => void;
  selectedClipId: string | null;
}

export function useCompositionAgentProposalController({
  draftId,
  getCurrentPayload,
  isSaveInFlight,
  onError,
  onMutationFailed,
  onMutationFinished,
  onMutationStarted,
  onMutationSucceeded,
  selectedClipId,
}: UseCompositionAgentProposalControllerOptions) {
  const [agentProposal, setAgentProposal] = useState<CompositionAgentProposal | null>(null);
  const [lastAppliedAgentProposal, setLastAppliedAgentProposal] = useState<CompositionAgentProposal | null>(null);
  const [proposing, setProposing] = useState(false);

  const requestAgentProposal = useCallback(async (instruction: string, presetPreviewActive = false) => {
    const currentPayload = getCurrentPayload();
    if (!currentPayload) return;
    if (presetPreviewActive) {
      onError("Confirma o descarta el preset antes de solicitar otra edición.");
      return;
    }
    setProposing(true);
    onError(null);
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/agent-proposals`, {
        body: JSON.stringify({ instruction, selectedClipId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body = await readCompositionApiResponse<{ data?: CompositionAgentProposal; error?: string }>(response, "No se pudo preparar la propuesta.");
      if (!response.ok || !body.data) throw new Error(body.error || "No se pudo preparar la propuesta.");
      if (body.data.documentHash !== currentPayload.documentHash) throw new Error("La composición cambió antes de recibir la propuesta. Vuelve a solicitarla.");
      setLastAppliedAgentProposal(null);
      setAgentProposal(body.data);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "No se pudo preparar la propuesta.");
    } finally {
      setProposing(false);
    }
  }, [draftId, getCurrentPayload, onError, selectedClipId]);

  const approveAgentProposal = useCallback(async () => {
    const proposal = agentProposal;
    const currentPayload = getCurrentPayload();
    if (!proposal || !currentPayload || isSaveInFlight()) return;
    let reinforcedConfirmation = false;
    if (proposal.risk.requiresReinforcedConfirmation) {
      reinforcedConfirmation = window.confirm(`Este cambio tiene riesgo alto: ${proposal.risk.reasons.join(" ")} ¿Deseas aplicarlo de todos modos?`);
      if (!reinforcedConfirmation) return;
    }
    let optimisticPayload: CompositionDocumentPayload;
    try {
      optimisticPayload = {
        ...currentPayload,
        document: applyCompositionEditorPatches(currentPayload.document, proposal.operations, "AGENT"),
      };
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "La propuesta ya no puede aplicarse.");
      return;
    }
    onMutationStarted(optimisticPayload);
    onError(null);
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/agent-proposals/${proposal.proposalId}/apply`, {
        body: JSON.stringify({ reinforcedConfirmation }),
        headers: {
          "Content-Type": "application/json",
          "If-Match": formatCompositionDocumentEtag(currentPayload.documentHash),
          [COMPOSITION_VERSION_FALLBACK_HEADER]: currentPayload.documentHash,
        },
        method: "POST",
      });
      const body = await readCompositionApiResponse<{ data?: CompositionDocumentPayload; error?: string }>(response, "No se pudo aplicar la propuesta.");
      if (!response.ok || !body.data) throw new Error(body.error || "No se pudo aplicar la propuesta.");
      body.data.documentHash = resolveCompositionDocumentVersion(body.data.documentHash);
      onMutationSucceeded(body.data);
      setLastAppliedAgentProposal(proposal);
      setAgentProposal(null);
    } catch (caught) {
      onMutationFailed(currentPayload);
      onError(caught instanceof Error ? caught.message : "No se pudo aplicar la propuesta.");
    } finally {
      onMutationFinished();
    }
  }, [agentProposal, draftId, getCurrentPayload, isSaveInFlight, onError, onMutationFailed, onMutationFinished, onMutationStarted, onMutationSucceeded]);

  const dismissAgentProposal = useCallback(async () => {
    const proposal = agentProposal;
    setAgentProposal(null);
    if (!proposal) return;
    try {
      await fetch(`/api/production/hyperframes/drafts/${draftId}/agent-proposals/${proposal.proposalId}`, { method: "DELETE" });
    } catch {
      // The durable proposal expires and cannot mutate the document without its unguessable id.
    }
  }, [agentProposal, draftId]);

  const undoLastAgentProposal = useCallback(async () => {
    const proposal = lastAppliedAgentProposal;
    const currentPayload = getCurrentPayload();
    if (!proposal || !currentPayload || isSaveInFlight()) return;
    if (!window.confirm(`¿Deshacer esta edición asistida? ${proposal.summary}`)) return;
    let optimisticPayload: CompositionDocumentPayload;
    try {
      optimisticPayload = {
        ...currentPayload,
        document: applyCompositionEditorPatches(currentPayload.document, proposal.inverseOperations, "USER"),
      };
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "La edición ya no puede deshacerse automáticamente.");
      return;
    }
    onMutationStarted(optimisticPayload);
    onError(null);
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/agent-proposals/${proposal.proposalId}/undo`, {
        headers: {
          "If-Match": formatCompositionDocumentEtag(currentPayload.documentHash),
          [COMPOSITION_VERSION_FALLBACK_HEADER]: currentPayload.documentHash,
        },
        method: "POST",
      });
      const body = await readCompositionApiResponse<{ data?: CompositionDocumentPayload; error?: string }>(response, "No se pudo deshacer la edición.");
      if (!response.ok || !body.data) throw new Error(body.error || "No se pudo deshacer la edición.");
      body.data.documentHash = resolveCompositionDocumentVersion(body.data.documentHash);
      onMutationSucceeded(body.data);
      setLastAppliedAgentProposal(null);
    } catch (caught) {
      onMutationFailed(currentPayload);
      onError(caught instanceof Error ? caught.message : "No se pudo deshacer la edición.");
    } finally {
      onMutationFinished();
    }
  }, [draftId, getCurrentPayload, isSaveInFlight, lastAppliedAgentProposal, onError, onMutationFailed, onMutationFinished, onMutationStarted, onMutationSucceeded]);

  const resetAgentProposalState = useCallback(() => {
    setAgentProposal(null);
    setLastAppliedAgentProposal(null);
  }, []);
  const clearLastAppliedAgentProposal = useCallback(() => {
    setLastAppliedAgentProposal(null);
  }, []);

  return {
    agentProposal,
    approveAgentProposal,
    clearLastAppliedAgentProposal,
    dismissAgentProposal,
    lastAppliedAgentProposal,
    proposing,
    requestAgentProposal,
    resetAgentProposalState,
    undoLastAgentProposal,
  };
}
