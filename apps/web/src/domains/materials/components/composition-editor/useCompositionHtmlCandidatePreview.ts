"use client";

import {useEffect, useMemo, useState} from "react";
import {resolveHtmlPreviewCandidateIdentity, type HtmlPreviewCandidateRequest} from "@/domains/production/composition-editor/composition-html-editing-preview-candidate.client";
import {createHtmlEditingPreviewSession} from "@/domains/production/composition-editor/composition-html-editing-preview-channel.contract";
import {buildHtmlEditingPreviewPageUrl} from "@/domains/production/composition-editor/composition-html-editing-preview-url";
import type {CompositionAgentProposal, CompositionDocumentPayload} from "./composition-studio.types";
import type {CompositionPresetPreviewState} from "./CompositionPresetPanel";

/** A changed input immediately masks the previous URL, before effects run.
 * Async digest completion after dismissal/unmount cannot navigate a stale page. */
export function useCompositionHtmlCandidatePreview(input: {
  draftId: string; payload: CompositionDocumentPayload | null; generation: number;
  proposal: CompositionAgentProposal | null; preset: CompositionPresetPreviewState | null;
  onError: (message: string) => void;
}) {
  const candidate = useMemo<HtmlPreviewCandidateRequest | null>(() => input.preset
    ? {kind: "PRESET_APPLICATION", id: input.preset.applicationId, baseDocumentHash: input.preset.baseDocumentHash, documentHash: input.preset.proposedDocumentHash}
    : input.proposal ? {kind: "AGENT_PROPOSAL", id: input.proposal.proposalId, baseDocumentHash: input.proposal.baseDocumentHash,
      operations: input.proposal.operations} : null, [input.preset, input.proposal]);
  const request = useMemo(() => candidate && input.payload?.document.htmlEditing?.items.length
    ? {candidate, payload: input.payload, draftId: input.draftId, generation: input.generation} : null,
  [candidate, input.payload, input.draftId, input.generation]);
  const [resolved, setResolved] = useState<{request: typeof request; url: string} | null>(null);
  const onError = input.onError;
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    void resolveHtmlPreviewCandidateIdentity({document: request.payload.document, documentHash: request.payload.documentHash,
      candidate: request.candidate, signal: controller.signal}).then(identity => {
      if (controller.signal.aborted || !identity) return;
      const session = createHtmlEditingPreviewSession(identity.documentHash, request.generation);
      setResolved({request, url: buildHtmlEditingPreviewPageUrl(request.draftId, session, undefined, identity.candidate)});
    }).catch(() => {
      if (!controller.signal.aborted) onError("No se pudo preparar la identidad del preview HTML. Descarta o vuelve a solicitar el cambio.");
    });
    return () => controller.abort();
  }, [request, onError]);
  return {active: Boolean(request), url: resolved?.request === request ? resolved.url : null};
}
