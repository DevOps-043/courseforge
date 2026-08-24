"use client";

import { RefreshCw, Trash2 } from "lucide-react";

interface CurationResetOptionsProps {
  onClearCurrentData: () => Promise<void> | void;
  onRestartAutomaticSearch: () => Promise<void> | void;
}

export function CurationResetOptions({
  onClearCurrentData,
  onRestartAutomaticSearch,
}: CurationResetOptionsProps) {
  return (
    <div className="space-y-5">
      <p className="max-w-sm text-sm leading-relaxed text-gray-500 dark:text-[var(--engine-text-muted)]">
        Que accion deseas realizar para reiniciar la curaduria?
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={onClearCurrentData}
          className="group min-h-32 w-full rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-all hover:border-rose-500/50 hover:bg-rose-50/50 focus:outline-none focus:ring-2 focus:ring-rose-500/20 dark:border-[var(--engine-surface-hover)] dark:bg-[var(--engine-canvas)] dark:hover:bg-rose-500/5"
        >
          <div className="flex h-full flex-col gap-3">
            <div className="rounded-lg bg-rose-500/10 p-2 text-rose-500 transition-colors group-hover:bg-rose-500 group-hover:text-white">
              <Trash2 size={18} />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-bold text-gray-900 dark:text-white">
                Limpiar informacion actual
              </div>
              <div className="text-xs leading-relaxed text-gray-500 dark:text-[var(--engine-muted)]">
                Elimina las fuentes generadas automaticamente para empezar de
                cero.
              </div>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={onRestartAutomaticSearch}
          className="group min-h-32 w-full rounded-xl border border-[var(--engine-accent)]/60 bg-[var(--engine-accent)]/5 p-4 text-left shadow-sm transition-all hover:border-[var(--engine-accent)] hover:bg-[var(--engine-accent)]/10 focus:outline-none focus:ring-2 focus:ring-[var(--engine-accent)]/20 dark:border-[var(--engine-accent)]/30 dark:bg-[var(--engine-accent)]/5"
        >
          <div className="flex h-full flex-col gap-3">
            <div className="rounded-lg bg-[var(--engine-accent)]/10 p-2 text-[var(--engine-accent)] transition-colors group-hover:bg-[var(--engine-accent)] group-hover:text-[var(--engine-primary)]">
              <RefreshCw size={18} />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-bold text-gray-900 dark:text-white">
                Reiniciar busqueda automatica
              </div>
              <div className="text-xs leading-relaxed text-gray-500 dark:text-[var(--engine-muted)]">
                Repite la busqueda con OpenAI y conserva todas las fuentes manuales.
              </div>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}
