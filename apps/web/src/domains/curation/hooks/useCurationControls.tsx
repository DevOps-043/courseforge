"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { updateCurationStatusAction } from "../actions/curation.actions";
import type { Curation, CurationRow } from "../types/curation.types";
import type { CurationModalConfig } from "../components/CurationDashboardView";
import { CurationResetOptions } from "../components/CurationResetOptions";
import { CURATION_STATES } from "@/lib/pipeline-constants";

interface UseCurationControlsParams {
  artifactId: string;
  curation: Curation | null;
  isGenerating: boolean;
  refresh: () => Promise<void>;
  rows: CurationRow[];
  startCuration: (
    attemptNumber?: number,
    gaps?: string[],
    resume?: boolean,
    promptOverride?: string,
  ) => Promise<void>;
  clearSystemGeneratedRows: () => Promise<void>;
}

const INITIAL_MODAL_CONFIG: CurationModalConfig = {
  isOpen: false,
  title: "",
  message: null,
  variant: "info",
  hideActions: false,
  onConfirm: () => {},
};

export function useCurationControls({
  artifactId,
  curation,
  isGenerating,
  refresh,
  rows,
  startCuration,
  clearSystemGeneratedRows,
}: UseCurationControlsParams) {
  const router = useRouter();
  const [isLoadingModal, setIsLoadingModal] = useState(false);
  const [modalConfig, setModalConfig] =
    useState<CurationModalConfig>(INITIAL_MODAL_CONFIG);
  const [progress, setProgress] = useState(5);

  const closeModal = () =>
    setModalConfig((previous) => ({ ...previous, isOpen: false }));

  useEffect(() => {
    if (!isGenerating && rows.length > 0) {
      setProgress(100);
      return;
    }

    if (rows.length > 0) {
      const calculated = Math.min(Math.round((rows.length / 25) * 100), 95);
      setProgress((previousProgress) => Math.max(previousProgress, calculated));
    }
  }, [rows.length, isGenerating]);

  const handleGenerate = async (promptOverride?: string) => {
    setProgress(5);
    await startCuration(1, [], false, promptOverride);
  };

  const handleResetStep = () => {
    setModalConfig({
      isOpen: true,
      title: "Reiniciar Paso 4",
      message: (
        <CurationResetOptions
          onClearCurrentData={async () => {
            setIsLoadingModal(true);
            await clearSystemGeneratedRows();
            setIsLoadingModal(false);
            closeModal();
          }}
          onRestartAutomaticSearch={async () => {
            setIsLoadingModal(true);
            await clearSystemGeneratedRows();
            await handleGenerate();
            setIsLoadingModal(false);
            closeModal();
          }}
        />
      ),
      variant: "info",
      hideActions: true,
      onConfirm: closeModal,
    });
  };

  const handlePause = () => {
    setModalConfig({
      isOpen: true,
      title: "Pausar Curaduria",
      message:
        "El proceso se pausara despues de completar el lote actual. Podras reanudarlo mas tarde sin perder progreso.",
      variant: "warning",
      confirmText: "Pausar Proceso",
      onConfirm: async () => {
        setIsLoadingModal(true);
        toast.info("Solicitando pausa...");
        const result = await updateCurationStatusAction(
          artifactId,
          CURATION_STATES.PAUSED_REQUESTED,
        );
        if (!result.success) {
          toast.error(result.error || "No se pudo pausar la curaduria.");
        }
        await refresh();
        setIsLoadingModal(false);
        closeModal();
      },
    });
  };

  const handleStop = () => {
    if (curation?.state === CURATION_STATES.STOPPED_REQUESTED) {
      setModalConfig({
        isOpen: true,
        title: "Forzar detencion?",
        message: (
          <div className="space-y-2">
            <p>El proceso parece estar tardando en detenerse.</p>
            <p className="text-sm font-light opacity-80">
              Esto actualizara forzosamente el estado en la interfaz a
              "Detenido". Si el proceso de fondo sigue activo, podria intentar
              escribir mas resultados.
            </p>
          </div>
        ),
        variant: "critical",
        confirmText: "Si, Forzar Detencion",
        onConfirm: async () => {
          setIsLoadingModal(true);
          const result = await updateCurationStatusAction(
            artifactId,
            CURATION_STATES.STOPPED,
          );
          if (!result.success) {
            toast.error(result.error || "No se pudo detener la curaduria.");
          }
          await refresh();
          setIsLoadingModal(false);
          closeModal();
        },
      });
      return;
    }

    setModalConfig({
      isOpen: true,
      title: "Detener Curaduria",
      message: (
        <div className="space-y-2">
          <p>Seguro que deseas detener el proceso completamente?</p>
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-200 text-sm">
            <AlertCircle size={14} className="inline mr-2" />
            Esta accion detendra la busqueda de fuentes permanentemente para
            esta sesion.
          </div>
        </div>
      ),
      variant: "danger",
      confirmText: "Detener Definitivamente",
      onConfirm: async () => {
        setIsLoadingModal(true);
        toast.info("Deteniendo proceso...");
        const result = await updateCurationStatusAction(
          artifactId,
          CURATION_STATES.STOPPED_REQUESTED,
        );
        if (!result.success) {
          toast.error(result.error || "No se pudo detener la curaduria.");
        }
        await refresh();
        setIsLoadingModal(false);
        closeModal();
      },
    });
  };

  const handleResume = async () => {
    await startCuration(1, [], true);
  };

  const handleRegenerateBlocked = async () => {
    if (
      !confirm("¿Reiniciar por completo la busqueda automatica de fuentes web?")
    ) {
      return;
    }

    try {
      await clearSystemGeneratedRows();
      await startCuration(1, []);
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error("No se pudo regenerar la curaduria.");
    }
  };

  return {
    closeModal,
    handleGenerate,
    handlePause,
    handleRegenerateBlocked,
    handleResetStep,
    handleResume,
    handleStop,
    isLoadingModal,
    modalConfig,
    progress,
  };
}
