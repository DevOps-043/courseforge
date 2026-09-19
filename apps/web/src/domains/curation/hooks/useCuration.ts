import { useState, useEffect, useCallback, useRef } from "react";
import { Curation, CurationRow } from "../types/curation.types";
import {
  getCurationSnapshotAction,
  startCurationAction,
  clearSystemGeneratedCurationRowsAction,
  clearInvalidCurationRowsAction,
} from "../actions/curation.actions";
import { toast } from "sonner";
import {
  CURATION_RUNNING_STATES,
  CURATION_STATES,
} from "@/lib/pipeline-constants";
import { usePolling } from "@/shared/hooks/usePolling";
import { isSystemGeneratedCurationRow } from "../lib/curation-row-rules";

export interface CurationLessonRequirement {
  lessonId: string;
  lessonTitle: string;
  requiredSources: number;
  videoTargetSeconds: number;
}

function isUnauthorizedError(error: unknown) {
  if (typeof error === "string") return error === "Unauthorized";
  if (error instanceof Error) return error.message === "Unauthorized";
  return false;
}

export function useCuration(artifactId: string) {
  const [curation, setCuration] = useState<Curation | null>(null);
  const [rows, setRows] = useState<CurationRow[]>([]);
  const [lessonRequirements, setLessonRequirements] = useState<
    CurationLessonRequirement[]
  >([]);
  const [configuredPrompt, setConfiguredPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [snapshotAuthUnavailable, setSnapshotAuthUnavailable] = useState(false);
  const hasShownAuthToast = useRef(false);
  const startInFlight = useRef(false);
  const isValidating = curation?.state === CURATION_STATES.VALIDATING;

  const fetchCurationData = useCallback(async () => {
    try {
      const result = await getCurationSnapshotAction(artifactId);
      if (!result.success) {
        if (isUnauthorizedError(result.error)) {
          setSnapshotAuthUnavailable(true);
          setIsGenerating(false);
          if (!hasShownAuthToast.current) {
            toast.warning(
              "La sesion no esta disponible para actualizar fuentes. Recarga la pagina cuando termine el proceso.",
            );
            hasShownAuthToast.current = true;
          }
          return;
        }
        throw new Error(result.error || "Error loading curation");
      }

      setSnapshotAuthUnavailable(false);
      hasShownAuthToast.current = false;
      const curData = result.curation || null;
      setCuration(curData);
      setLessonRequirements(result.lessonRequirements || []);
      setConfiguredPrompt(result.prompt?.content || "");

      if (curData) {
        setRows(result.rows || []);

        const isGen = CURATION_RUNNING_STATES.has(curData.state);
        setIsGenerating(isGen);
      } else {
        setRows([]);
        setIsGenerating(false);
      }
    } catch (error) {
      if (isUnauthorizedError(error)) {
        setSnapshotAuthUnavailable(true);
        setIsGenerating(false);
        if (!hasShownAuthToast.current) {
          toast.warning(
            "La sesion no esta disponible para actualizar fuentes. Recarga la pagina cuando termine el proceso.",
          );
          hasShownAuthToast.current = true;
        }
        return;
      }
      console.error("Error in useCuration fetch:", error);
      toast.error("Error cargando datos de curaduria");
    } finally {
      setLoading(false);
    }
  }, [artifactId]);

  usePolling(
    fetchCurationData,
    Boolean(
      curation?.id &&
      (isGenerating || isValidating) &&
      !snapshotAuthUnavailable,
    ),
    {
      intervalMs: 3000,
    },
  );

  usePolling(
    fetchCurationData,
    !isGenerating &&
      rows.length === 0 &&
      curation?.state !== CURATION_STATES.READY_FOR_QA &&
      !snapshotAuthUnavailable,
    { intervalMs: 5000 },
  );

  usePolling(
    fetchCurationData,
    curation?.state === CURATION_STATES.READY_FOR_QA &&
      !snapshotAuthUnavailable,
    { intervalMs: 5000 },
  );

  useEffect(() => {
    fetchCurationData();
  }, [artifactId, fetchCurationData]);

  const startCuration = async (
    attemptNumber: number = 1,
    gaps: string[] = [],
    resume: boolean = false,
    promptOverride?: string,
  ) => {
    if (startInFlight.current || isGenerating) return;
    startInFlight.current = true;
    setIsGenerating(true);
    try {
      const result = await startCurationAction(
        artifactId,
        attemptNumber,
        gaps,
        resume,
        promptOverride,
      );

      if (!result.success) {
        throw new Error(result.error || "No se pudo iniciar la curaduría.");
      }
      toast.success(
        resume
          ? "Completando fuentes pendientes; se conserva el progreso."
          : "Curaduria iniciada. Las fuentes comenzaran a aparecer pronto.",
      );
      await fetchCurationData();
    } catch (error) {
      setIsGenerating(false);
      toast.error(
        "Error al iniciar curaduria: " +
          (error instanceof Error ? error.message : "No se pudo iniciar la curaduría."),
      );
    } finally {
      startInFlight.current = false;
    }
  };

  const clearSystemGeneratedRows = async () => {
    setRows((current) =>
      current.filter((row) => !isSystemGeneratedCurationRow(row)),
    );

    const result = await clearSystemGeneratedCurationRowsAction(artifactId);
    if (!result.success) {
      toast.error("Error al limpiar fuentes generadas");
      fetchCurationData();
    } else {
      toast.success("Fuentes generadas eliminadas");
    }
  };

  const clearInvalidRows = async () => {
    const result = await clearInvalidCurationRowsAction(artifactId);
    if (!result.success) {
      toast.error(result.error || "Error al limpiar fuentes no aptas");
      await fetchCurationData();
      return false;
    }
    if ((result.deleted || 0) > 0) {
      toast.success(`${result.deleted} fuente(s) no aptas eliminadas`);
    }
    await fetchCurationData();
    return true;
  };

  return {
    curation,
    rows,
    lessonRequirements,
    configuredPrompt,
    loading,
    isGenerating,
    isValidating,
    startCuration,
    clearSystemGeneratedRows,
    clearInvalidRows,
    refresh: fetchCurationData,
  };
}
