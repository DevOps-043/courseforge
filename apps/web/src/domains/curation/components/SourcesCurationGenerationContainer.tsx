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
} from "@/lib/pipeline-constants";
import { useCurationControls } from "../hooks/useCurationControls";
import { getCurationCoverageSummary } from "../lib/curation-coverage-summary";

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
  onNext,
}: SourcesCurationGenerationContainerProps) {
  const {
    curation,
    rows,
    lessonRequirements,
    configuredPrompt,
    loading,
    isGenerating,
    isValidating: isValidatingFromDb,
    startCuration,
    clearSystemGeneratedRows,
    clearInvalidRows,
    refresh,
  } = useCuration(artifactId);
  const router = useRouter();
  const automaticRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          (!row.origin || row.origin === "automatic") &&
          row.source_kind !== "pdf",
      ),
    [rows],
  );
  const syllabusLessons = useMemo(
    () =>
      (temario || []).flatMap((module, moduleIndex) =>
        (module.lessons || []).map((lesson, lessonIndex) => ({
          id: lesson.id || `lesson-${moduleIndex + 1}-${lessonIndex + 1}`,
          title: lesson.title,
          requiredSources: 2,
          videoTargetSeconds: 0,
        })),
      ),
    [temario],
  );
  const lessons = useMemo(
    () =>
      lessonRequirements.length > 0
        ? lessonRequirements.map((lesson) => ({
            id: lesson.lessonId,
            title: lesson.lessonTitle,
            requiredSources: lesson.requiredSources,
            videoTargetSeconds: lesson.videoTargetSeconds,
          }))
        : syllabusLessons,
    [lessonRequirements, syllabusLessons],
  );
  const coverageSummary = useMemo(
    () => getCurationCoverageSummary(lessons, automaticRows),
    [automaticRows, lessons],
  );
  const missingCoverageCount =
    coverageSummary.totalLessons - coverageSummary.completedLessons;
  const coverageComplete =
    coverageSummary.totalLessons > 0 &&
    coverageSummary.completedLessons === coverageSummary.totalLessons &&
    coverageSummary.coveredRequiredSources >= coverageSummary.requiredSources;
  const curationApproved =
    coverageComplete || isCurationApprovedFromRecord(curation);
  const curationBlocked =
    !coverageComplete && isCurationBlockedFromRecord(curation);
  const lastKnownCurationStateRef = useRef<string | null>(null);
  const isValidating = isValidatingFromDb;
  const pendingValidationCount = automaticRows.filter(
    (row) =>
      !row.auto_evaluated ||
      row.validation_report?.status === "pending" ||
      row.validation_report?.status === "review_required",
  ).length;
  const {
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
  } = useCurationControls({
    artifactId,
    curation,
    isGenerating,
    refresh,
    rows: automaticRows,
    startCuration,
    clearSystemGeneratedRows,
  });
  const invalidRowsCount = useMemo(
    () =>
      automaticRows.filter(
        (row) =>
          row.apta === false || row.validation_report?.status === "invalid",
      ).length,
    [automaticRows],
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

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <Loader2
            size={32}
            className="text-[var(--engine-accent)] animate-spin"
          />
          <span className="text-[var(--engine-muted)] text-sm">
            Cargando...
          </span>
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
          rowsCount={automaticRows.length}
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
        curationApproved={curationApproved}
        curationBlocked={curationBlocked}
        curationState={curation?.state}
        isGenerating={isGenerating}
        isLoadingModal={isLoadingModal}
        isValidating={isValidating || isValidatingFromDb}
        invalidRowsCount={invalidRowsCount}
        modalConfig={modalConfig}
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
        onResetStep={handleResetStep}
        onResume={handleResume}
        pendingValidationCount={pendingValidationCount}
        missingCoverageCount={missingCoverageCount}
        completedLessonsCount={coverageSummary.completedLessons}
        coveredRequiredSources={coverageSummary.coveredRequiredSources}
        lessons={lessons}
        rows={automaticRows}
        upstreamDirty={Boolean(curation?.upstream_dirty)}
        upstreamDirtySource={curation?.upstream_dirty_source}
        requiredSourcesCount={coverageSummary.requiredSources}
        totalLessonsCount={coverageSummary.totalLessons}
      />
    );
  }

  return (
    <CurationSetupView
      onGenerate={handleGenerate}
      configuredPrompt={configuredPrompt}
      onRefresh={async () => {
        toast.info("Actualizando datos...");
        await refresh();
      }}
      lessonRequirements={lessons}
      temario={temario}
    />
  );
}
