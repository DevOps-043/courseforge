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
    <div className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-[#94A3B8]">
        Que accion deseas realizar para reiniciar la curaduria?
      </p>
      <div className="grid grid-cols-1 gap-3">
        <button
          type="button"
          onClick={onClearCurrentData}
          className="group w-full rounded-xl border border-gray-200 bg-white p-4 text-left transition-colors hover:border-rose-500/50 dark:border-[#1E2329] dark:bg-[#0F1419]"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-rose-500/10 p-2 text-rose-500 transition-colors group-hover:bg-rose-500 group-hover:text-white">
              <Trash2 size={18} />
            </div>
            <div className="flex-1">
              <div className="text-sm font-bold text-gray-900 dark:text-white">
                Limpiar informacion actual
              </div>
              <div className="text-xs text-gray-500 dark:text-[#6C757D]">
                Elimina todas las fuentes generadas por GPT para empezar de cero
                manualmente.
              </div>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={onRestartAutomaticSearch}
          className="group w-full rounded-xl border border-gray-200 bg-white p-4 text-left transition-colors hover:border-[#00D4B3]/50 dark:border-[#1E2329] dark:bg-[#0F1419]"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-[#00D4B3]/10 p-2 text-[#00D4B3] transition-colors group-hover:bg-[#00D4B3] group-hover:text-[#0A2540]">
              <RefreshCw size={18} />
            </div>
            <div className="flex-1">
              <div className="text-sm font-bold text-gray-900 dark:text-white">
                Reiniciar busqueda automatica
              </div>
              <div className="text-xs text-gray-500 dark:text-[#6C757D]">
                Inicia de nuevo el proceso de busqueda interna de CourseForge.
              </div>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}
