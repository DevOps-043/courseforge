"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getExternalBundlePreviewDataAction,
  requestExternalBundlePreviewRenderAction,
  type ExternalBundlePreviewData,
} from "@/domains/production/actions/templates.actions";

type PreviewStatus = ExternalBundlePreviewData["previewStatus"];

interface UseExternalTemplatePreviewParams {
  templateId: string;
  componentId?: string | null;
  initialPreviewData?: ExternalBundlePreviewData | null;
  variables?: Record<string, unknown>;
  onPreviewDataChange?: (previewData: ExternalBundlePreviewData | null) => void;
}

const AUTO_REQUEST_DELAY_MS = 700;
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 30;

export function formatExternalPreviewError(value: unknown): string {
  if (!value) return "No se pudo cargar el preview externo.";

  if (value instanceof Error) {
    return value.message || "No se pudo cargar el preview externo.";
  }

  if (typeof value === "string") {
    return value || "No se pudo cargar el preview externo.";
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const message = record.message || record.error || record.detail || record.details;

    if (typeof message === "string" && message.trim()) {
      return message;
    }

    if (message && typeof message === "object") {
      return formatExternalPreviewError(message);
    }

    try {
      return JSON.stringify(value);
    } catch {
      return "No se pudo cargar el preview externo.";
    }
  }

  return String(value) || "No se pudo cargar el preview externo.";
}

export function serializePreviewVariables(variables: Record<string, unknown>): string {
  try {
    return JSON.stringify(variables ?? {});
  } catch {
    return "{}";
  }
}

function parsePreviewVariables(variablesKey: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(variablesKey);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function shouldAutoRequestPreview(status: PreviewStatus | undefined) {
  return status === "MISSING" || status === "STALE" || status === "FAILED";
}

function shouldPollPreview(status: PreviewStatus | undefined) {
  return status === "QUEUED" || status === "RUNNING";
}

export function useExternalTemplatePreview({
  templateId,
  componentId,
  initialPreviewData = null,
  variables = {},
  onPreviewDataChange,
}: UseExternalTemplatePreviewParams) {
  const [previewData, setPreviewData] = useState<ExternalBundlePreviewData | null>(initialPreviewData);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRequestingPreview, setIsRequestingPreview] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [pollAttempt, setPollAttempt] = useState(0);
  const requestedKeysRef = useRef(new Set<string>());
  const onPreviewDataChangeRef = useRef(onPreviewDataChange);

  const variablesKey = useMemo(() => serializePreviewVariables(variables), [variables]);
  const requestKey = `${templateId}:${componentId || "global"}:${variablesKey}`;
  const requestVariables = useMemo(() => parsePreviewVariables(variablesKey), [variablesKey]);

  useEffect(() => {
    onPreviewDataChangeRef.current = onPreviewDataChange;
  }, [onPreviewDataChange]);

  const publishPreviewData = useCallback((nextPreviewData: ExternalBundlePreviewData | null) => {
    setPreviewData(nextPreviewData);
    onPreviewDataChangeRef.current?.(nextPreviewData);
  }, []);

  const loadPreview = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const result = await getExternalBundlePreviewDataAction({
        templateId,
        componentId,
        variables: requestVariables,
      });

      if (!result.success) {
        throw new Error(formatExternalPreviewError(result.error));
      }

      publishPreviewData(result.data);
      return result.data;
    } catch (err) {
      setError(formatExternalPreviewError(err));
      publishPreviewData(null);
      return null;
    } finally {
      if (!options.silent) {
        setIsLoading(false);
      }
    }
  }, [componentId, publishPreviewData, requestVariables, templateId]);

  const requestPreview = useCallback(async (options: { automatic?: boolean } = {}) => {
    setIsRequestingPreview(true);
    setError(null);

    try {
      const result = await requestExternalBundlePreviewRenderAction({
        templateId,
        componentId,
        variables: requestVariables,
      });

      if (!result.success) {
        throw new Error(formatExternalPreviewError(result.error));
      }

      requestedKeysRef.current.add(requestKey);
      publishPreviewData(result.data);
      setPollAttempt(0);
      return result.data;
    } catch (err) {
      const message = formatExternalPreviewError(err);
      setError(options.automatic ? null : message);
      return null;
    } finally {
      setIsRequestingPreview(false);
    }
  }, [componentId, publishPreviewData, requestKey, requestVariables, templateId]);

  useEffect(() => {
    requestedKeysRef.current.delete(requestKey);
    setPollAttempt(0);

    if (initialPreviewData?.serveUrl && initialPreviewData.compositionId && initialPreviewData.previewStatus === "READY") {
      publishPreviewData(initialPreviewData);
      setIsLoading(false);
      return;
    }

    void loadPreview();
  }, [initialPreviewData, loadPreview, publishPreviewData, reloadNonce, requestKey]);

  useEffect(() => {
    if (!previewData || !shouldAutoRequestPreview(previewData.previewStatus)) return;
    if (requestedKeysRef.current.has(requestKey)) return;

    const timeoutId = window.setTimeout(() => {
      void requestPreview({ automatic: true });
    }, AUTO_REQUEST_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [previewData, requestKey, requestPreview]);

  useEffect(() => {
    if (!previewData || !shouldPollPreview(previewData.previewStatus)) return;
    if (pollAttempt >= MAX_POLL_ATTEMPTS) return;

    const timeoutId = window.setTimeout(async () => {
      await loadPreview({ silent: true });
      setPollAttempt((current) => current + 1);
    }, POLL_INTERVAL_MS);

    return () => window.clearTimeout(timeoutId);
  }, [loadPreview, pollAttempt, previewData]);

  return {
    error,
    isLoading,
    isRequestingPreview,
    previewData,
    reload: () => setReloadNonce((value) => value + 1),
    requestPreview: () => requestPreview(),
    variablesKey,
  };
}
