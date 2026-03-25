import { useState, useEffect, useCallback } from "react";
import { Curation, CurationRow } from "../types/curation.types";
import {
  startCurationAction,
  updateCurationRowAction,
  deleteCurationRowAction,
  clearGPTCurationRowsAction,
  getCurationSnapshotAction,
} from "@/app/admin/artifacts/actions";
import { toast } from "sonner";

export function useCuration(artifactId: string) {
  const [curation, setCuration] = useState<Curation | null>(null);
  const [rows, setRows] = useState<CurationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  const fetchCurationData = useCallback(async () => {
    try {
      const result = await getCurationSnapshotAction(artifactId);
      if (!result.success) {
        throw new Error(result.error || "Error loading curation");
      }

      const curData = result.curation || null;
      setCuration(curData);

      if (curData) {
        setRows(result.rows || []);

        const isGen =
          curData.state === "PHASE2_GENERATING" ||
          curData.state === "PAUSED_REQUESTED" ||
          curData.state === "STOPPED_REQUESTED";
        setIsGenerating(isGen);
      } else {
        setRows([]);
        setIsGenerating(false);
      }
    } catch (error) {
      console.error("Error in useCuration fetch:", error);
      toast.error("Error cargando datos de curaduria");
    } finally {
      setLoading(false);
    }
  }, [artifactId]);

  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (isGenerating && curation?.id) {
      interval = setInterval(async () => {
        await fetchCurationData();
      }, 3000);
    } else if (!isGenerating && rows.length === 0) {
      interval = setInterval(async () => {
        await fetchCurationData();
      }, 5000);
    }

    return () => clearInterval(interval);
  }, [isGenerating, curation?.id, rows.length, fetchCurationData]);

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

  const clearGPTRows = async () => {
    setRows((current) =>
      current.filter((r) => r.source_rationale !== "GPT_GENERATED"),
    );

    const result = await clearGPTCurationRowsAction(artifactId);
    if (!result.success) {
      toast.error("Error al limpiar fuentes GPT");
      fetchCurationData();
    } else {
      toast.success("Fuentes GPT eliminadas");
    }
  };

  return {
    curation,
    rows,
    loading,
    isGenerating,
    startCuration,
    updateRow,
    deleteRow,
    clearGPTRows,
    refresh: fetchCurationData,
  };
}
