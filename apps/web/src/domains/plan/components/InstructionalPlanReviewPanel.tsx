"use client";

import {
  AlertCircle,
  CheckCircle2,
  CheckSquare,
  Edit3,
  RefreshCw,
} from "lucide-react";
import { PLAN_STATES } from "@/lib/pipeline-constants";
import { InstructionalPlanRecord } from "./plan-view.types";

interface InstructionalPlanReviewPanelProps {
  canReview: boolean;
  isGenerating: boolean;
  isValidating: boolean;
  onApprove: () => Promise<void> | void;
  onNext?: () => void;
  onReject: () => Promise<void> | void;
  onRegenerateRejected: () => Promise<void> | void;
  onValidate: () => Promise<void> | void;
  plan: InstructionalPlanRecord;
  reviewNotes: string;
  setReviewNotes: (value: string) => void;
}

export function InstructionalPlanReviewPanel({
  canReview,
  isGenerating,
  isValidating,
  onApprove,
  onNext,
  onReject,
  onRegenerateRejected,
  onValidate,
  plan,
  reviewNotes,
  setReviewNotes,
}: InstructionalPlanReviewPanelProps) {
  const isApproved = plan.state === PLAN_STATES.APPROVED;
  const isRejected = plan.state === "STEP_REJECTED";
  const canDecide = Boolean(plan.validation) && !isValidating;

  return (
    <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-6 mt-8">
      <h3 className="text-gray-900 dark:text-white font-bold mb-4 flex items-center gap-2">
        <Edit3 size={18} /> Revisión Fase 3: Plan Instruccional
      </h3>

      <textarea
        className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl p-4 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-[#00D4B3]/50 min-h-[100px] placeholder-gray-400 dark:placeholder-gray-600"
        placeholder="Escribe tus comentarios o feedback sobre el plan instruccional..."
        value={reviewNotes}
        onChange={(event) => setReviewNotes(event.target.value)}
        disabled={isApproved}
      />

      <div className="flex items-center gap-4 mt-4">
        {canReview && !isApproved && !isRejected && (
          <>
            <button
              onClick={onValidate}
              disabled={isValidating || isGenerating}
              className="flex-1 bg-white dark:bg-[#0F1419] border border-[#00D4B3] hover:bg-[#00D4B3]/10 text-[#00D4B3] py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isValidating ? (
                <RefreshCw size={18} className="animate-spin" />
              ) : (
                <CheckSquare size={18} />
              )}
              {isValidating ? "Validando..." : "Validar Contenido"}
            </button>
            <button
              onClick={onApprove}
              disabled={!canDecide}
              className={`flex-1 py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2 ${
                !canDecide
                  ? "bg-[#00D4B3]/5 text-[#00D4B3]/30 border border-[#00D4B3]/5 cursor-not-allowed"
                  : "bg-[#00D4B3]/10 hover:bg-[#00D4B3]/20 text-[#00D4B3] border border-[#00D4B3]/20"
              }`}
            >
              <CheckCircle2 size={18} />
              Aprobar Fase 3
            </button>
            <button
              onClick={onReject}
              disabled={!canDecide}
              className={`flex-1 py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2 ${
                !canDecide
                  ? "bg-[#EF4444]/5 text-[#EF4444]/30 border border-[#EF4444]/5 cursor-not-allowed"
                  : "bg-[#EF4444]/10 hover:bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/20"
              }`}
            >
              <RefreshCw size={18} />
              Rechazar Fase 3
            </button>
          </>
        )}

        {isApproved && (
          <div className="w-full flex gap-4">
            <div className="flex-1 bg-[#00D4B3]/20 text-[#00D4B3] py-3 rounded-xl font-bold text-center flex items-center justify-center gap-2">
              <CheckCircle2 size={18} />
              Fase 3 Aprobada
            </div>
            {onNext && (
              <button
                type="button"
                onClick={onNext}
                className="flex-1 bg-[#1F5AF6] hover:bg-[#1548c7] text-white py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#1F5AF6]/20"
              >
                Continuar a Fuentes
              </button>
            )}
          </div>
        )}

        {isRejected && (
          <div className="w-full flex gap-4">
            <div className="flex-1 bg-[#EF4444]/20 text-[#EF4444] py-3 rounded-xl font-bold text-center flex items-center justify-center gap-2">
              <AlertCircle size={18} />
              Fase 3 Rechazada
            </div>
            <button
              onClick={onRegenerateRejected}
              className="flex-1 bg-[#EF4444] hover:bg-[#cc3a3a] text-white py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg"
            >
              <RefreshCw size={18} />
              Regenerar Plan
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
