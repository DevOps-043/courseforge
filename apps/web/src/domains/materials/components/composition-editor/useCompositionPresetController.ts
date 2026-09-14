"use client";

import { useCallback, useState } from "react";
import type { CompositionPresetCatalogEntry } from "@/domains/production/composition-editor/composition-preset.types";
import {
  COMPOSITION_VERSION_FALLBACK_HEADER,
  formatCompositionDocumentEtag,
  resolveCompositionDocumentVersion,
} from "@/domains/production/composition-editor/composition-document-version";
import { readCompositionApiResponse } from "@/domains/production/composition-editor/composition-editor-api.client";
import type { AppliedCompositionPreset, CompositionPresetPreviewState } from "./CompositionPresetPanel";
import type { CompositionDocumentPayload } from "./composition-studio.types";

interface UseCompositionPresetControllerOptions {
  agentProposalActive: boolean;
  draftId: string;
  getCurrentPayload: () => CompositionDocumentPayload | null;
  isSaveInFlight: () => boolean;
  onDocumentApplied: (payload: CompositionDocumentPayload) => void;
  onError: (message: string | null) => void;
  onSavingChange: (saving: boolean) => void;
  saving: boolean;
}

export function useCompositionPresetController({ agentProposalActive, draftId, getCurrentPayload, isSaveInFlight, onDocumentApplied, onError, onSavingChange, saving }: UseCompositionPresetControllerOptions) {
  const [presetPanelOpen, setPresetPanelOpen] = useState(false);
  const [presetEntries, setPresetEntries] = useState<CompositionPresetCatalogEntry[]>([]);
  const [presetCatalogLoading, setPresetCatalogLoading] = useState(false);
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetPreview, setPresetPreview] = useState<CompositionPresetPreviewState | null>(null);
  const [lastAppliedPreset, setLastAppliedPreset] = useState<AppliedCompositionPreset | null>(null);

  const loadRecoverablePresetApplication = useCallback(async () => {
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/preset-applications`, { cache: "no-store" });
      const body = await readCompositionApiResponse<{ data?: AppliedCompositionPreset | null; error?: string }>(response, "No se pudo recuperar el preset aplicado.");
      if (!response.ok) throw new Error(body.error || "No se pudo recuperar el preset aplicado.");
      setLastAppliedPreset(body.data || null);
    } catch {
      setLastAppliedPreset(null);
    }
  }, [draftId]);

  const loadCompositionPresets = useCallback(async () => {
    setPresetCatalogLoading(true);
    try {
      const response = await fetch("/api/production/hyperframes/composition-presets", { cache: "no-store" });
      const body = await readCompositionApiResponse<{ data?: CompositionPresetCatalogEntry[]; error?: string }>(response, "No se pudo cargar el catálogo de presets.");
      if (!response.ok || !body.data) throw new Error(body.error || "No se pudo cargar el catálogo de presets.");
      setPresetEntries(body.data);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "No se pudo cargar el catálogo de presets.");
    } finally {
      setPresetCatalogLoading(false);
    }
  }, [onError]);

  const createCompositionPreset = useCallback(async (input: { description: string; instruction?: string; mode: "INSTRUCTIONS" | "MANUAL"; name: string }) => {
    const currentPayload = getCurrentPayload();
    if (!currentPayload || presetBusy || saving) return;
    setPresetBusy(true);
    onError(null);
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/composition-presets`, {
        body: JSON.stringify(input),
        headers: { "Content-Type": "application/json", "If-Match": formatCompositionDocumentEtag(currentPayload.documentHash), [COMPOSITION_VERSION_FALLBACK_HEADER]: currentPayload.documentHash },
        method: "POST",
      });
      const body = await readCompositionApiResponse<{ error?: string }>(response, "No se pudo crear el preset.");
      if (!response.ok) throw new Error(body.error || "No se pudo crear el preset.");
      await loadCompositionPresets();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "No se pudo crear el preset.");
    } finally {
      setPresetBusy(false);
    }
  }, [draftId, getCurrentPayload, loadCompositionPresets, onError, presetBusy, saving]);

  const previewCompositionPreset = useCallback(async (presetId: string) => {
    const currentPayload = getCurrentPayload();
    if (!currentPayload || presetBusy || saving) return;
    if (agentProposalActive) {
      onError("Confirma o descarta la propuesta de SofLIA antes de abrir un preset.");
      return;
    }
    setPresetBusy(true);
    onError(null);
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/preset-applications`, { body: JSON.stringify({ presetId }), headers: { "Content-Type": "application/json" }, method: "POST" });
      const body = await readCompositionApiResponse<{ data?: CompositionPresetPreviewState; error?: string }>(response, "No se pudo preparar el preview del preset.");
      if (!response.ok || !body.data) throw new Error(body.error || "No se pudo preparar el preview del preset.");
      if (body.data.baseDocumentHash !== currentPayload.documentHash) throw new Error("La composición cambió antes de abrir el preview. Actualiza el catálogo y vuelve a intentar.");
      setLastAppliedPreset(null);
      setPresetPreview(body.data);
      setPresetPanelOpen(true);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "No se pudo preparar el preview del preset.");
    } finally {
      setPresetBusy(false);
    }
  }, [agentProposalActive, draftId, getCurrentPayload, onError, presetBusy, saving]);

  const applyCompositionPresetPreview = useCallback(async () => {
    const preview = presetPreview;
    const currentPayload = getCurrentPayload();
    if (!preview || !currentPayload || presetBusy || isSaveInFlight()) return;
    setPresetBusy(true);
    onSavingChange(true);
    onError(null);
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/preset-applications/${preview.applicationId}/apply`, { headers: { "If-Match": formatCompositionDocumentEtag(currentPayload.documentHash), [COMPOSITION_VERSION_FALLBACK_HEADER]: currentPayload.documentHash }, method: "POST" });
      const body = await readCompositionApiResponse<{ data?: CompositionDocumentPayload; error?: string }>(response, "No se pudo aplicar el preset.");
      if (!response.ok || !body.data) throw new Error(body.error || "No se pudo aplicar el preset.");
      body.data.documentHash = resolveCompositionDocumentVersion(body.data.documentHash);
      onDocumentApplied(body.data);
      setPresetPreview(null);
      setLastAppliedPreset({ applicationId: preview.applicationId, name: preview.preset.name });
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "No se pudo aplicar el preset.");
    } finally {
      setPresetBusy(false);
      onSavingChange(false);
    }
  }, [draftId, getCurrentPayload, isSaveInFlight, onDocumentApplied, onError, onSavingChange, presetBusy, presetPreview]);

  const dismissCompositionPresetPreview = useCallback(async () => {
    const preview = presetPreview;
    setPresetPreview(null);
    if (!preview) return;
    try {
      await fetch(`/api/production/hyperframes/drafts/${draftId}/preset-applications/${preview.applicationId}`, { method: "DELETE" });
    } catch {
      // The durable preview expires and cannot mutate the document without its unguessable id.
    }
  }, [draftId, presetPreview]);

  const undoLastCompositionPreset = useCallback(async () => {
    const applied = lastAppliedPreset;
    const currentPayload = getCurrentPayload();
    if (!applied || !currentPayload || presetBusy || isSaveInFlight()) return;
    if (!window.confirm(`¿Restaurar la versión completa anterior a “${applied.name}”?`)) return;
    setPresetBusy(true);
    onSavingChange(true);
    onError(null);
    try {
      const response = await fetch(`/api/production/hyperframes/drafts/${draftId}/preset-applications/${applied.applicationId}/undo`, { headers: { "If-Match": formatCompositionDocumentEtag(currentPayload.documentHash), [COMPOSITION_VERSION_FALLBACK_HEADER]: currentPayload.documentHash }, method: "POST" });
      const body = await readCompositionApiResponse<{ data?: CompositionDocumentPayload; error?: string }>(response, "No se pudo deshacer el preset.");
      if (!response.ok || !body.data) throw new Error(body.error || "No se pudo deshacer el preset.");
      body.data.documentHash = resolveCompositionDocumentVersion(body.data.documentHash);
      onDocumentApplied(body.data);
      setLastAppliedPreset(null);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "No se pudo deshacer el preset.");
    } finally {
      setPresetBusy(false);
      onSavingChange(false);
    }
  }, [draftId, getCurrentPayload, isSaveInFlight, lastAppliedPreset, onDocumentApplied, onError, onSavingChange, presetBusy]);

  return { applyCompositionPresetPreview, createCompositionPreset, dismissCompositionPresetPreview, lastAppliedPreset, loadCompositionPresets, loadRecoverablePresetApplication, presetBusy, presetCatalogLoading, presetEntries, presetPanelOpen, presetPreview, previewCompositionPreset, setLastAppliedPreset, setPresetPanelOpen, undoLastCompositionPreset };
}
