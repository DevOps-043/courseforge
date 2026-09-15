"use client";

import type { ReactNode } from "react";
import { BookOpen, PlayCircle, RefreshCw } from "lucide-react";
import {
  CurationDashboard,
  type CurationLessonOption,
} from "./CurationDashboard";
import { CurationReviewPanel } from "./CurationReviewPanel";
import type { CurationRow } from "../types/curation.types";
import { UpstreamChangeAlert } from "@/shared/components/UpstreamChangeAlert";
import { CURATION_STATES } from "@/lib/pipeline-constants";
import {
  ConfirmationModal,
  type ModalVariant,
} from "../../../shared/components/ConfirmationModal";

export interface CurationModalConfig {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  variant: ModalVariant;
  confirmText?: string;
  hideActions?: boolean;
  onConfirm: () => Promise<void> | void;
}

interface CurationDashboardViewProps {
  curationApproved: boolean;
  curationBlocked: boolean;
  curationState?: string | null;
  isGenerating: boolean;
  isLoadingModal: boolean;
  isValidating: boolean;
  invalidRowsCount: number;
  modalConfig: CurationModalConfig;
  onContinue?: () => Promise<void> | void;
  onDismissDirty: () => Promise<void> | void;
  onIterateDirty: () => Promise<void> | void;
  onModalClose: () => void;
  onRegenerate: () => Promise<void> | void;
  onResetStep: () => void;
  onResume: () => Promise<void> | void;
  pendingValidationCount: number;
  missingCoverageCount: number;
  completedLessonsCount: number;
  coveredRequiredSources: number;
  lessons: CurationLessonOption[];
  rows: CurationRow[];
  upstreamDirty: boolean;
  upstreamDirtySource?: string | null;
  requiredSourcesCount: number;
  totalLessonsCount: number;
}

export function CurationDashboardView({
  curationApproved,
  curationBlocked,
  curationState,
  isGenerating,
  isLoadingModal,
  isValidating,
  invalidRowsCount,
  modalConfig,
  onContinue,
  onDismissDirty,
  onIterateDirty,
  onModalClose,
  onRegenerate,
  onResetStep,
  onResume,
  pendingValidationCount,
  missingCoverageCount,
  completedLessonsCount,
  coveredRequiredSources,
  lessons,
  rows,
  upstreamDirty,
  upstreamDirtySource,
  requiredSourcesCount,
  totalLessonsCount,
}: CurationDashboardViewProps) {
  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in duration-500">
      <div className="space-y-2 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gray-50 dark:bg-[#0A0D12] border border-gray-200 dark:border-[var(--engine-surface-hover)] text-[var(--engine-accent)]">
              <BookOpen size={24} />
            </div>
            Paso 4: Curaduria de Fuentes
          </h2>
          <p className="text-gray-500 dark:text-[var(--engine-muted)] text-base ml-12">
            Fuentes de calidad encontradas para cada leccion.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onResetStep}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-[var(--engine-surface-hover)] text-gray-500 dark:text-[var(--engine-muted)] text-xs hover:border-gray-400 dark:hover:border-[var(--engine-muted)] hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-[var(--engine-surface-hover)] transition-colors flex items-center gap-2"
          >
            <RefreshCw size={14} />
            Reiniciar este paso
          </button>

          {curationState === CURATION_STATES.PAUSED && (
            <button
              onClick={onResume}
              className="px-3 py-1.5 rounded-lg bg-[var(--engine-accent)]/10 text-[var(--engine-accent)] border border-[var(--engine-accent)]/20 hover:bg-[var(--engine-accent)]/20 transition-colors flex items-center gap-2 font-bold animate-pulse"
            >
              <PlayCircle size={14} />
              Reanudar Generacion
            </button>
          )}
        </div>
      </div>

      <CurationDashboard
        rows={rows}
        isGenerating={isGenerating}
        lessons={lessons}
      />

      {upstreamDirty && (
        <UpstreamChangeAlert
          source={upstreamDirtySource || "un paso anterior"}
          onIterate={onIterateDirty}
          onDismiss={onDismissDirty}
          isIterating={isGenerating}
        />
      )}

      <CurationReviewPanel
        curationApproved={curationApproved}
        curationBlocked={curationBlocked}
        isGenerating={isGenerating}
        isValidating={isValidating}
        invalidRowsCount={invalidRowsCount}
        onContinue={onContinue}
        onRegenerate={onRegenerate}
        pendingValidationCount={pendingValidationCount}
        missingCoverageCount={missingCoverageCount}
        completedLessonsCount={completedLessonsCount}
        coveredRequiredSources={coveredRequiredSources}
        requiredSourcesCount={requiredSourcesCount}
        totalLessonsCount={totalLessonsCount}
      />

      <ConfirmationModal
        isOpen={modalConfig.isOpen}
        onClose={onModalClose}
        onConfirm={modalConfig.onConfirm}
        title={modalConfig.title}
        message={modalConfig.message}
        variant={modalConfig.variant}
        confirmText={modalConfig.confirmText}
        isLoading={isLoadingModal}
        hideActions={modalConfig.hideActions}
      />
    </div>
  );
}
