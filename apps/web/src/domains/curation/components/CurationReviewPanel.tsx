"use client";

import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";

interface CurationReviewPanelProps {
  curationApproved: boolean;
  curationBlocked: boolean;
  isGenerating: boolean;
  isValidating: boolean;
  invalidRowsCount: number;
  onContinue?: () => Promise<void> | void;
  onRegenerate: () => Promise<void> | void;
  pendingValidationCount: number;
  missingCoverageCount: number;
  completedLessonsCount: number;
  coveredRequiredSources: number;
  requiredSourcesCount: number;
  totalLessonsCount: number;
}

export function CurationReviewPanel({
  curationApproved,
  curationBlocked,
  isGenerating,
  isValidating,
  invalidRowsCount,
  onContinue,
  onRegenerate,
  pendingValidationCount,
  missingCoverageCount,
  completedLessonsCount,
  coveredRequiredSources,
  requiredSourcesCount,
  totalLessonsCount,
}: CurationReviewPanelProps) {
  const isRunning = isGenerating || isValidating;

  return (
    <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 dark:border-[var(--engine-muted)]/10 dark:bg-[var(--engine-surface-solid)]">
      <h3 className="mb-4 flex items-center gap-2 font-bold text-gray-900 dark:text-white">
        {isRunning ? (
          <Loader2
            size={18}
            className="animate-spin text-[var(--engine-accent)]"
          />
        ) : curationBlocked ? (
          <AlertCircle size={18} className="text-rose-500" />
        ) : (
          <CheckCircle2 size={18} className="text-[var(--engine-accent)]" />
        )}
        Estado de curaduria automatica
      </h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <CoverageStat
          label="Lecciones con cobertura completa"
          value={`${completedLessonsCount} / ${totalLessonsCount}`}
        />
        <CoverageStat
          label="Fuentes web validas requeridas"
          value={`${coveredRequiredSources} / ${requiredSourcesCount}`}
        />
      </div>

      {isRunning && (
        <div className="mt-4 border border-[var(--engine-accent)]/20 bg-[var(--engine-accent)]/10 p-4 text-sm text-[#008f79] dark:text-[var(--engine-accent)]">
          GPT sigue buscando y reponiendo automaticamente las fuentes que no
          superan la validacion. No necesitas iniciar otra iteracion.
        </div>
      )}

      {!isRunning && !curationApproved && !curationBlocked && (
        <div className="mt-4 border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-100">
          El proceso esta sincronizando su estado. Las fuentes pendientes se
          resolveran dentro de la misma ejecucion automatica.
        </div>
      )}

      {curationApproved && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <div className="flex flex-1 items-center justify-center gap-2 bg-[var(--engine-accent)]/20 py-3 font-bold text-[var(--engine-accent)]">
            <CheckCircle2 size={18} />
            Curaduria aprobada automaticamente
          </div>
          {onContinue && (
            <button
              type="button"
              onClick={onContinue}
              className="flex-1 bg-[var(--engine-info)] py-3 font-bold text-white transition-colors hover:bg-[#1548c7]"
            >
              Continuar a Materiales
            </button>
          )}
        </div>
      )}

      {curationBlocked && (
        <div className="mt-4 border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-800 dark:text-rose-100">
          <p>
            La automatizacion agoto sus rondas internas. Quedaron{" "}
            {missingCoverageCount} leccion(es) incompletas,{" "}
            {pendingValidationCount} fuente(s) pendientes y {invalidRowsCount}{" "}
            no apta(s).
          </p>
          <button
            type="button"
            onClick={onRegenerate}
            className="mt-3 inline-flex items-center gap-2 border border-rose-500/30 bg-white px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:bg-[var(--engine-canvas)] dark:text-rose-300"
          >
            <RefreshCw size={14} />
            Reintentar proceso automatico
          </button>
        </div>
      )}
    </div>
  );
}

function CoverageStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-gray-200 bg-gray-50 p-4 dark:border-[var(--engine-muted)]/20 dark:bg-[var(--engine-canvas)]">
      <p className="text-xs text-gray-500 dark:text-[var(--engine-muted)]">
        {label}
      </p>
      <p className="mt-1 text-lg font-bold text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}
