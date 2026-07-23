import { useState, useEffect, useCallback, useRef } from "react";
import { Curation, CurationRow } from "../types/curation.types";
import {
  getCurationSnapshotAction,
  startCurationAction,
  updateCurationRowAction,
  deleteCurationRowAction,
  clearSystemGeneratedCurationRowsAction,
  addManualCurationUrlAction,
  registerManualCurationPdfAction,
  validateCurationRowAction,
  initializeManualCurationAction,
  clearInvalidCurationRowsAction,
} from "../actions/curation.actions";
import { toast } from "sonner";
import { CURATION_RUNNING_STATES, CURATION_STATES } from "@/lib/pipeline-constants";
import { usePolling } from "@/shared/hooks/usePolling";
import { isSystemGeneratedCurationRow } from "../lib/curation-row-rules";
import { uploadWithSignedUrl } from "@/lib/storage-upload";

interface ManualSourceLesson {
  lessonId: string;
  lessonTitle: string;
}

function isUnauthorizedError(error: unknown) {
  if (typeof error === "string") return error === "Unauthorized";
  if (error instanceof Error) return error.message === "Unauthorized";
  return false;
}

export function useCuration(artifactId: string) {
  const [curation, setCuration] = useState<Curation | null>(null);
  const [rows, setRows] = useState<CurationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [snapshotAuthUnavailable, setSnapshotAuthUnavailable] = useState(false);
  const hasShownAuthToast = useRef(false);
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
    Boolean(curation?.id && (isGenerating || isValidating) && !snapshotAuthUnavailable),
    {
      intervalMs: 3000,
    },
  );

  usePolling(fetchCurationData, !isGenerating && rows.length === 0 && !snapshotAuthUnavailable, {
    intervalMs: 5000,
  });

  useEffect(() => {
    fetchCurationData();
  }, [artifactId, fetchCurationData]);

  const startCuration = async (
    attemptNumber: number = 1,
    gaps: string[] = [],
    resume: boolean = false,
  ) => {
    setIsGenerating(true);
    const result = await startCurationAction(
      artifactId,
      attemptNumber,
      gaps,
      resume,
    );

    if (result.success) {
      toast.success(
        resume
          ? "Reanudando curaduria..."
          : "Curaduria iniciada. Las fuentes comenzaran a aparecer pronto.",
      );
      fetchCurationData();
    } else {
      setIsGenerating(false);
      toast.error("Error al iniciar curaduria: " + result.error);
    }
  };

  const updateRow = async (rowId: string, updates: Partial<CurationRow>) => {
    setRows((current) =>
      current.map((r) => (r.id === rowId ? { ...r, ...updates } : r)),
    );

    const result = await updateCurationRowAction(rowId, updates);

    if (!result.success) {
      toast.error("Error al actualizar fila");
      fetchCurationData();
    }
  };

  const deleteRow = async (rowId: string) => {
    setRows((current) => current.filter((r) => r.id !== rowId));

    const result = await deleteCurationRowAction(rowId);
    if (!result.success) {
      toast.error("Error al eliminar fila");
      fetchCurationData();
    } else {
      toast.success("Fuente eliminada");
    }
  };

  const clearSystemGeneratedRows = async () => {
    setRows((current) => current.filter((row) => !isSystemGeneratedCurationRow(row)));

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

  const addManualUrl = async (lesson: ManualSourceLesson, url: string) => {
    const result = await addManualCurationUrlAction(artifactId, lesson, url);
    if (!result.success) {
      toast.error(result.error || "No se pudo agregar la URL");
      return false;
    }
    toast.success(
      result.validation?.status === "valid"
        ? "URL agregada y validada"
        : "URL agregada; requiere revision",
    );
    await fetchCurationData();
    return true;
  };

  const addManualPdf = async (lesson: ManualSourceLesson, file: File) => {
    if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Selecciona un archivo PDF valido");
      return false;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error("El PDF no puede superar 25 MB");
      return false;
    }
    const safeName = file.name
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const upload = await uploadWithSignedUrl(
      "curation-sources",
      `curation-sources/${artifactId}/${crypto.randomUUID()}-${safeName}`,
      file,
      {
        artifactId,
        purpose: "curation-source-pdf",
        contentType: "application/pdf",
        fileSizeBytes: file.size,
        upsert: false,
      },
    );
    const result = await registerManualCurationPdfAction(artifactId, lesson, {
      storagePath: upload.path,
      fileName: file.name,
      mimeType: "application/pdf",
      fileSizeBytes: file.size,
    });
    if (!result.success) {
      toast.error(result.error || "No se pudo registrar el PDF");
      return false;
    }
    toast.success(
      result.validation?.status === "valid"
        ? "PDF agregado y validado"
        : "PDF agregado; revisa su estado",
    );
    await fetchCurationData();
    return true;
  };

  const validateRow = async (rowId: string) => {
    const result = await validateCurationRowAction(rowId);
    if (!result.success) {
      toast.error(result.error || "No se pudo revalidar la fuente");
      return false;
    }
    toast.success("Fuente revalidada");
    await fetchCurationData();
    return true;
  };

  const initializeManualCuration = async () => {
    const result = await initializeManualCurationAction(artifactId);
    if (!result.success) {
      toast.error(result.error || "No se pudo iniciar la curaduria manual");
      return false;
    }
    await fetchCurationData();
    return true;
  };

  return {
    curation,
    rows,
    loading,
    isGenerating,
    isValidating,
    startCuration,
    updateRow,
    deleteRow,
    clearSystemGeneratedRows,
    clearInvalidRows,
    addManualUrl,
    addManualPdf,
    validateRow,
    initializeManualCuration,
    refresh: fetchCurationData,
  };
}
