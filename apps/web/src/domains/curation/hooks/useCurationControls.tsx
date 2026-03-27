"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import {
  deleteCurationAction,
  importCurationJsonAction,
  updateCurationStatusAction,
} from "../actions/curation.actions";
import type { Curation, CurationRow } from "../types/curation.types";
import type { CurationModalConfig } from "../components/CurationDashboardView";
import { CurationResetOptions } from "../components/CurationResetOptions";
import { CURATION_STATES } from "@/lib/pipeline-constants";
import { buildGPTContext, GPT_URL, parseCurationJsonPreview } from "../lib/curation-ui";

interface SyllabusLesson {
  id?: string;
  title: string;
  objective_specific: string;
}

interface SyllabusModule {
  id?: string;
  title: string;
  objective_general_ref: string;
  lessons: SyllabusLesson[];
}

interface UseCurationControlsParams {
  artifactId: string;
  courseId?: string;
  curation: Curation | null;
  ideaCentral?: string;
  isGenerating: boolean;
  refresh: () => Promise<void>;
  rows: CurationRow[];
  startCuration: (
    attemptNumber?: number,
    gaps?: string[],
    resume?: boolean,
  ) => Promise<void>;
  clearGPTRows: () => Promise<void>;
  setIsValidating: (value: boolean) => void;
  temario?: SyllabusModule[];
}

const INITIAL_MODAL_CONFIG: CurationModalConfig = {
  isOpen: false,
  title: "",
  message: null,
  variant: "info",
  onConfirm: () => {},
};

export function useCurationControls({
  artifactId,
  courseId,
  curation,
  ideaCentral,
  isGenerating,
  refresh,
  rows,
  startCuration,
  clearGPTRows,
  setIsValidating,
  temario,
}: UseCurationControlsParams) {
  const router = useRouter();
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);
  const [isLoadingModal, setIsLoadingModal] = useState(false);
  const [isProcessingJson, setIsProcessingJson] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonInput, setJsonInput] = useState("");
  const [jsonPreview, setJsonPreview] = useState<{
    count: number;
    lessons: string[];
  } | null>(null);
  const [modalConfig, setModalConfig] =
    useState<CurationModalConfig>(INITIAL_MODAL_CONFIG);
  const [progress, setProgress] = useState(5);
  const [reviewNotes, setReviewNotes] = useState("");
  const [showAutomaticFlow, setShowAutomaticFlow] = useState(false);
  const [showJsonImport, setShowJsonImport] = useState(false);

  const closeModal = () =>
    setModalConfig((previous) => ({ ...previous, isOpen: false }));

  useEffect(() => {
    if (curation?.qa_decision?.notes) {
      setReviewNotes(curation.qa_decision.notes);
    }
  }, [curation]);

  useEffect(() => {
    if (!isGenerating && rows.length > 0) {
      setProgress(100);
      return;
    }

    if (rows.length > 0) {
      const calculated = Math.min(Math.round((rows.length / 25) * 100), 95);
      setProgress((previousProgress) =>
        Math.max(previousProgress, calculated),
      );
    }
  }, [rows.length, isGenerating]);

  const handleGenerate = async () => {
    setProgress(5);
    await startCuration(1, []);
  };

  const handleResetStep = () => {
    setModalConfig({
      isOpen: true,
      title: "Reiniciar Paso 4",
      message: (
        <CurationResetOptions
          onClearCurrentData={async () => {
            setIsLoadingModal(true);
            await clearGPTRows();
            setIsLoadingModal(false);
            closeModal();
          }}
          onRestartAutomaticSearch={async () => {
            setIsLoadingModal(true);
            await handleGenerate();
            setIsLoadingModal(false);
            closeModal();
          }}
        />
      ),
      variant: "info",
      confirmText: "Cancelar",
      onConfirm: closeModal,
    });
  };

  const handleOpenGPT = async () => {
    const context = buildGPTContext({
      artifactId,
      courseId,
      ideaCentral,
      temario,
    });

    try {
      await navigator.clipboard.writeText(context);
      setCopiedToClipboard(true);
      toast.success("Contexto copiado al portapapeles. Pegalo en ChatGPT.");
      setTimeout(() => setCopiedToClipboard(false), 3000);
      window.open(GPT_URL, "_blank");
    } catch (error) {
      console.error("Clipboard error:", error);
      toast.error("No se pudo copiar. Copia el contexto manualmente.");
    }
  };

  const handleJsonInputChange = (value: string) => {
    setJsonInput(value);
    const { error, preview } = parseCurationJsonPreview(value);
    setJsonError(error);
    setJsonPreview(preview);
  };

  const handleImportJson = async () => {
    if (!jsonInput.trim() || isProcessingJson) {
      return;
    }

    setIsProcessingJson(true);
    setJsonError(null);

    try {
      const result = await importCurationJsonAction(artifactId, jsonInput);

      if (!result.success) {
        const errorMessage = result.error || "Error importando fuentes";
        setJsonError(errorMessage);
        toast.error(errorMessage);
        return;
      }

      toast.success(result.message || "Fuentes importadas exitosamente");
      setJsonInput("");
      setJsonPreview(null);
      setShowJsonImport(false);
      await refresh();
      router.refresh();
    } catch (error) {
      console.error("Import error:", error);
      setJsonError("Error inesperado");
      toast.error("Error inesperado al importar");
    } finally {
      setIsProcessingJson(false);
    }
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
        await updateCurationStatusAction(
          artifactId,
          CURATION_STATES.PAUSED_REQUESTED,
        );
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
          await updateCurationStatusAction(artifactId, CURATION_STATES.STOPPED);
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
        await updateCurationStatusAction(
          artifactId,
          CURATION_STATES.STOPPED_REQUESTED,
        );
        await refresh();
        setIsLoadingModal(false);
        closeModal();
      },
    });
  };

  const handleResume = async () => {
    await startCuration(1, [], true);
  };

  const handleApprove = async () => {
    await updateCurationStatusAction(
      artifactId,
      CURATION_STATES.APPROVED,
      reviewNotes,
    );
    toast.success("Fase 4 aprobada exitosamente");
    await refresh();
    router.refresh();
  };

  const handleReject = async () => {
    await updateCurationStatusAction(
      artifactId,
      CURATION_STATES.BLOCKED,
      reviewNotes,
    );
    toast.info("Fase 4 rechazada");
    await refresh();
    router.refresh();
  };

  const handleRegenerateBlocked = async () => {
    if (
      !confirm(
        "Estas seguro de que quieres regenerar? Esto eliminara la curaduria actual.",
      )
    ) {
      return;
    }

    try {
      await deleteCurationAction(artifactId);
      setIsValidating(false);
      setReviewNotes("");
      await refresh();
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error("No se pudo regenerar la curaduria.");
    }
  };

  return {
    closeModal,
    copiedToClipboard,
    handleApprove,
    handleGenerate,
    handleImportJson,
    handleJsonInputChange,
    handleOpenGPT,
    handlePause,
    handleReject,
    handleRegenerateBlocked,
    handleResetStep,
    handleResume,
    handleStop,
    isLoadingModal,
    isProcessingJson,
    jsonError,
    jsonInput,
    jsonPreview,
    modalConfig,
    progress,
    reviewNotes,
    setReviewNotes,
    setShowAutomaticFlow,
    setShowJsonImport,
    showAutomaticFlow,
    showJsonImport,
  };
}
