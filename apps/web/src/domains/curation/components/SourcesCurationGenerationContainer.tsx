import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useCuration } from "../hooks/useCuration";
import { CurationDashboardView } from "./CurationDashboardView";
import { CurationGenerationView } from "./CurationGenerationView";
import { CurationSetupView } from "./CurationSetupView";
import { ConfirmationModal } from "../../../shared/components/ConfirmationModal";
import {
  isCurationApprovedFromRecord,
  isCurationBlockedFromRecord,
} from "@/lib/artifact-workflow";
import { dismissUpstreamDirtyAction } from "@/lib/server/pipeline-dirty-actions";
import {
  CURATION_RUNNING_STATES,
  CURATION_STATES,
  REVIEWER_ROLE_SET,
} from "@/lib/pipeline-constants";
import { useCurationValidation } from "../hooks/useCurationValidation";
import { useCurationControls } from "../hooks/useCurationControls";

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
    isValidating: isValidatingFromDb,
    startCuration,
    updateRow,
    deleteRow,
    clearGPTRows,
    refresh,
  } = useCuration(artifactId);
  const router = useRouter();
  const canReview = REVIEWER_ROLE_SET.has(profile?.platform_role ?? "");
  const curationApproved = isCurationApprovedFromRecord(curation);
  const curationBlocked = isCurationBlockedFromRecord(curation);
  const lastKnownCurationStateRef = useRef<string | null>(null);
  const {
    handleValidate,
    isHydrated,
    isValidating,
    pendingValidationCount,
    validatedCount,
  } = useCurationValidation({
    artifactId,
    curationState: curation?.state,
    rows,
    refresh,
  });
  const {
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
  } = useCurationControls({
    artifactId,
    courseId,
    curation,
    ideaCentral,
    isGenerating,
    isValidating,
    pendingValidationCount,
    refresh,
    rows,
    startCuration,
    clearGPTRows,
    temario,
  });

  useEffect(() => {
    if (!curation?.state) return;

    const previousState = lastKnownCurationStateRef.current;
    const isTerminalState =
      !CURATION_RUNNING_STATES.has(curation.state) &&
      curation.state !== CURATION_STATES.VALIDATING;

    if (previousState && previousState !== curation.state && isTerminalState) {
      router.refresh();
    }

    lastKnownCurationStateRef.current = curation.state;
  }, [curation?.state, router]);

  const showGeneratingView = isGenerating;
  const showDashboard = !isGenerating && rows.length > 0;

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
        isValidating={isValidating || isValidatingFromDb}
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
        pendingValidationCount={pendingValidationCount}
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
