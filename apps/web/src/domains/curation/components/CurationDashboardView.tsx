"use client";

import type { ReactNode } from "react";
import { BookOpen, PlayCircle, RefreshCw } from "lucide-react";
import { CurationDashboard } from "./CurationDashboard";
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
  modalConfig: CurationModalConfig;
  onApprove: () => Promise<void> | void;
  onContinue?: () => void;
  onDismissDirty: () => Promise<void> | void;
  onIterateDirty: () => Promise<void> | void;
  onModalClose: () => void;
  onRegenerate: () => Promise<void> | void;
  onReject: () => Promise<void> | void;
  onResetStep: () => void;
  onResume: () => Promise<void> | void;
  onValidate: () => Promise<void> | void;
  pendingValidationCount: number;
  reviewNotes: string;
  rows: CurationRow[];
  setReviewNotes: (value: string) => void;
  updateRow: (rowId: string, updates: Partial<CurationRow>) => Promise<void>;
  deleteRow: (rowId: string) => Promise<void>;
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
  modalConfig,
  onApprove,
  onContinue,
  onDismissDirty,
  onIterateDirty,
  onModalClose,
  onRegenerate,
  onReject,
  onResetStep,
  onResume,
  onValidate,
  pendingValidationCount,
  reviewNotes,
  rows,
  setReviewNotes,
  updateRow,
  upstreamDirty,
  upstreamDirtySource,
  validatedCount,
}: CurationDashboardViewProps) {
  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in duration-500">
      <div className="space-y-2 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#0A0D12] border border-[#1E2329] text-[#00D4B3]">
              <BookOpen size={24} />
            </div>
            Paso 4: Curaduria de Fuentes (Fase 2)
          </h2>
          <p className="text-[#6C757D] text-base ml-12">
            Fuentes de calidad encontradas para cada leccion.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onResetStep}
            className="px-3 py-1.5 rounded-lg border border-[#1E2329] text-[#6C757D] text-xs hover:border-[#6C757D] hover:text-white hover:bg-[#1E2329] transition-colors flex items-center gap-2"
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
        onApprove={onApprove}
        onContinue={onContinue}
        onRegenerate={onRegenerate}
        onReject={onReject}
        onValidate={onValidate}
        pendingValidationCount={pendingValidationCount}
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
      />
    </div>
  );
}
