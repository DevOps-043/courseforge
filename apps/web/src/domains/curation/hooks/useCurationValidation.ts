"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { validateCurationAction } from "../actions/curation.actions";
import type { CurationRow } from "../types/curation.types";
import { getPendingValidationCount } from "../lib/curation-ui";
import { getErrorMessage } from "@/lib/errors";

const VALIDATION_KEY_PREFIX = "isValidating_";
const LAST_VALIDATION_KEY_PREFIX = "lastValidation_";
const VALIDATION_COOLDOWN_MS = 300000;
const VALIDATION_TIMEOUT_MS = 900000;
const VALIDATION_POLL_INTERVAL_MS = 5000;

export function useCurationValidation(params: {
  artifactId: string;
  rows: CurationRow[];
  refresh: () => Promise<void>;
}) {
  const { artifactId, rows, refresh } = params;
  const [isValidating, setIsValidating] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const storedValidating = localStorage.getItem(
      `${VALIDATION_KEY_PREFIX}${artifactId}`,
    );

    console.log(
      "[Hydration] Checking localStorage for validation state:",
      storedValidating,
    );

    if (storedValidating === "true") {
      console.log("[Hydration] Restoring validation state from localStorage");
      setIsValidating(true);
    }

    setIsHydrated(true);
  }, [artifactId]);

  useEffect(() => {
    if (!isValidating || rows.length === 0) {
      return;
    }

    const pendingCount = getPendingValidationCount(rows);
    console.log(`[Validation] Pending rows: ${pendingCount}/${rows.length}`);

    if (pendingCount === 0) {
      console.log("[Validation] All rows processed. Stopping polling.");

      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }

      setIsValidating(false);
      localStorage.removeItem(`${VALIDATION_KEY_PREFIX}${artifactId}`);
      toast.success("Validacion de fuentes completada exitosamente.");
    }
  }, [artifactId, isValidating, rows]);

  useEffect(() => {
    if (!isValidating || pollIntervalRef.current || !isHydrated) {
      return;
    }

    console.log("[Validation] Starting polling for artifact:", artifactId);
    toast.info("Monitoreando progreso de validacion...");

    const pollInterval = setInterval(async () => {
      await refresh();
    }, VALIDATION_POLL_INTERVAL_MS);

    pollIntervalRef.current = pollInterval;

    const timeoutId = setTimeout(() => {
      console.log("[Validation] Timeout reached, stopping polling");
      clearInterval(pollInterval);
      pollIntervalRef.current = null;
      setIsValidating(false);
      localStorage.removeItem(`${VALIDATION_KEY_PREFIX}${artifactId}`);
      toast.info(
        "Monitoreo de validacion finalizado. Revisa los resultados.",
      );
      refresh();
    }, VALIDATION_TIMEOUT_MS);

    return () => {
      clearInterval(pollInterval);
      clearTimeout(timeoutId);
      pollIntervalRef.current = null;
    };
  }, [artifactId, isHydrated, isValidating, refresh]);

  const startPolling = () => {
    setIsValidating(true);
    localStorage.setItem(`${VALIDATION_KEY_PREFIX}${artifactId}`, "true");
  };

  const handleValidate = async () => {
    if (isValidating) {
      toast.warning("Ya hay una validacion en curso. Por favor espera.");
      return;
    }

    const lastValidation = localStorage.getItem(
      `${LAST_VALIDATION_KEY_PREFIX}${artifactId}`,
    );
    if (lastValidation) {
      const elapsed = Date.now() - parseInt(lastValidation, 10);
      if (elapsed < VALIDATION_COOLDOWN_MS) {
        toast.warning(
          `Validacion reciente detectada. Espera ${Math.ceil((VALIDATION_COOLDOWN_MS - elapsed) / 60000)} minutos mas.`,
        );
        return;
      }
    }

    startPolling();
    localStorage.setItem(
      `${LAST_VALIDATION_KEY_PREFIX}${artifactId}`,
      Date.now().toString(),
    );

    try {
      const result = await validateCurationAction(artifactId);

      if (!result.success) {
        throw new Error(result.error || "Error en el servicio de validacion");
      }

      toast.success(
        "Validacion iniciada. El proceso se ejecuta en segundo plano.",
      );
      toast.info("Los resultados se actualizaran automaticamente.");
    } catch (error: unknown) {
      console.error(error);
      toast.error(
        "Fallo la validacion: " +
          getErrorMessage(error, "Error desconocido"),
      );
      setIsValidating(false);
      localStorage.removeItem(`${VALIDATION_KEY_PREFIX}${artifactId}`);
    }
  };

  const pendingValidationCount = getPendingValidationCount(rows);
  const validatedCount = rows.length - pendingValidationCount;

  return {
    handleValidate,
    isHydrated,
    isValidating,
    pendingValidationCount,
    setIsValidating,
    validatedCount,
  };
}
