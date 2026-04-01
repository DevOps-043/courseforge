"use client";

import {
  AlertCircle,
  CheckCircle2,
  CheckSquare,
  Edit3,
  RefreshCw,
} from "lucide-react";
import { motion } from "framer-motion";

interface CurationReviewPanelProps {
  canReview: boolean;
  curationApproved: boolean;
  curationBlocked: boolean;
  isGenerating: boolean;
  isValidating: boolean;
  onApprove: () => Promise<void> | void;
  onContinue?: () => void;
  onRegenerate: () => Promise<void> | void;
  onReject: () => Promise<void> | void;
  onValidate: () => Promise<void> | void;
  pendingValidationCount: number;
  reviewNotes: string;
  setReviewNotes: (value: string) => void;
  rowsLength: number;
  validatedCount: number;
}

export function CurationReviewPanel({
  canReview,
  curationApproved,
  curationBlocked,
  isGenerating,
  isValidating,
  onApprove,
  onContinue,
  onRegenerate,
  onReject,
  onValidate,
  pendingValidationCount,
  reviewNotes,
  rowsLength,
  setReviewNotes,
  validatedCount,
}: CurationReviewPanelProps) {
  const canApprove =
    !isValidating && pendingValidationCount === 0 && rowsLength > 0;

  return (
    <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-6 mt-8">
      <h3 className="text-gray-900 dark:text-white font-bold mb-4 flex items-center gap-2">
        <Edit3 size={18} /> Revision Fase 4: Curaduria de Fuentes
      </h3>

      <textarea
        className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl p-4 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-[#00D4B3]/50 min-h-[100px] placeholder-gray-400 dark:placeholder-gray-600"
        placeholder="Escribe tus comentarios o feedback sobre la curaduria de fuentes..."
        value={reviewNotes}
        onChange={(event) => setReviewNotes(event.target.value)}
        disabled={curationApproved}
      />

      {(isValidating || pendingValidationCount > 0) && (
        <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          {isValidating ? (
            <p>
              La validacion de fuentes esta en progreso. No se puede aprobar la
              fase hasta que termine.
            </p>
          ) : (
            <p>
              Faltan {pendingValidationCount} fuentes por validar. Ejecuta la
              validacion y espera a que todas se completen antes de aprobar la
              fase.
            </p>
          )}
        </div>
      )}

      {isValidating && rowsLength > 0 && (
        <div className="mt-4 mb-2 p-4 bg-[#0A0D12] border border-[#1E2329] rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <RefreshCw size={20} className="text-[#00D4B3] animate-spin" />
            <div>
              <p className="text-white font-medium text-sm">
                Validando fuentes en segundo plano...
              </p>
              <p className="text-[#6C757D] text-xs">
                Manten esta pagina abierta o cierrala, el proceso continuara.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-[#00D4B3] font-bold text-lg leading-none">
                {validatedCount}{" "}
                <span className="text-[#6C757D] text-sm">/ {rowsLength}</span>
              </p>
              <p className="text-[#6C757D] text-[10px] uppercase tracking-wider font-semibold mt-1">
                Validadas
              </p>
            </div>
            <div className="w-12 h-12">
              <svg
                viewBox="0 0 36 36"
                className="w-full h-full circular-chart inline-block"
              >
                <path
                  className="text-[#1E2329] stroke-current"
                  fill="none"
                  strokeWidth="3"
                  strokeDasharray="100, 100"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <motion.path
                  className="text-[#00D4B3] stroke-current"
                  fill="none"
                  strokeWidth="3"
                  strokeDasharray={`${Math.max(2, Math.round((validatedCount / rowsLength) * 100))}, 100`}
                  initial={{ strokeDasharray: "0, 100" }}
                  animate={{
                    strokeDasharray: `${Math.max(2, Math.round((validatedCount / rowsLength) * 100))}, 100`,
                  }}
                  transition={{ duration: 0.5 }}
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 mt-4">
        {canReview && !curationApproved && !curationBlocked && (
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
              {isValidating ? "Validando en progreso..." : "Validar Contenido"}
            </button>
            <button
              onClick={onApprove}
              disabled={!canApprove}
              className={`flex-1 py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2
                ${
                  !canApprove
                    ? "bg-[#00D4B3]/5 text-[#00D4B3]/30 border border-[#00D4B3]/5 cursor-not-allowed"
                    : "bg-[#00D4B3]/10 hover:bg-[#00D4B3]/20 text-[#00D4B3] border border-[#00D4B3]/20"
                }`}
            >
              <CheckCircle2 size={18} />
              {isValidating
                ? "Esperando validacion..."
                : pendingValidationCount > 0
                  ? "Validacion requerida"
                  : "Aprobar Fase 4"}
            </button>
            <button
              onClick={onReject}
              disabled={isValidating}
              className={`flex-1 py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2
                ${
                  isValidating
                    ? "bg-[#EF4444]/5 text-[#EF4444]/30 border border-[#EF4444]/5 cursor-not-allowed"
                    : "bg-[#EF4444]/10 hover:bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/20"
                }`}
            >
              <RefreshCw size={18} />
              Rechazar Fase 4
            </button>
          </>
        )}

        {curationApproved && (
          <div className="w-full flex gap-4">
            <div className="flex-1 bg-[#00D4B3]/20 text-[#00D4B3] py-3 rounded-xl font-bold text-center flex items-center justify-center gap-2">
              <CheckCircle2 size={18} />
              Fase 4 Aprobada
            </div>
            {onContinue && (
              <button
                type="button"
                onClick={onContinue}
                className="flex-1 bg-[#1F5AF6] hover:bg-[#1548c7] text-white py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#1F5AF6]/20"
              >
                Continuar a Materiales
              </button>
            )}
          </div>
        )}

        {curationBlocked && (
          <div className="w-full flex gap-4">
            <div className="flex-1 bg-[#EF4444]/20 text-[#EF4444] py-3 rounded-xl font-bold text-center flex items-center justify-center gap-2">
              <AlertCircle size={18} />
              Fase 4 Rechazada
            </div>
            <button
              onClick={onRegenerate}
              className="flex-1 bg-[#EF4444] hover:bg-[#cc3a3a] text-white py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg"
            >
              <RefreshCw size={18} />
              Regenerar Curaduria
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
