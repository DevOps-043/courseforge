"use client";
import { useCallback, useEffect, useState } from "react";
import type {
  ImportCommand,
  ImportOutline,
  SyllabusImportRecord,
} from "./syllabus-import.schema";

export interface ImportDocumentOption {
  id: string;
  filename: string;
}
interface ImportResponse {
  enabled?: boolean;
  import: SyllabusImportRecord | null;
  documents?: ImportDocumentOption[];
  original?: { filename: string; text: string } | null;
  message?: string;
}

export function useSyllabusImport(
  artifactId: string,
  onCompleted: () => Promise<void>,
) {
  const [entry, setEntry] = useState<SyllabusImportRecord | null>(null);
  const [outline, setOutline] = useState<ImportOutline>([]);
  const [documents, setDocuments] = useState<ImportDocumentOption[]>([]);
  const [original, setOriginal] = useState<ImportResponse["original"]>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const applyResponse = useCallback((payload: ImportResponse) => {
    setEntry(payload.import);
    setOutline(payload.import?.candidate_outline || []);
    if (payload.documents) setDocuments(payload.documents);
    if (payload.original !== undefined) setOriginal(payload.original);
    if (payload.enabled !== undefined) setEnabled(payload.enabled);
  }, []);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(
        `/api/syllabus/imports?artifactId=${encodeURIComponent(artifactId)}`,
        { cache: "no-store", signal },
      );
      const payload = (await response.json()) as ImportResponse;
      if (!response.ok)
        throw new Error(
          payload.message || "No se pudo consultar la importación.",
        );
      applyResponse(payload);
      return payload;
    },
    [artifactId, applyResponse],
  );
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch((error) => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    if (!entry?.lease_expires_at) return;
    const controller = new AbortController();
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const payload = await refresh(controller.signal);
        if (
          !payload.import?.lease_expires_at &&
          payload.import?.status !== "FAILED"
        )
          await onCompleted();
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "No se pudo consultar el progreso.",
          );
      } finally {
        inFlight = false;
      }
    };
    const interval = setInterval(() => void poll(), 3_000);
    return () => {
      clearInterval(interval);
      controller.abort();
    };
  }, [entry?.lease_expires_at, refresh, onCompleted]);

  const command = async (request: ImportCommand) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/syllabus/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload = (await response.json()) as ImportResponse;
      if (!response.ok)
        throw new Error(
          payload.message || "No se pudo completar la operación.",
        );
      applyResponse(payload);
      if (request.action === "start" && !payload.import?.lease_expires_at)
        await refresh();
      if (!payload.import?.lease_expires_at && request.action === "enrich")
        await onCompleted();
    } catch (error) {
      // Do not replace the local draft on conflict; user can copy or reload it.
      setError(
        error instanceof Error
          ? error.message
          : "No se pudo completar la operación.",
      );
      if (["start", "enrich", "propose", "retry"].includes(request.action)) {
        try {
          await refresh();
        } catch {
          /* Keep the actionable original failure. */
        }
      }
    } finally {
      setBusy(false);
    }
  };
  const reload = async () => {
    try {
      await refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No se pudo recargar la revisión.",
      );
    }
  };
  return {
    entry,
    outline,
    setOutline,
    documents,
    setDocuments,
    original,
    enabled,
    busy: busy || Boolean(entry?.lease_expires_at),
    error,
    refresh: reload,
    command,
  };
}
