import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useCuration } from "../hooks/useCuration";
import {
  deleteCurationAction,
  importCurationJsonAction,
  updateCurationStatusAction,
} from "../actions/curation.actions";
import { CurationDashboardView } from "./CurationDashboardView";
import type { CurationModalConfig } from "./CurationDashboardView";
import { CurationGenerationView } from "./CurationGenerationView";
import { CurationSetupView } from "./CurationSetupView";
import { CurationResetOptions } from "./CurationResetOptions";
import { ConfirmationModal } from "../../../shared/components/ConfirmationModal";
import {
  isCurationApproved,
  isCurationBlocked,
} from "@/lib/artifact-workflow";
import { dismissUpstreamDirtyAction } from "@/lib/server/pipeline-dirty-actions";
import {
  CURATION_RUNNING_STATES,
  CURATION_STATES,
  REVIEWER_ROLE_SET,
} from "@/lib/pipeline-constants";
import {
  buildGPTContext,
  GPT_URL,
  parseCurationJsonPreview,
} from "../lib/curation-ui";
import { useCurationValidation } from "../hooks/useCurationValidation";

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

interface SourcesCurationGenerationContainerProps {
  artifactId: string;
  courseId?: string;
  temario?: SyllabusModule[];
  ideaCentral?: string;
  profile?: {
    platform_role?: string | null;
  } | null;
  onNext?: () => void;
}

export function SourcesCurationGenerationContainer({
  artifactId,
  courseId,
  temario,
  ideaCentral,
  profile,
  onNext,
}: SourcesCurationGenerationContainerProps) {
  const {
    curation,
    rows,
    isGenerating,
    startCuration,
    updateRow,
    deleteRow,
    clearGPTRows,
    refresh,
  } = useCuration(artifactId);
  const router = useRouter();
  const canReview = REVIEWER_ROLE_SET.has(profile?.platform_role ?? "");
  const curationApproved = isCurationApproved(curation);
  const curationBlocked = isCurationBlocked(curation);
  const [showAutomaticFlow, setShowAutomaticFlow] = useState(false);
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);
  const [showJsonImport, setShowJsonImport] = useState(false);
  const [jsonInput, setJsonInput] = useState("");
  const [isProcessingJson, setIsProcessingJson] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonPreview, setJsonPreview] = useState<{
    count: number;
    lessons: string[];
  } | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [isLoadingModal, setIsLoadingModal] = useState(false);
  const [modalConfig, setModalConfig] = useState<CurationModalConfig>({
    isOpen: false,
    title: "",
    message: null,
    variant: "info",
    onConfirm: () => {},
  });
  const lastKnownCurationStateRef = useRef<string | null>(null);
  const {
    handleValidate,
    isHydrated,
    isValidating,
    setIsValidating,
    validatedCount,
  } = useCurationValidation({
    artifactId,
    rows,
    refresh,
  });
  const [progress, setProgress] = useState(5);

  useEffect(() => {
    if (curation?.qa_decision?.notes) {
      setReviewNotes(curation.qa_decision.notes);
    }
  }, [curation]);

  useEffect(() => {
    if (!curation?.state) return;

    const previousState = lastKnownCurationStateRef.current;
    const isTerminalState = !CURATION_RUNNING_STATES.has(curation.state);

    if (previousState && previousState !== curation.state && isTerminalState) {
      router.refresh();
    }

    lastKnownCurationStateRef.current = curation.state;
  }, [curation?.state, router]);

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

  const showGeneratingView = isGenerating;
  const showDashboard = !isGenerating && rows.length > 0;
  const closeModal = () =>
    setModalConfig((previous) => ({ ...previous, isOpen: false }));

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
    if (!jsonInput.trim() || isProcessingJson) return;

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

  if (!isHydrated) {
    return (
      <div className="max-w-4xl mx-auto flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={32} className="text-[#00D4B3] animate-spin" />
          <span className="text-[#6C757D] text-sm">Cargando...</span>
        </div>
      </div>
    );
  }

  if (showGeneratingView) {
    return (
      <>
        <CurationGenerationView
          curationState={curation?.state}
          progress={progress}
          rowsCount={rows.length}
          onPause={handlePause}
          onRefresh={refresh}
          onStop={handleStop}
        />
        <ConfirmationModal
          isOpen={modalConfig.isOpen}
          onClose={closeModal}
          onConfirm={modalConfig.onConfirm}
          title={modalConfig.title}
          message={modalConfig.message}
          variant={modalConfig.variant}
          confirmText={modalConfig.confirmText}
          isLoading={isLoadingModal}
        />
      </>
    );
  }

  if (showDashboard) {
    return (
      <CurationDashboardView
        canReview={canReview}
        curationApproved={curationApproved}
        curationBlocked={curationBlocked}
        curationState={curation?.state}
        deleteRow={deleteRow}
        isGenerating={isGenerating}
        isLoadingModal={isLoadingModal}
        isValidating={isValidating}
        modalConfig={modalConfig}
        onApprove={handleApprove}
        onContinue={onNext}
        onDismissDirty={async () => {
          await dismissUpstreamDirtyAction("curation", artifactId);
          await refresh();
          router.refresh();
        }}
        onIterateDirty={async () => {
          await handleGenerate();
          await dismissUpstreamDirtyAction("curation", artifactId);
        }}
        onModalClose={closeModal}
        onRegenerate={handleRegenerateBlocked}
        onReject={handleReject}
        onResetStep={handleResetStep}
        onResume={handleResume}
        onValidate={handleValidate}
        reviewNotes={reviewNotes}
        rows={rows}
        setReviewNotes={setReviewNotes}
        updateRow={updateRow}
        upstreamDirty={Boolean(curation?.upstream_dirty)}
        upstreamDirtySource={curation?.upstream_dirty_source}
        validatedCount={validatedCount}
      />
    );
  }

  return (
    <CurationSetupView
      copiedToClipboard={copiedToClipboard}
      isProcessingJson={isProcessingJson}
      jsonError={jsonError}
      jsonInput={jsonInput}
      jsonPreview={jsonPreview}
      onGenerate={handleGenerate}
      onImportJson={handleImportJson}
      onJsonInputChange={handleJsonInputChange}
      onOpenGPT={handleOpenGPT}
      onRefresh={async () => {
        toast.info("Actualizando datos...");
        await refresh();
      }}
      setShowAutomaticFlow={setShowAutomaticFlow}
      setShowJsonImport={setShowJsonImport}
      showAutomaticFlow={showAutomaticFlow}
      showJsonImport={showJsonImport}
      temario={temario}
    />
  );
}
