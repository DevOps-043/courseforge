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
      <p className="max-w-sm text-sm leading-relaxed text-gray-500 dark:text-[#94A3B8]">
        Que accion deseas realizar para reiniciar la curaduria?
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={onClearCurrentData}
          className="group min-h-32 w-full rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-all hover:border-rose-500/50 hover:bg-rose-50/50 focus:outline-none focus:ring-2 focus:ring-rose-500/20 dark:border-[#1E2329] dark:bg-[#0F1419] dark:hover:bg-rose-500/5"
        >
          <div className="flex h-full flex-col gap-3">
            <div className="rounded-lg bg-rose-500/10 p-2 text-rose-500 transition-colors group-hover:bg-rose-500 group-hover:text-white">
              <Trash2 size={18} />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-bold text-gray-900 dark:text-white">
                Limpiar informacion actual
              </div>
              <div className="text-xs leading-relaxed text-gray-500 dark:text-[#6C757D]">
                Elimina las fuentes generadas automaticamente para empezar de
                cero.
              </div>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={onRestartAutomaticSearch}
          className="group min-h-32 w-full rounded-xl border border-[#00D4B3]/60 bg-[#00D4B3]/5 p-4 text-left shadow-sm transition-all hover:border-[#00D4B3] hover:bg-[#00D4B3]/10 focus:outline-none focus:ring-2 focus:ring-[#00D4B3]/20 dark:border-[#00D4B3]/30 dark:bg-[#00D4B3]/5"
        >
          <div className="flex h-full flex-col gap-3">
            <div className="rounded-lg bg-[#00D4B3]/10 p-2 text-[#00D4B3] transition-colors group-hover:bg-[#00D4B3] group-hover:text-[#0A2540]">
              <RefreshCw size={18} />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-bold text-gray-900 dark:text-white">
                Reiniciar busqueda automatica
              </div>
              <div className="text-xs leading-relaxed text-gray-500 dark:text-[#6C757D]">
                Repite la busqueda con OpenAI y conserva todas las fuentes manuales.
              </div>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}
