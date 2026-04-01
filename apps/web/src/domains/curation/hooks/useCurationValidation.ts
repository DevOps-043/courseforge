"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { validateCurationAction } from "../actions/curation.actions";
import type { CurationRow } from "../types/curation.types";
import { getPendingValidationCount } from "../lib/curation-ui";
import { getErrorMessage } from "@/lib/errors";
import { CURATION_STATES } from "@/lib/pipeline-constants";

const LAST_VALIDATION_KEY_PREFIX = "lastValidation_";
const VALIDATION_COOLDOWN_MS = 300000;

export function useCurationValidation(params: {
  artifactId: string;
  curationState?: string | null;
  rows: CurationRow[];
  refresh: () => Promise<void>;
}) {
  const { artifactId, curationState, rows, refresh } = params;
  const [isSubmittingValidation, setIsSubmittingValidation] = useState(false);
  const isValidatingFromDb = curationState === CURATION_STATES.VALIDATING;
  const isValidating = isValidatingFromDb || isSubmittingValidation;
  const isHydrated = true;

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

    setIsSubmittingValidation(true);
    localStorage.setItem(
      `${LAST_VALIDATION_KEY_PREFIX}${artifactId}`,
      Date.now().toString(),
    );

    try {
      const result = await validateCurationAction(artifactId);

      if (!result.success) {
        throw new Error(result.error || "Error en el servicio de validacion");
      }

      await refresh();
      toast.success("Validacion de fuentes completada.");
    } catch (error: unknown) {
      console.error(error);
      toast.error(
        "Fallo la validacion: " +
          getErrorMessage(error, "Error desconocido"),
      );
      await refresh();
    } finally {
      setIsSubmittingValidation(false);
    }
  };

  const pendingValidationCount = useMemo(
    () => getPendingValidationCount(rows),
    [rows],
  );
  const validatedCount = rows.length - pendingValidationCount;

  return {
    handleValidate,
    isHydrated,
    isValidating,
    pendingValidationCount,
    validatedCount,
  };
}
