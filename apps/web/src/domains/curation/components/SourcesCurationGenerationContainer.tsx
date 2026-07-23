import { useEffect, useMemo, useRef } from "react";
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
  temario,
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
    clearSystemGeneratedRows,
    clearInvalidRows,
    addManualUrl,
    addManualPdf,
    validateRow,
    initializeManualCuration,
    refresh,
  } = useCuration(artifactId);
  const router = useRouter();
  const lessons = useMemo(
    () =>
      (temario || []).flatMap((module, moduleIndex) =>
        (module.lessons || []).map((lesson, lessonIndex) => ({
          id: lesson.id || `lesson-${moduleIndex + 1}-${lessonIndex + 1}`,
          title: lesson.title,
        })),
      ),
    [temario],
  );
  const normalizeLessonKey = (value: string | null | undefined) =>
    (value || "")
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
  const missingCoverageCount = useMemo(
    () =>
      lessons.filter(
        (lesson) =>
          !rows.some(
            (row) =>
              (row.lesson_id === lesson.id ||
                normalizeLessonKey(row.lesson_id) === normalizeLessonKey(lesson.id) ||
                normalizeLessonKey(row.lesson_title) === normalizeLessonKey(lesson.title)) &&
              row.apta === true &&
              (!row.validation_report?.status ||
                row.validation_report.status === "valid"),
          ),
      ).length,
    [lessons, rows],
  );
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
    handleApprove,
    handleGenerate,
    handlePause,
    handleIterateInvalidSources,
    handleReject,
    handleRegenerateBlocked,
    handleResetStep,
    handleResume,
    handleStop,
    isLoadingModal,
    modalConfig,
    progress,
    reviewNotes,
    setReviewNotes,
  } = useCurationControls({
    artifactId,
    curation,
    isGenerating,
    isValidating,
    pendingValidationCount,
    refresh,
    rows,
    startCuration,
    clearSystemGeneratedRows,
    clearInvalidRows,
  });
  const invalidRowsCount = useMemo(
    () =>
      rows.filter(
        (row) => row.apta === false || row.validation_report?.status === "invalid",
      ).length,
    [rows],
  );

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
  const showDashboard = !isGenerating && Boolean(curation);

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
          hideActions={modalConfig.hideActions}
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
        addManualUrl={addManualUrl}
        addManualPdf={addManualPdf}
        validateRow={validateRow}
        isGenerating={isGenerating}
        isLoadingModal={isLoadingModal}
        isValidating={isValidating || isValidatingFromDb}
        invalidRowsCount={invalidRowsCount}
        modalConfig={modalConfig}
        onApprove={handleApprove}
        onContinue={async () => {
          await clearInvalidRows();
          onNext?.();
        }}
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
        onIterateInvalidSources={handleIterateInvalidSources}
        onReject={handleReject}
        onResetStep={handleResetStep}
        onResume={handleResume}
        onValidate={handleValidate}
        pendingValidationCount={pendingValidationCount}
        missingCoverageCount={missingCoverageCount}
        lessons={lessons}
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
      onGenerate={handleGenerate}
      onRefresh={async () => {
        toast.info("Actualizando datos...");
        await refresh();
      }}
      onUseOwnSources={async () => {
        await initializeManualCuration();
      }}
      temario={temario}
    />
  );
}
