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
  canReview: boolean;
  curationApproved: boolean;
  curationBlocked: boolean;
  curationState?: string | null;
  isGenerating: boolean;
  isLoadingModal: boolean;
  isValidating: boolean;
  invalidRowsCount: number;
  modalConfig: CurationModalConfig;
  onApprove: () => Promise<void> | void;
  onContinue?: () => Promise<void> | void;
  onDismissDirty: () => Promise<void> | void;
  onIterateDirty: () => Promise<void> | void;
  onModalClose: () => void;
  onRegenerate: () => Promise<void> | void;
  onIterateInvalidSources: () => Promise<void> | void;
  onReject: () => Promise<void> | void;
  onResetStep: () => void;
  onResume: () => Promise<void> | void;
  onValidate: () => Promise<void> | void;
  pendingValidationCount: number;
  missingCoverageCount: number;
  lessons: CurationLessonOption[];
  reviewNotes: string;
  rows: CurationRow[];
  setReviewNotes: (value: string) => void;
  updateRow: (rowId: string, updates: Partial<CurationRow>) => Promise<void>;
  deleteRow: (rowId: string) => Promise<void>;
  addManualUrl: (
    lesson: { lessonId: string; lessonTitle: string },
    url: string,
  ) => Promise<boolean>;
  addManualPdf: (
    lesson: { lessonId: string; lessonTitle: string },
    file: File,
  ) => Promise<boolean>;
  validateRow: (rowId: string) => Promise<boolean>;
  upstreamDirty: boolean;
  upstreamDirtySource?: string | null;
  validatedCount: number;
}

export function CurationDashboardView({
  canReview,
  curationApproved,
  curationBlocked,
  curationState,
  deleteRow,
  isGenerating,
  isLoadingModal,
  isValidating,
  invalidRowsCount,
  modalConfig,
  onApprove,
  onContinue,
  onDismissDirty,
  onIterateDirty,
  onModalClose,
  onRegenerate,
  onIterateInvalidSources,
  onReject,
  onResetStep,
  onResume,
  onValidate,
  pendingValidationCount,
  missingCoverageCount,
  lessons,
  reviewNotes,
  rows,
  setReviewNotes,
  updateRow,
  upstreamDirty,
  upstreamDirtySource,
  validatedCount,
  addManualUrl,
  addManualPdf,
  validateRow,
}: CurationDashboardViewProps) {
  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in duration-500">
      <div className="space-y-2 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gray-50 dark:bg-[#0A0D12] border border-gray-200 dark:border-[#1E2329] text-[#00D4B3]">
              <BookOpen size={24} />
            </div>
            Paso 4: Curaduria de Fuentes (Fase 2)
          </h2>
          <p className="text-gray-500 dark:text-[#6C757D] text-base ml-12">
            Fuentes de calidad encontradas para cada leccion.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onResetStep}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-[#1E2329] text-gray-500 dark:text-[#6C757D] text-xs hover:border-gray-400 dark:hover:border-[#6C757D] hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-[#1E2329] transition-colors flex items-center gap-2"
          >
            <RefreshCw size={14} />
            Reiniciar este paso
          </button>

          {curationState === CURATION_STATES.PAUSED && (
            <button
              onClick={onResume}
              className="px-3 py-1.5 rounded-lg bg-[#00D4B3]/10 text-[#00D4B3] border border-[#00D4B3]/20 hover:bg-[#00D4B3]/20 transition-colors flex items-center gap-2 font-bold animate-pulse"
            >
              <PlayCircle size={14} />
              Reanudar Generacion
            </button>
          )}
        </div>
      </div>

      <CurationDashboard
        rows={rows}
        onUpdateRow={updateRow}
        onDeleteRow={deleteRow}
        isGenerating={isGenerating}
        lessons={lessons}
        onAddUrl={addManualUrl}
        onAddPdf={addManualPdf}
        onRevalidate={validateRow}
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
        canReview={canReview}
        curationApproved={curationApproved}
        curationBlocked={curationBlocked}
        isGenerating={isGenerating}
        isValidating={isValidating}
        invalidRowsCount={invalidRowsCount}
        onApprove={onApprove}
        onContinue={onContinue}
        onIterateInvalidSources={onIterateInvalidSources}
        onRegenerate={onRegenerate}
        onReject={onReject}
        onValidate={onValidate}
        pendingValidationCount={pendingValidationCount}
        missingCoverageCount={missingCoverageCount}
        reviewNotes={reviewNotes}
        setReviewNotes={setReviewNotes}
        rowsLength={rows.length}
        validatedCount={validatedCount}
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
